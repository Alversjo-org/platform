import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { canAccessBox, listBoxesFor } from './access';

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
