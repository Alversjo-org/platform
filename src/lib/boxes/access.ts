import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Box, Role } from '@/db/schema';
import { hasAnyRole } from '@/lib/session';

export type AccessUser = { id: string; roles: Role[] };

export async function canAccessBox(db: Db, user: AccessUser, boxId: string): Promise<boolean> {
  if (hasAnyRole(user, ['admin'])) {
    const rows = await db.select({ id: schema.boxes.id }).from(schema.boxes).where(eq(schema.boxes.id, boxId));
    return rows.length > 0;
  }
  const rows = await db
    .select({ boxId: schema.boxAccess.boxId })
    .from(schema.boxAccess)
    .where(and(eq(schema.boxAccess.boxId, boxId), eq(schema.boxAccess.userId, user.id)));
  return rows.length > 0;
}

export async function listBoxesFor(db: Db, user: AccessUser): Promise<Box[]> {
  if (hasAnyRole(user, ['admin'])) return db.select().from(schema.boxes).orderBy(schema.boxes.createdAt);
  const ids = (await db.select({ boxId: schema.boxAccess.boxId }).from(schema.boxAccess).where(eq(schema.boxAccess.userId, user.id))).map((r) => r.boxId);
  if (ids.length === 0) return [];
  return db.select().from(schema.boxes).where(inArray(schema.boxes.id, ids)).orderBy(schema.boxes.createdAt);
}

export type ShareCandidate = { id: string; email: string; name: string; nickname: string | null };

/** Everyone who could be given access to the box: users who don't already have it. */
export async function listShareCandidates(db: Db, boxId: string): Promise<ShareCandidate[]> {
  const withAccess = db.select({ userId: schema.boxAccess.userId }).from(schema.boxAccess).where(eq(schema.boxAccess.boxId, boxId));
  return db
    .select({ id: schema.user.id, email: schema.user.email, name: schema.user.name, nickname: schema.user.nickname })
    .from(schema.user)
    .where(notInArray(schema.user.id, withAccess))
    .orderBy(asc(schema.user.name), asc(schema.user.email));
}
