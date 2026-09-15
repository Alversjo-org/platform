import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import type { FlyMachine } from '@/lib/fly';
import { canAccessBox, listBoxesFor } from './access';
import { createBox, destroyBox, ProtectedBoxError, revokeBox, shareBox, startBox, stopBox, UserNotFoundError, type BoxDeps, type FlyOps } from './service';

function fakeFly() {
  const calls: string[] = [];
  const machines = new Map<string, FlyMachine>();
  const fly: FlyOps = {
    async createVolume(name) { calls.push(`createVolume ${name}`); return { id: `vol_${name}` }; },
    async deleteVolume(id) { calls.push(`deleteVolume ${id}`); },
    async createMachine(input) { calls.push(`createMachine ${input.name} ${input.env.BOX_PROFILE} ${input.volumeId}`); const m = { id: `m_${input.name}`, name: input.name, state: 'started' as const, region: 'arn' }; machines.set(m.id, m); return m; },
    async getMachine(id) { return machines.get(id)!; },
    async startMachine(id) { calls.push(`start ${id}`); machines.get(id)!.state = 'started'; },
    async stopMachine(id) { calls.push(`stop ${id}`); machines.get(id)!.state = 'stopped'; },
    async destroyMachine(id) { calls.push(`destroy ${id}`); machines.delete(id); },
    async waitForState() {},
  };
  return { fly, calls };
}

const secrets = { claudeToken: 'c', ghTokenAdmin: 'ga', ghTokenContributor: 'gc', flyToken: 'f', resendKey: 'r', cloudflareToken: 'cf' };

describe('box service', () => {
  let db: Db;
  let deps: BoxDeps;
  let calls: string[];

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'admin', email: 'admin@example.org', role: 'admin' },
      { id: 'viktor', email: 'viktor@example.org' },
    ]);
    const f = fakeFly();
    calls = f.calls;
    deps = { db, fly: f.fly, secrets, image: 'img:latest', newId: () => 'abc123abc123', newSecret: () => 'jwt-secret' };
  });

  it('createBox provisions volume + machine and grants the owner access', async () => {
    const box = await createBox(deps, { name: 'Test', profile: 'contributor', ownerUserId: 'admin' });
    expect(box).toMatchObject({ id: 'abc123abc123', flyVolumeId: 'vol_box_abc123abc123', flyMachineId: 'm_box-abc123abc123', status: 'started', jwtSecret: 'jwt-secret', protected: false });
    expect(calls).toEqual(['createVolume box_abc123abc123', 'createMachine box-abc123abc123 contributor vol_box_abc123abc123']);
    expect(await canAccessBox(db, { id: 'admin', role: 'admin' }, box.id)).toBe(true);
    expect(await canAccessBox(db, { id: 'viktor', role: 'member' }, box.id)).toBe(false);
  });

  it('share and revoke control member access; unknown email throws', async () => {
    const box = await createBox(deps, { name: 'T', profile: 'contributor', ownerUserId: 'admin' });
    await shareBox(deps, { boxId: box.id, email: 'Viktor@Example.org', grantedByUserId: 'admin' });
    expect(await canAccessBox(db, { id: 'viktor', role: 'member' }, box.id)).toBe(true);
    expect((await listBoxesFor(db, { id: 'viktor', role: 'member' })).map((b) => b.id)).toEqual([box.id]);
    await revokeBox(deps, { boxId: box.id, userId: 'viktor' });
    expect(await canAccessBox(db, { id: 'viktor', role: 'member' }, box.id)).toBe(false);
    await expect(shareBox(deps, { boxId: box.id, email: 'nobody@example.org', grantedByUserId: 'admin' })).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('stop/start update status; destroy removes machine, volume and rows', async () => {
    const box = await createBox(deps, { name: 'T', profile: 'admin', ownerUserId: 'admin' });
    await stopBox(deps, box.id);
    expect((await db.select().from(schema.boxes))[0].status).toBe('stopped');
    await startBox(deps, box.id);
    expect((await db.select().from(schema.boxes))[0].status).toBe('started');
    await destroyBox(deps, box.id);
    expect(await db.select().from(schema.boxes)).toHaveLength(0);
    expect(await db.select().from(schema.boxAccess)).toHaveLength(0);
    expect(calls.slice(-2)).toEqual(['destroy m_box-abc123abc123', 'deleteVolume vol_box_abc123abc123']);
  });

  it('protected boxes cannot be destroyed', async () => {
    const box = await createBox(deps, { name: 'admin box', profile: 'admin', ownerUserId: 'admin', protected: true });
    expect(box.protected).toBe(true); // set only once the machine exists, but set
    await expect(destroyBox(deps, box.id)).rejects.toBeInstanceOf(ProtectedBoxError);
    expect(await db.select().from(schema.boxes)).toHaveLength(1);
  });

  it('a create that fails halfway leaves no rows and no volume behind', async () => {
    const failing: BoxDeps = { ...deps, fly: { ...deps.fly, async createMachine() { throw new Error('fly is down'); } } };
    await expect(createBox(failing, { name: 'T', profile: 'admin', ownerUserId: 'admin', protected: true })).rejects.toThrow('fly is down');
    expect(await db.select().from(schema.boxes)).toHaveLength(0);
    expect(await db.select().from(schema.boxAccess)).toHaveLength(0);
    expect(calls).toEqual(['createVolume box_abc123abc123', 'deleteVolume vol_box_abc123abc123']);
  });

  it('the owner can never be revoked', async () => {
    const box = await createBox(deps, { name: 'T', profile: 'contributor', ownerUserId: 'admin' });
    await expect(revokeBox(deps, { boxId: box.id, userId: 'admin' })).rejects.toThrow('The owner always has access');
    expect(await canAccessBox(db, { id: 'admin', role: 'admin' }, box.id)).toBe(true);
  });
});
