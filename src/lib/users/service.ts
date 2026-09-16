import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { User } from '@/db/schema';

export class UserNotFoundError extends Error { constructor(id: string) { super(`No user ${id}`); this.name = 'UserNotFoundError'; } }
export class InvalidPhoneError extends Error { constructor(phone: string) { super(`Not a valid phone number: ${phone}`); this.name = 'InvalidPhoneError'; } }

// E.164: a leading '+', then 1-15 digits, first digit non-zero.
const E164_RE = /^\+[1-9]\d{1,14}$/;

export function listUsers(db: Db): Promise<User[]> {
  return db.select().from(schema.user).orderBy(schema.user.createdAt);
}

export async function updateUser(
  db: Db,
  input: { id: string; name: string; phoneNumber: string | null; isActiveMember: boolean; membershipExpiresAt: Date | null },
): Promise<User> {
  if (input.phoneNumber !== null && !E164_RE.test(input.phoneNumber)) throw new InvalidPhoneError(input.phoneNumber);
  const [row] = await db
    .update(schema.user)
    .set({ name: input.name, phoneNumber: input.phoneNumber, isActiveMember: input.isActiveMember, membershipExpiresAt: input.membershipExpiresAt })
    .where(eq(schema.user.id, input.id))
    .returning();
  if (!row) throw new UserNotFoundError(input.id);
  return row;
}
