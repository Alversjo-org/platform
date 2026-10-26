import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import {
  createEvent, duplicateEvent, EventCreationBlockedError, getProjectBySlug, IncompleteEventError, InvalidTransitionError,
  listDraftEventsForUser, transitionStatus,
} from './service';

async function draftEventWithDetailsAndArea(db: Db) {
  const p = await createEvent(db, { title: 'Ready event', summary: '', ownerUserId: 'u1' });
  await db.insert(schema.eventDetails).values({ projectId: p.id, startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: false });
  await db.insert(schema.area).values({ id: 'a1', name: 'Kitchen' });
  await db.insert(schema.eventArea).values({ id: 'ea1', eventProjectId: p.id, areaId: 'a1', from: new Date(), to: new Date() });
  return p;
}

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

  it('accepts an optional body at creation time', async () => {
    const p = await createEvent(db, { title: 'With body', summary: '', body: 'Full details here', ownerUserId: 'u1' });
    expect(p.body).toBe('Full details here');
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

  it('publishes a draft with event_details but no area booked (areas are optional)', async () => {
    const p = await createEvent(db, { title: 'No area', summary: '', ownerUserId: 'u1' });
    await db.insert(schema.eventDetails).values({ projectId: p.id, startsAt: new Date(), endsAt: new Date(), hasCapacityLimit: false });
    const published = await transitionStatus(db, { projectId: p.id, to: 'published', actorUserId: 'u1' });
    expect(published.status).toBe('published');
  });

  it('rejects a transition not in ALLOWED_TRANSITIONS', async () => {
    const p = await createEvent(db, { title: 'Draft only', summary: '', ownerUserId: 'u1' });
    await expect(transitionStatus(db, { projectId: p.id, to: 'cancelled', actorUserId: 'u1' })).rejects.toBeInstanceOf(InvalidTransitionError);
  });
});

describe('duplicateEvent', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
  });

  it('copies meta and organisers, not areas or signups, and starts in draft', async () => {
    const source = await draftEventWithDetailsAndArea(db);
    const dup = await duplicateEvent(db, { sourceProjectId: source.id, actorUserId: 'u1' });
    expect(dup.status).toBe('draft');
    expect(dup.title).toBe(source.title);
    expect(dup.slug).not.toBe(source.slug);
    const members = await db.select().from(schema.projectMember).where(eq(schema.projectMember.projectId, dup.id));
    expect(members.map((m) => m.userId)).toEqual(['u1']);
    expect(await db.select().from(schema.eventArea).where(eq(schema.eventArea.eventProjectId, dup.id))).toEqual([]);
  });

  it('rejects for a user whose canCreateEvents is false', async () => {
    const source = await createEvent(db, { title: 'X', summary: '', ownerUserId: 'u1' });
    await db.update(schema.user).set({ canCreateEvents: false }).where(eq(schema.user.id, 'u1'));
    await expect(duplicateEvent(db, { sourceProjectId: source.id, actorUserId: 'u1' })).rejects.toBeInstanceOf(EventCreationBlockedError);
  });
});

describe('listDraftEventsForUser', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'u1', email: 'u1@example.org' },
      { id: 'u2', email: 'u2@example.org' },
      { id: 'admin', email: 'admin@example.org' },
    ]);
    await db.insert(schema.userRole).values({ userId: 'admin', role: 'member-admin' });
  });

  it('returns a draft the user organises, with details null when none exist yet', async () => {
    const p = await createEvent(db, { title: 'No details yet', summary: '', ownerUserId: 'u1' });
    const rows = await listDraftEventsForUser(db, 'u1');
    expect(rows).toHaveLength(1);
    expect(rows[0].project).toMatchObject({ id: p.id, status: 'draft' });
    expect(rows[0].details).toBeNull();
  });

  it('includes event_details when present', async () => {
    const p = await draftEventWithDetailsAndArea(db);
    const [row] = await listDraftEventsForUser(db, 'u1');
    expect(row.details).toMatchObject({ projectId: p.id });
  });

  it("does not return another organiser's draft", async () => {
    await createEvent(db, { title: 'u1 only', summary: '', ownerUserId: 'u1' });
    expect(await listDraftEventsForUser(db, 'u2')).toEqual([]);
  });

  it('does not return a draft to a member-admin who is not an organiser on it', async () => {
    await createEvent(db, { title: 'u1 only', summary: '', ownerUserId: 'u1' });
    expect(await listDraftEventsForUser(db, 'admin')).toEqual([]);
  });

  it('excludes a published event', async () => {
    const p = await draftEventWithDetailsAndArea(db);
    await transitionStatus(db, { projectId: p.id, to: 'published', actorUserId: 'u1' });
    expect(await listDraftEventsForUser(db, 'u1')).toEqual([]);
  });
});
