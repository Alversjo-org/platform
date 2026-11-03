import { and, asc, eq, gte, inArray } from 'drizzle-orm';
import { schema, type Db } from '@/db';

export type EventSummary = {
  slug: string;
  title: string;
  startsAt: Date;
  endsAt: Date;
  /** Names of the areas it books, in booking order. */
  areas: string[];
  /** Seats taken by people going (not the waitlist). */
  going: number;
};

type EventCore = { id: string; slug: string; title: string; startsAt: Date; endsAt: Date };

/** Adds booked area names and going seats to events, keeping their order. */
export async function summarizeEvents(db: Db, events: EventCore[]): Promise<EventSummary[]> {
  if (events.length === 0) return [];
  const ids = events.map((e) => e.id);
  const areaRows = await db
    .select({ eventId: schema.eventArea.eventProjectId, name: schema.area.name })
    .from(schema.eventArea)
    .innerJoin(schema.area, eq(schema.area.id, schema.eventArea.areaId))
    .where(inArray(schema.eventArea.eventProjectId, ids))
    .orderBy(asc(schema.eventArea.from));
  const signupRows = await db
    .select({ eventId: schema.eventSignup.eventProjectId, seats: schema.eventSignup.seats })
    .from(schema.eventSignup)
    .where(and(inArray(schema.eventSignup.eventProjectId, ids), eq(schema.eventSignup.status, 'going')));

  return events.map((e) => ({
    slug: e.slug,
    title: e.title,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    areas: [...new Set(areaRows.filter((a) => a.eventId === e.id).map((a) => a.name))],
    going: signupRows.filter((s) => s.eventId === e.id).reduce((sum, s) => sum + s.seats, 0),
  }));
}

const eventColumns = {
  id: schema.project.id, slug: schema.project.slug, title: schema.project.title,
  startsAt: schema.eventDetails.startsAt, endsAt: schema.eventDetails.endsAt,
};

/** Every published event, soonest first. */
export async function listPublishedEvents(db: Db): Promise<EventSummary[]> {
  const events = await db.select(eventColumns)
    .from(schema.project)
    .innerJoin(schema.eventDetails, eq(schema.eventDetails.projectId, schema.project.id))
    .where(and(eq(schema.project.kind, 'event'), eq(schema.project.status, 'published')))
    .orderBy(asc(schema.eventDetails.startsAt));
  return summarizeEvents(db, events);
}

/** The next `limit` published events that haven't started. */
export async function listComingUp(db: Db, now: Date, limit = 3): Promise<EventSummary[]> {
  const events = await db.select(eventColumns)
    .from(schema.project)
    .innerJoin(schema.eventDetails, eq(schema.eventDetails.projectId, schema.project.id))
    .where(and(eq(schema.project.kind, 'event'), eq(schema.project.status, 'published'), gte(schema.eventDetails.startsAt, now)))
    .orderBy(asc(schema.eventDetails.startsAt))
    .limit(limit);
  return summarizeEvents(db, events);
}
