import { and, asc, eq, ne } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { EventSignup, SignupStatus } from '@/db/schema';
import { logDecision } from '@/lib/decision-log';
import { ProjectNotFoundError } from '@/lib/projects/service';

export type SignupResult = { status: 'going' | 'waitlist'; signup: EventSignup };

export class SignupNotOpenError extends Error {
  constructor() { super('Sign-up is not open for this event'); this.name = 'SignupNotOpenError'; }
}

export async function signUp(
  db: Db,
  input: { eventProjectId: string; userId: string; seats: number; note: string | null },
): Promise<SignupResult> {
  return db.transaction(async (tx) => {
    const [project] = await tx.select().from(schema.project).where(eq(schema.project.id, input.eventProjectId));
    if (!project) throw new ProjectNotFoundError(input.eventProjectId);
    const [details] = await tx.select().from(schema.eventDetails).where(eq(schema.eventDetails.projectId, input.eventProjectId)).for('update');
    if (!details) throw new ProjectNotFoundError(input.eventProjectId);
    if (project.status !== 'published') throw new SignupNotOpenError();
    const now = new Date();
    const opensAt = details.signupOpensAt ?? project.publishedAt;
    const closesAt = details.signupClosesAt ?? details.startsAt;
    if ((opensAt && now < opensAt) || (closesAt && now > closesAt)) throw new SignupNotOpenError();
    let status: SignupStatus = 'going';
    if (details.hasCapacityLimit) {
      const others = await tx.select({ seats: schema.eventSignup.seats }).from(schema.eventSignup)
        .where(and(
          eq(schema.eventSignup.eventProjectId, input.eventProjectId),
          eq(schema.eventSignup.status, 'going'),
          ne(schema.eventSignup.userId, input.userId),
        ));
      const total = others.reduce((sum, o) => sum + o.seats, 0);
      status = total + input.seats <= details.capacity! ? 'going' : 'waitlist';
    }
    const [row] = await tx.insert(schema.eventSignup)
      .values({ eventProjectId: input.eventProjectId, userId: input.userId, status, seats: input.seats, note: input.note, createdAt: now })
      .onConflictDoUpdate({
        target: [schema.eventSignup.eventProjectId, schema.eventSignup.userId],
        set: { status, seats: input.seats, note: input.note, createdAt: now },
      })
      .returning();
    await logDecision(tx as unknown as Db, {
      entity: 'event_signup', entityId: `${input.eventProjectId}:${input.userId}`, actorUserId: input.userId, action: status, diff: { status },
    });
    return { status, signup: row };
  });
}

export async function cancelSignup(db: Db, input: { eventProjectId: string; userId: string }): Promise<{ promoted: EventSignup[] }> {
  return db.transaction(async (tx) => {
    const [details] = await tx.select().from(schema.eventDetails).where(eq(schema.eventDetails.projectId, input.eventProjectId)).for('update');
    if (!details) throw new ProjectNotFoundError(input.eventProjectId);
    const [existing] = await tx.select().from(schema.eventSignup)
      .where(and(eq(schema.eventSignup.eventProjectId, input.eventProjectId), eq(schema.eventSignup.userId, input.userId)));
    if (!existing || existing.status === 'cancelled') return { promoted: [] };
    await tx.update(schema.eventSignup).set({ status: 'cancelled' })
      .where(and(eq(schema.eventSignup.eventProjectId, input.eventProjectId), eq(schema.eventSignup.userId, input.userId)));
    await logDecision(tx as unknown as Db, {
      entity: 'event_signup', entityId: `${input.eventProjectId}:${input.userId}`, actorUserId: input.userId, action: 'cancelled', diff: {},
    });
    if (existing.status !== 'going' || !details.hasCapacityLimit) return { promoted: [] };
    const goingSeats = (await tx.select({ seats: schema.eventSignup.seats }).from(schema.eventSignup)
      .where(and(eq(schema.eventSignup.eventProjectId, input.eventProjectId), eq(schema.eventSignup.status, 'going'))))
      .reduce((sum, r) => sum + r.seats, 0);
    let remaining = details.capacity! - goingSeats;
    if (remaining <= 0) return { promoted: [] };
    const waitlisted = await tx.select().from(schema.eventSignup)
      .where(and(eq(schema.eventSignup.eventProjectId, input.eventProjectId), eq(schema.eventSignup.status, 'waitlist')))
      .orderBy(asc(schema.eventSignup.createdAt));
    const promoted: EventSignup[] = [];
    for (const w of waitlisted) {
      if (w.seats > remaining) continue;
      await tx.update(schema.eventSignup).set({ status: 'going' })
        .where(and(eq(schema.eventSignup.eventProjectId, input.eventProjectId), eq(schema.eventSignup.userId, w.userId)));
      remaining -= w.seats;
      promoted.push({ ...w, status: 'going' });
    }
    return { promoted };
  });
}

export function listSignups(db: Db, eventProjectId: string): Promise<EventSignup[]> {
  return db.select().from(schema.eventSignup).where(eq(schema.eventSignup.eventProjectId, eventProjectId)).orderBy(asc(schema.eventSignup.createdAt));
}
