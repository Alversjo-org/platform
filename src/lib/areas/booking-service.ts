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

/** Books several areas at once for the same time span (e.g. the event's own start/end), with no per-area setup note. */
export async function bookEventAreas(
  db: Db,
  input: { eventProjectId: string; areaIds: string[]; from: Date; to: Date },
): Promise<{ bookings: EventArea[]; overlaps: AreaOverlapWarning[] }> {
  return db.transaction(async (tx) => {
    const bookings: EventArea[] = [];
    const overlaps: AreaOverlapWarning[] = [];
    for (const areaId of input.areaIds) {
      const result = await bookEventArea(tx, { eventProjectId: input.eventProjectId, areaId, from: input.from, to: input.to, setupNote: null });
      bookings.push(result.booking);
      overlaps.push(...result.overlaps);
    }
    return { bookings, overlaps };
  });
}

export function listEventAreas(db: Db, eventProjectId: string): Promise<EventArea[]> {
  return db.select().from(schema.eventArea).where(eq(schema.eventArea.eventProjectId, eventProjectId));
}

export type UpcomingAreaBooking = { areaId: string; eventProjectId: string; eventSlug: string; eventTitle: string; from: Date; to: Date };

export async function listUpcomingAreaBookings(db: Db, now: Date): Promise<UpcomingAreaBooking[]> {
  return db.select({
    areaId: schema.eventArea.areaId, eventProjectId: schema.eventArea.eventProjectId,
    eventSlug: schema.project.slug, eventTitle: schema.project.title,
    from: schema.eventArea.from, to: schema.eventArea.to,
  }).from(schema.eventArea)
    .innerJoin(schema.project, eq(schema.project.id, schema.eventArea.eventProjectId))
    .where(and(gt(schema.eventArea.to, now), eq(schema.project.status, 'published')))
    .orderBy(schema.eventArea.from);
}

export async function removeEventArea(db: Db, input: { eventAreaId: string; eventProjectId: string }): Promise<void> {
  await db.delete(schema.eventArea)
    .where(and(eq(schema.eventArea.id, input.eventAreaId), eq(schema.eventArea.eventProjectId, input.eventProjectId)));
}
