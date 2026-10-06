import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { canAccessBox } from '@/lib/boxes/access';
import { isMemberAdmin, roleFromRaw } from './session';

describe('roleFromRaw', () => {
  it('maps admin and member-admin explicitly, defaulting everything else to member', () => {
    expect(roleFromRaw('admin')).toBe('admin');
    expect(roleFromRaw('member-admin')).toBe('member-admin');
    expect(roleFromRaw('member')).toBe('member');
    expect(roleFromRaw(undefined)).toBe('member');
    expect(roleFromRaw('bogus')).toBe('member');
  });
});

describe('isMemberAdmin', () => {
  it('is true for admin and member-admin, false for member', () => {
    expect(isMemberAdmin({ role: 'admin' })).toBe(true);
    expect(isMemberAdmin({ role: 'member-admin' })).toBe(true);
    expect(isMemberAdmin({ role: 'member' })).toBe(false);
  });
});

describe('box access is unaffected by member-admin', () => {
  let db: Db;

  it('member-admin has no box access, same as a plain member', async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'ma', email: 'ma@example.org', role: 'member-admin' },
      { id: 'owner', email: 'owner@example.org', role: 'member' },
    ]);
    await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'owner' });
    expect(await canAccessBox(db, { id: 'ma', role: 'member-admin' }, 'b1')).toBe(false);
  });
});
