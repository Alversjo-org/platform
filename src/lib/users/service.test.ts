import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { InvalidPhoneError, listUsers, updateUser, UserNotFoundError } from './service';

describe('user service', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'viktor', email: 'viktor@example.org', name: 'Viktor' },
      { id: 'admin', email: 'admin@example.org', name: 'Admin', role: 'admin' },
    ]);
  });

  it('updates name, phone number and membership status', async () => {
    const expiresAt = new Date('2027-01-01T00:00:00Z');
    const updated = await updateUser(db, {
      id: 'viktor',
      name: 'Viktor Andersson',
      phoneNumber: '+46701234567',
      isActiveMember: true,
      membershipExpiresAt: expiresAt,
    });
    expect(updated).toMatchObject({
      name: 'Viktor Andersson',
      phoneNumber: '+46701234567',
      isActiveMember: true,
    });
    expect(updated.membershipExpiresAt).toEqual(expiresAt);
  });

  it('clears phone number and membership expiry when set to null', async () => {
    await updateUser(db, { id: 'viktor', name: 'Viktor', phoneNumber: '+46701234567', isActiveMember: true, membershipExpiresAt: new Date() });
    const updated = await updateUser(db, { id: 'viktor', name: 'Viktor', phoneNumber: null, isActiveMember: false, membershipExpiresAt: null });
    expect(updated.phoneNumber).toBeNull();
    expect(updated.membershipExpiresAt).toBeNull();
  });

  it('rejects a phone number that is not E.164', async () => {
    await expect(
      updateUser(db, { id: 'viktor', name: 'Viktor', phoneNumber: '0701234567', isActiveMember: false, membershipExpiresAt: null }),
    ).rejects.toBeInstanceOf(InvalidPhoneError);
  });

  it('throws for an unknown user id', async () => {
    await expect(
      updateUser(db, { id: 'nobody', name: 'X', phoneNumber: null, isActiveMember: false, membershipExpiresAt: null }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('lists users ordered by creation', async () => {
    const users = await listUsers(db);
    expect(users.map((u) => u.id)).toEqual(['viktor', 'admin']);
  });
});
