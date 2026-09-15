import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { Box, Role } from '@/db/schema';

export type AccessUser = { id: string; role: Role };

export async function canAccessBox(db: Db, user: AccessUser, boxId: string): Promise<boolean> {
  if (user.role === 'admin') {
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
  if (user.role === 'admin') return db.select().from(schema.boxes).orderBy(schema.boxes.createdAt);
  const ids = (await db.select({ boxId: schema.boxAccess.boxId }).from(schema.boxAccess).where(eq(schema.boxAccess.userId, user.id))).map((r) => r.boxId);
  if (ids.length === 0) return [];
  return db.select().from(schema.boxes).where(inArray(schema.boxes.id, ids)).orderBy(schema.boxes.createdAt);
}
