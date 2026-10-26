import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { canAccessBox, listBoxesFor, listShareCandidates } from './access';

describe('canAccessBox / listBoxesFor', () => {
  it('an admin sees and can access every box, regardless of other roles', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'owner', email: 'owner@example.org' });
    await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'owner' });
    expect(await canAccessBox(db, { id: 'admin1', roles: ['admin'] }, 'b1')).toBe(true);
    expect(await listBoxesFor(db, { id: 'admin1', roles: ['admin'] })).toHaveLength(1);
  });

  it('a mapper (not admin) has no box access, same as a plain member', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'owner', email: 'owner@example.org' });
    await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'owner' });
    expect(await canAccessBox(db, { id: 'mapper1', roles: ['mapper'] }, 'b1')).toBe(false);
    expect(await listBoxesFor(db, { id: 'mapper1', roles: ['mapper'] })).toEqual([]);
  });

  it('member-admin and role-admin also have no box access by themselves', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'owner', email: 'owner@example.org' });
    await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'owner' });
    expect(await canAccessBox(db, { id: 'ma', roles: ['member-admin'] }, 'b1')).toBe(false);
    expect(await canAccessBox(db, { id: 'ra', roles: ['role-admin'] }, 'b1')).toBe(false);
  });
});

describe('listShareCandidates', () => {
  it('lists every user without access to the box, sorted by name', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'owner', email: 'owner@example.org', name: 'Owner' },
      { id: 'u1', email: 'christian@example.org', name: 'Christian' },
      { id: 'u2', email: 'anna@example.org', name: 'Anna', nickname: 'Annie' },
      { id: 'u3', email: 'shared@example.org', name: 'Already Shared' },
    ]);
    await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'owner' });
    await db.insert(schema.boxAccess).values([
      { boxId: 'b1', userId: 'owner', grantedByUserId: 'owner' },
      { boxId: 'b1', userId: 'u3', grantedByUserId: 'owner' },
    ]);
    expect(await listShareCandidates(db, 'b1')).toEqual([
      { id: 'u2', email: 'anna@example.org', name: 'Anna', nickname: 'Annie' },
      { id: 'u1', email: 'christian@example.org', name: 'Christian', nickname: null },
    ]);
  });
});
