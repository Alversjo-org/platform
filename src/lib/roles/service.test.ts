import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';
import { groupRolesByUserId, NotAuthorizedError, setUserRole, UnknownRoleError } from './service';

describe('setUserRole', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'actor', email: 'actor@example.org' }, { id: 'target', email: 'target@example.org' }]);
  });

  it('a role-admin can grant mapper', async () => {
    await setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'mapper', grant: true });
    const rows = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'));
    expect(rows).toMatchObject([{ role: 'mapper', grantedByUserId: 'actor' }]);
  });

  it('a role-admin can grant member-admin without also granting mapper', async () => {
    await setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'member-admin', grant: true });
    const rows = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'));
    expect(rows.map((r) => r.role)).toEqual(['member-admin']);
  });

  it('a role-admin cannot grant admin', async () => {
    await expect(
      setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'admin', grant: true }),
    ).rejects.toThrow(NotAuthorizedError);
    expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toEqual([]);
  });

  it('a role-admin cannot grant role-admin', async () => {
    await expect(
      setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'role-admin', grant: true }),
    ).rejects.toThrow(NotAuthorizedError);
  });

  it('a role-admin cannot revoke admin from someone either', async () => {
    await db.insert(schema.userRole).values({ userId: 'target', role: 'admin' });
    await expect(
      setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'admin', grant: false }),
    ).rejects.toThrow(NotAuthorizedError);
    expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toHaveLength(1);
  });

  it('an admin can grant admin', async () => {
    await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'admin', grant: true });
    expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toMatchObject([{ role: 'admin' }]);
  });

  it('granting a role the target already holds is a no-op, not an error', async () => {
    await db.insert(schema.userRole).values({ userId: 'target', role: 'mapper' });
    await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: true });
    expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toHaveLength(1);
  });

  it('revoking a role the target does not hold is a no-op, not an error', async () => {
    await expect(
      setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: false }),
    ).resolves.toBeUndefined();
  });

  it('revoking one role leaves the target\'s other roles untouched', async () => {
    await db.insert(schema.userRole).values([{ userId: 'target', role: 'mapper' }, { userId: 'target', role: 'member-admin' }]);
    await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: false });
    const rows = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'));
    expect(rows.map((r) => r.role)).toEqual(['member-admin']);
  });

  it('writes a decisionLog row for a successful grant and for a successful revoke', async () => {
    await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: true });
    await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: false });
    const logs = await db.select().from(schema.decisionLog).where(eq(schema.decisionLog.entityId, 'target'));
    expect(logs.map((l) => l.action)).toEqual(['grant', 'revoke']);
  });

  it('rejects an actor with no role-admin or admin role, even for a grantable (non-admin-only) role', async () => {
    await expect(
      setUserRole(db, { actor: { id: 'actor', roles: [] }, targetUserId: 'target', role: 'mapper', grant: true }),
    ).rejects.toThrow(NotAuthorizedError);
    expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toEqual([]);
  });

  it('rejects an unrecognized role string, even from an admin actor', async () => {
    await expect(
      setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'bogus-role' as never, grant: true }),
    ).rejects.toThrow(UnknownRoleError);
    expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toEqual([]);
  });
});

describe('groupRolesByUserId', () => {
  it('groups role rows by userId, preserving each user\'s role list', () => {
    const result = groupRolesByUserId([
      { userId: 'a', role: 'mapper' }, { userId: 'a', role: 'admin' }, { userId: 'b', role: 'mapper' },
    ]);
    expect(result.get('a')).toEqual(['mapper', 'admin']);
    expect(result.get('b')).toEqual(['mapper']);
    expect(result.get('c')).toBeUndefined();
  });
});
