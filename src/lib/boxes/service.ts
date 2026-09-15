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

export class ProtectedBoxError extends Error { constructor() { super('This box is protected and cannot be destroyed'); this.name = 'ProtectedBoxError'; } }
export class UserNotFoundError extends Error { constructor(email: string) { super(`No user with email ${email} has logged in yet`); this.name = 'UserNotFoundError'; } }
export class BoxNotFoundError extends Error { constructor(id: string) { super(`No box ${id}`); this.name = 'BoxNotFoundError'; } }

export const newBoxId = () => randomBytes(6).toString('hex'); // 12 hex chars, valid hostname label
export const newJwtSecret = () => randomBytes(32).toString('base64url');

async function getBox(db: Db, id: string): Promise<Box> {
  const [box] = await db.select().from(schema.boxes).where(eq(schema.boxes.id, id));
  if (!box) throw new BoxNotFoundError(id);
  return box;
}

export async function createBox(deps: BoxDeps, input: { name: string; profile: BoxProfile; ownerUserId: string; protected?: boolean }): Promise<Box> {
  const id = (deps.newId ?? newBoxId)();
  const jwtSecret = (deps.newSecret ?? newJwtSecret)();
  await deps.db.insert(schema.boxes).values({ id, name: input.name, profile: input.profile, jwtSecret, ownerUserId: input.ownerUserId, protected: input.protected ?? false, status: 'creating' });
  await deps.db.insert(schema.boxAccess).values({ boxId: id, userId: input.ownerUserId, grantedByUserId: input.ownerUserId });

  const volume = await deps.fly.createVolume(`box_${id}`, 10);
  await deps.db.update(schema.boxes).set({ flyVolumeId: volume.id }).where(eq(schema.boxes.id, id));
  const machine = await deps.fly.createMachine({ name: `box-${id}`, image: deps.image, env: boxEnv(input.profile, deps.secrets, jwtSecret), volumeId: volume.id, memoryMb: 2048, cpus: 1 });
  await deps.db.update(schema.boxes).set({ flyMachineId: machine.id, status: machine.state }).where(eq(schema.boxes.id, id));
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
  await deps.db.update(schema.boxes).set({ status: 'stopped' }).where(eq(schema.boxes.id, id));
}

export async function destroyBox(deps: BoxDeps, id: string): Promise<void> {
  const box = await getBox(deps.db, id);
  if (box.protected) throw new ProtectedBoxError();
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
  await deps.db.delete(schema.boxAccess).where(and(eq(schema.boxAccess.boxId, input.boxId), eq(schema.boxAccess.userId, input.userId)));
}
