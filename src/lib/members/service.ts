import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { User } from '@/db/schema';

export class UserNotFoundError extends Error { constructor(id: string) { super(`No user ${id}`); this.name = 'UserNotFoundError'; } }
export class InvalidPhoneError extends Error { constructor(phone: string) { super(`Not a valid phone number: ${phone}`); this.name = 'InvalidPhoneError'; } }

// E.164: a leading '+', then 1-15 digits, first digit non-zero.
const E164_RE = /^\+[1-9]\d{1,14}$/;

function checkPhone(phoneNumber: string | null): void {
  if (phoneNumber !== null && !E164_RE.test(phoneNumber)) throw new InvalidPhoneError(phoneNumber);
}

export function listMembers(db: Db): Promise<User[]> {
  return db.select().from(schema.user).orderBy(schema.user.createdAt);
}

/** Member-admin edit: the full row, including membership status and contact tracking. */
export async function updateMember(
  db: Db,
  input: {
    id: string; name: string; nickname: string | null; phoneNumber: string | null; discordHandle: string | null;
    isActiveMember: boolean; membershipExpiresAt: Date | null; contactNotes: string | null;
  },
): Promise<User> {
  checkPhone(input.phoneNumber);
  const [row] = await db
    .update(schema.user)
    .set({
      name: input.name, nickname: input.nickname, phoneNumber: input.phoneNumber, discordHandle: input.discordHandle,
      isActiveMember: input.isActiveMember, membershipExpiresAt: input.membershipExpiresAt, contactNotes: input.contactNotes,
    })
    .where(eq(schema.user.id, input.id))
    .returning();
  if (!row) throw new UserNotFoundError(input.id);
  return row;
}

/** Self-service edit: any logged-in user can set their own name/nickname/phone/Discord/avatar, nothing membership-related. */
export async function updateOwnProfile(
  db: Db,
  input: { id: string; name: string; nickname: string | null; phoneNumber: string | null; discordHandle: string | null; image?: string },
): Promise<User> {
  checkPhone(input.phoneNumber);
  const [row] = await db
    .update(schema.user)
    .set({
      name: input.name, nickname: input.nickname, phoneNumber: input.phoneNumber, discordHandle: input.discordHandle,
      ...(input.image !== undefined ? { image: input.image } : {}),
    })
    .where(eq(schema.user.id, input.id))
    .returning();
  if (!row) throw new UserNotFoundError(input.id);
  return row;
}

export async function clearAvatar(db: Db, id: string): Promise<void> {
  await db.update(schema.user).set({ image: null }).where(eq(schema.user.id, id));
}

export async function touchLastContacted(db: Db, id: string): Promise<void> {
  await db.update(schema.user).set({ lastContactedAt: new Date() }).where(eq(schema.user.id, id));
}
