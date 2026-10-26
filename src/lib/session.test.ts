import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import {
  ADMIN_ROLES, hasAnyRole, isMemberAdmin, MAPPER_ROLES, MEMBER_ADMIN_ROLES, ROLE_ADMIN_ROLES, rolesFor,
} from './session';

describe('hasAnyRole', () => {
  it('is true when the user holds any of the listed roles', () => {
    expect(hasAnyRole({ roles: ['mapper'] }, ['admin', 'mapper'])).toBe(true);
  });
  it('is false when the user holds none of the listed roles', () => {
    expect(hasAnyRole({ roles: [] }, ['admin', 'mapper'])).toBe(false);
  });
  it('does not treat admin as implicitly satisfying an unlisted role', () => {
    expect(hasAnyRole({ roles: ['admin'] }, ['mapper'])).toBe(false);
  });
});

describe('isMemberAdmin', () => {
  it('is true for admin and member-admin, false for mapper or no roles', () => {
    expect(isMemberAdmin({ roles: ['admin'] })).toBe(true);
    expect(isMemberAdmin({ roles: ['member-admin'] })).toBe(true);
    expect(isMemberAdmin({ roles: ['mapper'] })).toBe(false);
    expect(isMemberAdmin({ roles: [] })).toBe(false);
  });
});

describe('named-wrapper role lists', () => {
  it('each wrapper admits exactly the roles it is supposed to, and nothing else', () => {
    expect(ADMIN_ROLES).toEqual(['admin']);
    expect(MEMBER_ADMIN_ROLES).toEqual(['admin', 'member-admin']);
    expect(MAPPER_ROLES).toEqual(['admin', 'mapper']);
    expect(ROLE_ADMIN_ROLES).toEqual(['admin', 'role-admin']);
  });

  it('a member-admin-only user does not satisfy the mapper gate', () => {
    expect(hasAnyRole({ roles: ['member-admin'] }, MAPPER_ROLES)).toBe(false);
  });

  it('a mapper-only user does not satisfy the member-admin gate', () => {
    expect(hasAnyRole({ roles: ['mapper'] }, MEMBER_ADMIN_ROLES)).toBe(false);
  });

  it('a mapper-only user satisfies the mapper gate', () => {
    expect(hasAnyRole({ roles: ['mapper'] }, MAPPER_ROLES)).toBe(true);
  });

  it('admin alone satisfies every gate', () => {
    for (const roles of [ADMIN_ROLES, MEMBER_ADMIN_ROLES, MAPPER_ROLES, ROLE_ADMIN_ROLES]) {
      expect(hasAnyRole({ roles: ['admin'] }, roles)).toBe(true);
    }
  });
});

describe('rolesFor', () => {
  let db: Db;

  it('returns every role row for a user, and an empty array for a user with none', async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'a@example.org' }, { id: 'u2', email: 'b@example.org' }]);
    await db.insert(schema.userRole).values([
      { userId: 'u1', role: 'admin' },
      { userId: 'u1', role: 'mapper' },
    ]);
    expect((await rolesFor(db, 'u1')).sort()).toEqual(['admin', 'mapper']);
    expect(await rolesFor(db, 'u2')).toEqual([]);
  });
});
