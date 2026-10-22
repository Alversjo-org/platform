import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import {
  createEvent, EventCreationBlockedError, getProjectBySlug, IncompleteEventError, InvalidTransitionError, transitionStatus,
} from './service';

describe('createEvent', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'u1', email: 'u1@example.org' }, { id: 'blocked', email: 'blocked@example.org', canCreateEvents: false },
    ]);
  });

  it('creates a draft event with the owner as lead', async () => {
    const p = await createEvent(db, { title: 'Sauna build', summary: 'Rebuild the sauna', ownerUserId: 'u1' });
    expect(p).toMatchObject({ title: 'Sauna build', summary: 'Rebuild the sauna', kind: 'event', status: 'draft', visibility: 'members', ownerUserId: 'u1' });
    const [member] = await db.select().from(schema.projectMember).where(eq(schema.projectMember.projectId, p.id));
    expect(member).toMatchObject({ userId: 'u1', role: 'lead' });
  });

  it('dedupes the slug when the title repeats', async () => {
    const a = await createEvent(db, { title: 'Work day', summary: '', ownerUserId: 'u1' });
    const b = await createEvent(db, { title: 'Work day', summary: '', ownerUserId: 'u1' });
    expect(a.slug).toBe('work-day');
    expect(b.slug).not.toBe(a.slug);
    expect(await getProjectBySlug(db, b.slug)).toMatchObject({ id: b.id });
  });

  it('rejects creation for a user with canCreateEvents=false', async () => {
    await expect(createEvent(db, { title: 'X', summary: '', ownerUserId: 'blocked' })).rejects.toBeInstanceOf(EventCreationBlockedError);
  });
});

describe('transitionStatus', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
  });

  async function draftEventWithDetailsAndArea(db: Db) {
    const p = await createEvent(db, { title: 'Ready event', summary: '', ownerUserId: 'u1' });
    await db.insert(schema.eventDetails).values({ projectId: p.id, startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: false });
    await db.insert(schema.area).values({ id: 'a1', name: 'Kitchen' });
    await db.insert(schema.eventArea).values({ id: 'ea1', eventProjectId: p.id, areaId: 'a1', from: new Date(), to: new Date() });
    return p;
  }

  it('publishes a complete draft and records publishedAt + a decision log row', async () => {
    const p = await draftEventWithDetailsAndArea(db);
    const published = await transitionStatus(db, { projectId: p.id, to: 'published', actorUserId: 'u1' });
    expect(published.status).toBe('published');
    expect(published.publishedAt).not.toBeNull();
    const [log] = await db.select().from(schema.decisionLog).where(eq(schema.decisionLog.entityId, p.id));
    expect(log).toMatchObject({ entity: 'project', action: 'status_change' });
  });

  it('rejects publishing a draft with no event_details', async () => {
    const p = await createEvent(db, { title: 'Bare', summary: '', ownerUserId: 'u1' });
    await expect(transitionStatus(db, { projectId: p.id, to: 'published', actorUserId: 'u1' })).rejects.toBeInstanceOf(IncompleteEventError);
  });

  it('rejects publishing a draft with no area booked', async () => {
    const p = await createEvent(db, { title: 'No area', summary: '', ownerUserId: 'u1' });
    await db.insert(schema.eventDetails).values({ projectId: p.id, startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: false });
    await expect(transitionStatus(db, { projectId: p.id, to: 'published', actorUserId: 'u1' })).rejects.toBeInstanceOf(IncompleteEventError);
  });

  it('rejects a transition not in ALLOWED_TRANSITIONS', async () => {
    const p = await createEvent(db, { title: 'Draft only', summary: '', ownerUserId: 'u1' });
    await expect(transitionStatus(db, { projectId: p.id, to: 'cancelled', actorUserId: 'u1' })).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});
