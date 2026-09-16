import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Box, BoxProfile } from '@/db/schema';
import type { FlyClient } from '@/lib/fly';
import { boxEnv, type BoxSecrets } from './env';

export type FlyOps = Pick<FlyClient, 'createVolume' | 'deleteVolume' | 'createMachine' | 'getMachine' | 'startMachine' | 'stopMachine' | 'destroyMachine' | 'waitForState'>;

export interface BoxDeps {
  db: Db; fly: FlyOps; secrets: BoxSecrets; image: string;
  newId?: () => string; newSecret?: () => string;
}

export class UserNotFoundError extends Error { constructor(email: string) { super(`No user with email ${email} has logged in yet`); this.name = 'UserNotFoundError'; } }
export class BoxNotFoundError extends Error { constructor(id: string) { super(`No box ${id}`); this.name = 'BoxNotFoundError'; } }

export const newBoxId = () => randomBytes(6).toString('hex'); // 12 hex chars, valid hostname label
export const newJwtSecret = () => randomBytes(32).toString('base64url');

async function getBox(db: Db, id: string): Promise<Box> {
  const [box] = await db.select().from(schema.boxes).where(eq(schema.boxes.id, id));
  if (!box) throw new BoxNotFoundError(id);
  return box;
}

export async function createBox(deps: BoxDeps, input: { name: string; profile: BoxProfile; ownerUserId: string }): Promise<Box> {
  const id = (deps.newId ?? newBoxId)();
  const jwtSecret = (deps.newSecret ?? newJwtSecret)();
  await deps.db.insert(schema.boxes).values({ id, name: input.name, profile: input.profile, jwtSecret, ownerUserId: input.ownerUserId, status: 'creating' });
  await deps.db.insert(schema.boxAccess).values({ boxId: id, userId: input.ownerUserId, grantedByUserId: input.ownerUserId });

  let volumeId: string | undefined;
  try {
    const [owner] = await deps.db.select({ email: schema.user.email }).from(schema.user).where(eq(schema.user.id, input.ownerUserId));
    const volume = await deps.fly.createVolume(`box_${id}`, 10);
    volumeId = volume.id;
    await deps.db.update(schema.boxes).set({ flyVolumeId: volume.id }).where(eq(schema.boxes.id, id));
    const machine = await deps.fly.createMachine({ name: `box-${id}`, image: deps.image, env: boxEnv(input.profile, deps.secrets, jwtSecret, owner.email), volumeId: volume.id, memoryMb: 2048, cpus: 1 });
    await deps.db.update(schema.boxes).set({ flyMachineId: machine.id, status: machine.state }).where(eq(schema.boxes.id, id));
  } catch (err) {
    // Undo everything this call created, so a failed attempt leaves nothing to clean
    // up by hand and the same name can simply be tried again.
    try {
      await deps.db.delete(schema.boxes).where(eq(schema.boxes.id, id)); // box_access cascades
      if (volumeId) await deps.fly.deleteVolume(volumeId);
    } catch (cleanupErr) {
      console.error(`createBox: cleanup after a failed create of ${id} failed`, cleanupErr);
    }
    throw err;
  }
  return getBox(deps.db, id);
}

export async function startBox(deps: BoxDeps, id: string): Promise<void> {
  const box = await getBox(deps.db, id);
  if (!box.flyMachineId) throw new BoxNotFoundError(id);
  await deps.fly.startMachine(box.flyMachineId);
  await deps.fly.waitForState(box.flyMachineId, 'started', 60);
  await deps.db.update(schema.boxes).set({ status: 'started' }).where(eq(schema.boxes.id, id));
}

export async function stopBox(deps: BoxDeps, id: string): Promise<void> {
  const box = await getBox(deps.db, id);
  if (!box.flyMachineId) throw new BoxNotFoundError(id);
  await deps.fly.stopMachine(box.flyMachineId);
  await deps.fly.waitForState(box.flyMachineId, 'stopped', 60); // mirrors startBox: status reflects reality, not intent
  await deps.db.update(schema.boxes).set({ status: 'stopped' }).where(eq(schema.boxes.id, id));
}

export async function destroyBox(deps: BoxDeps, id: string): Promise<void> {
  const box = await getBox(deps.db, id);
  if (box.flyMachineId) await deps.fly.destroyMachine(box.flyMachineId);
  if (box.flyVolumeId) await deps.fly.deleteVolume(box.flyVolumeId);
  await deps.db.delete(schema.boxes).where(eq(schema.boxes.id, id)); // box_access cascades
}

export async function shareBox(deps: BoxDeps, input: { boxId: string; email: string; grantedByUserId: string }): Promise<void> {
  const email = input.email.trim().toLowerCase();
  const [u] = await deps.db.select({ id: schema.user.id }).from(schema.user).where(sql`lower(${schema.user.email}) = ${email}`);
  if (!u) throw new UserNotFoundError(input.email);
  await getBox(deps.db, input.boxId);
  await deps.db.insert(schema.boxAccess).values({ boxId: input.boxId, userId: u.id, grantedByUserId: input.grantedByUserId }).onConflictDoNothing();
}

export async function revokeBox(deps: BoxDeps, input: { boxId: string; userId: string }): Promise<void> {
  const box = await getBox(deps.db, input.boxId);
  // Revoking the owner would leave a box nobody but an admin can reach, and the row
  // still names them as owner. The UI hides the button; this is the actual rule.
  if (box.ownerUserId === input.userId) throw new Error('The owner always has access');
  await deps.db.delete(schema.boxAccess).where(and(eq(schema.boxAccess.boxId, input.boxId), eq(schema.boxAccess.userId, input.userId)));
}
