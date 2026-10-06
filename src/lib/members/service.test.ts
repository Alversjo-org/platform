import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import {
  clearAvatar, InvalidPhoneError, listMembers, touchLastContacted, updateMember, updateOwnProfile, UserNotFoundError,
} from './service';

describe('member service', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'viktor', email: 'viktor@example.org', name: 'Viktor' },
      { id: 'admin', email: 'admin@example.org', name: 'Admin', role: 'admin' },
    ]);
  });

  it('updateMember sets every member-admin-editable field, including membership status and notes', async () => {
    const expiresAt = new Date('2027-01-01T00:00:00Z');
    const updated = await updateMember(db, {
      id: 'viktor', name: 'Viktor Andersson', nickname: 'Vik', phoneNumber: '+46701234567', discordHandle: 'vik#1234',
      isActiveMember: true, membershipExpiresAt: expiresAt, contactNotes: 'Paid at the door',
    });
    expect(updated).toMatchObject({
      name: 'Viktor Andersson', nickname: 'Vik', phoneNumber: '+46701234567', discordHandle: 'vik#1234',
      isActiveMember: true, contactNotes: 'Paid at the door',
    });
    expect(updated.membershipExpiresAt).toEqual(expiresAt);
  });

  it('updateMember clears optional fields back to null', async () => {
    const expiresAt = new Date('2027-01-01T00:00:00Z');
    await updateMember(db, {
      id: 'viktor', name: 'Viktor Andersson', nickname: 'Vik', phoneNumber: '+46701234567', discordHandle: 'vik#1234',
      isActiveMember: true, membershipExpiresAt: expiresAt, contactNotes: 'Paid at the door',
    });
    const cleared = await updateMember(db, {
      id: 'viktor', name: 'Viktor Andersson', nickname: null, phoneNumber: null, discordHandle: null,
      isActiveMember: true, membershipExpiresAt: null, contactNotes: null,
    });
    expect(cleared.nickname).toBeNull();
    expect(cleared.phoneNumber).toBeNull();
    expect(cleared.discordHandle).toBeNull();
    expect(cleared.contactNotes).toBeNull();
    expect(cleared.membershipExpiresAt).toBeNull();
  });

  it('updateMember rejects a phone number that is not E.164', async () => {
    await expect(
      updateMember(db, {
        id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: '0701234567', discordHandle: null,
        isActiveMember: false, membershipExpiresAt: null, contactNotes: null,
      }),
    ).rejects.toBeInstanceOf(InvalidPhoneError);
  });

  it('updateMember throws for an unknown id', async () => {
    await expect(
      updateMember(db, {
        id: 'nobody', name: 'X', nickname: null, phoneNumber: null, discordHandle: null,
        isActiveMember: false, membershipExpiresAt: null, contactNotes: null,
      }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('listMembers lists everyone, ordered by creation', async () => {
    const members = await listMembers(db);
    expect(members.map((m) => m.id)).toEqual(['viktor', 'admin']);
  });

  it('updateOwnProfile lets an active member set name, nickname, phone and Discord handle', async () => {
    const future = new Date(Date.now() + 86_400_000);
    await updateMember(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null,
      isActiveMember: true, membershipExpiresAt: future, contactNotes: null,
    });
    const updated = await updateOwnProfile(db, { id: 'viktor', name: 'Vik', nickname: 'V', phoneNumber: '+46701234567', discordHandle: 'vik#1' });
    expect(updated).toMatchObject({ name: 'Vik', nickname: 'V', phoneNumber: '+46701234567', discordHandle: 'vik#1' });
  });

  it('updateOwnProfile succeeds even for a member who is not currently active', async () => {
    // viktor is never made active in this test: isActiveMember defaults to false.
    const updated = await updateOwnProfile(db, { id: 'viktor', name: 'Vik', nickname: null, phoneNumber: null, discordHandle: null });
    expect(updated.name).toBe('Vik');
  });

  it('updateOwnProfile sets the image when provided', async () => {
    const updated = await updateOwnProfile(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null, image: 'data:image/webp;base64,AAAA',
    });
    expect(updated.image).toBe('data:image/webp;base64,AAAA');
  });

  it('updateOwnProfile leaves the image unchanged when not provided', async () => {
    await updateOwnProfile(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null, image: 'data:image/webp;base64,AAAA',
    });
    const updated = await updateOwnProfile(db, { id: 'viktor', name: 'Viktor Andersson', nickname: null, phoneNumber: null, discordHandle: null });
    expect(updated.image).toBe('data:image/webp;base64,AAAA');
  });

  it('clearAvatar sets the image back to null', async () => {
    await updateOwnProfile(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null, image: 'data:image/webp;base64,AAAA',
    });
    await clearAvatar(db, 'viktor');
    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, 'viktor'));
    expect(row.image).toBeNull();
  });

  it('clearAvatar on a member with no image is a harmless no-op', async () => {
    await expect(clearAvatar(db, 'viktor')).resolves.toBeUndefined();
    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, 'viktor'));
    expect(row.image).toBeNull();
  });

  it('touchLastContacted stamps the current time', async () => {
    await touchLastContacted(db, 'viktor');
    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, 'viktor'));
    expect(row.lastContactedAt).toBeInstanceOf(Date);
  });
});
