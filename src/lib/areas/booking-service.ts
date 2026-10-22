import { randomUUID } from 'node:crypto';
import { and, eq, gt, lt, ne } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { EventArea } from '@/db/schema';

export type AreaOverlapWarning = { eventAreaId: string; eventProjectId: string; eventTitle: string; from: Date; to: Date };

export async function bookEventArea(
  db: Db,
  input: { eventProjectId: string; areaId: string; from: Date; to: Date; setupNote: string | null },
): Promise<{ booking: EventArea; overlaps: AreaOverlapWarning[] }> {
  const [booking] = await db.insert(schema.eventArea)
    .values({ id: randomUUID(), eventProjectId: input.eventProjectId, areaId: input.areaId, from: input.from, to: input.to, setupNote: input.setupNote })
    .returning();
  const overlaps = await db.select({
    eventAreaId: schema.eventArea.id, eventProjectId: schema.eventArea.eventProjectId,
    eventTitle: schema.project.title, from: schema.eventArea.from, to: schema.eventArea.to,
  }).from(schema.eventArea)
    .innerJoin(schema.project, eq(schema.project.id, schema.eventArea.eventProjectId))
    .where(and(
      eq(schema.eventArea.areaId, input.areaId),
      ne(schema.eventArea.eventProjectId, input.eventProjectId),
      lt(schema.eventArea.from, input.to),
      gt(schema.eventArea.to, input.from),
    ));
  return { booking, overlaps };
}

export function listEventAreas(db: Db, eventProjectId: string): Promise<EventArea[]> {
  return db.select().from(schema.eventArea).where(eq(schema.eventArea.eventProjectId, eventProjectId));
}

export async function removeEventArea(db: Db, eventAreaId: string): Promise<void> {
  await db.delete(schema.eventArea).where(eq(schema.eventArea.id, eventAreaId));
}
