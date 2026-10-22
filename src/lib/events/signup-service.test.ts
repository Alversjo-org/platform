import { and, eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { cancelSignup, listSignups, signUp } from './signup-service';

describe('signup-service', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'owner', email: 'owner@example.org' }, { id: 'a', email: 'a@example.org' },
      { id: 'b', email: 'b@example.org' }, { id: 'c', email: 'c@example.org' },
    ]);
    await db.insert(schema.project).values({ id: 'e1', slug: 'e1', title: 'Capacity test', kind: 'event', ownerUserId: 'owner', status: 'published', publishedAt: new Date() });
  });

  it('admits sign-ups up to capacity, then waitlists', async () => {
    await db.insert(schema.eventDetails).values({ projectId: 'e1', startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: true, capacity: 2 });
    expect((await signUp(db, { eventProjectId: 'e1', userId: 'a', seats: 1, note: null })).status).toBe('going');
    expect((await signUp(db, { eventProjectId: 'e1', userId: 'b', seats: 1, note: null })).status).toBe('going');
    expect((await signUp(db, { eventProjectId: 'e1', userId: 'c', seats: 1, note: null })).status).toBe('waitlist');
  });

  it('always admits when hasCapacityLimit is false', async () => {
    await db.insert(schema.eventDetails).values({ projectId: 'e1', startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: false });
    for (const id of ['a', 'b', 'c']) expect((await signUp(db, { eventProjectId: 'e1', userId: id, seats: 1, note: null })).status).toBe('going');
  });

  it('cancelling promotes the earliest waitlisted sign-up that now fits', async () => {
    await db.insert(schema.eventDetails).values({ projectId: 'e1', startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: true, capacity: 1 });
    await signUp(db, { eventProjectId: 'e1', userId: 'a', seats: 1, note: null });
    await signUp(db, { eventProjectId: 'e1', userId: 'b', seats: 1, note: null }); // waitlisted
    const { promoted } = await cancelSignup(db, { eventProjectId: 'e1', userId: 'a' });
    expect(promoted.map((p) => p.userId)).toEqual(['b']);
    const [row] = await db.select().from(schema.eventSignup).where(and(eq(schema.eventSignup.eventProjectId, 'e1'), eq(schema.eventSignup.userId, 'b')));
    expect(row.status).toBe('going');
  });

  it('re-signing up after cancelling upserts and resets createdAt to the back of the queue', async () => {
    await db.insert(schema.eventDetails).values({ projectId: 'e1', startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: true, capacity: 1 });
    await signUp(db, { eventProjectId: 'e1', userId: 'a', seats: 1, note: null }); // going
    const firstB = await signUp(db, { eventProjectId: 'e1', userId: 'b', seats: 1, note: null }); // waitlist
    await cancelSignup(db, { eventProjectId: 'e1', userId: 'b' });
    const resignup = await signUp(db, { eventProjectId: 'e1', userId: 'b', seats: 1, note: 'again' });
    expect(resignup.status).toBe('waitlist');
    expect(resignup.signup.createdAt.getTime()).toBeGreaterThan(firstB.signup.createdAt.getTime());
  });

  it('a later sign-up queue-jumps a reset one when both are waitlisted and a seat frees', async () => {
    await db.insert(schema.eventDetails).values({ projectId: 'e1', startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: true, capacity: 1 });
    await signUp(db, { eventProjectId: 'e1', userId: 'a', seats: 1, note: null }); // going
    await signUp(db, { eventProjectId: 'e1', userId: 'b', seats: 1, note: null }); // waitlist, 1st in line
    await signUp(db, { eventProjectId: 'e1', userId: 'c', seats: 1, note: null }); // waitlist, 2nd in line
    await cancelSignup(db, { eventProjectId: 'e1', userId: 'b' });
    await signUp(db, { eventProjectId: 'e1', userId: 'b', seats: 1, note: null }); // re-queued after c, now behind c
    const { promoted } = await cancelSignup(db, { eventProjectId: 'e1', userId: 'a' }); // frees the one seat
    expect(promoted.map((p) => p.userId)).toEqual(['c']);
  });

  it('listSignups returns every row including cancelled', async () => {
    await db.insert(schema.eventDetails).values({ projectId: 'e1', startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: false });
    await signUp(db, { eventProjectId: 'e1', userId: 'a', seats: 1, note: null });
    await cancelSignup(db, { eventProjectId: 'e1', userId: 'a' });
    expect(await listSignups(db, 'e1')).toHaveLength(1);
  });
});
