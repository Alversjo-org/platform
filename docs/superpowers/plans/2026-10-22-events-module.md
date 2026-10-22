# Events module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship projects/events as a real entity: create, edit, publish, cancel/close an event; book areas with an advisory overlap warning; sign up with waitlist; duplicate a past event as a starting point; an iCal feed. Members-only throughout, no money.

**Architecture:** A generic `project` table (only `kind='event'` gets UI this pass) plus `event_details`/`area`/`event_area`/`event_signup` satellite tables, following the repo's existing `service.ts` (pure DB functions, typed errors) + route `actions.ts` (`'use server'`, FormData, `requireX()`, redirect) + `page.tsx` (server component, `AppShell`) layering, as used by the membership-management feature.

**Tech Stack:** Next.js 16 App Router, Drizzle on Postgres/PGlite, vitest, Resend (console fallback without `RESEND_API_KEY`).

**Spec:** `docs/superpowers/specs/2026-10-22-events-module-design.md`

## Global Constraints

- `price_sek` and every `_sek`-suffixed amount field holds whole öre as an integer — never a float (spec §3).
- Status transitions are exactly: `draft→published`, `draft→archived`, `published→cancelled`, `published→closed`, `cancelled→archived`, `closed→archived`. No other transition is valid (spec §3).
- `event_signup`'s primary key is `(event_project_id, user_id)`; re-signing up after cancelling is an upsert that resets `created_at` (spec §5) — this is also how editing an in-progress signup works, so `signUp` must be safe to call on an existing row in any status.
- `event_details.capacity` is `NULL` if and only if `has_capacity_limit = false` (spec §5); this invariant is enforced in code, not a DB `CHECK`.
- `canCreateEvents` defaults to `true`; only `member-admin`/`admin` can turn it off for someone (spec §2).
- `project.visibility` defaults to `'members'`; the create/edit UI only ever offers `'members'` this pass — no unauthenticated route is added anywhere (spec §1, §6).
- Area double-booking is advisory only: it is surfaced as a warning and the save still succeeds. No DB exclusion constraint, no row lock on `area` (spec §4).
- No payment processing is added. `priceSek`/`priceNote` are informational display fields only.
- Follow existing repo conventions exactly: service functions are `(db: Db, input) => Promise<T>` throwing a named `Error` subclass; `'use server'` actions parse `FormData`, call a service function, `revalidatePath`, then `redirect`; ids are `randomUUID()` from `node:crypto`; tests live beside the module as `*.test.ts` using `createDb('pglite://memory')`.

## Review Focus

- Two members signing up as the last seat frees up both landing on `going` (oversold capacity) instead of one going/one waitlisted.
- A `cocreator` successfully publishing, cancelling, closing, or editing the organiser list of an event — those are `lead`-only per the authorization matrix (spec §2), and it's easy to wire a new action without the check.
- Publishing an event that has no `event_details` row or no area booked still succeeds, because the publish path only checked the status-transition table and not completeness.
- A member with `canCreateEvents = false` still creating an event via "duplicate as new event," because that path is a different code entry point than the plain create form and the check was only added to one of them.
- `/events/members.ics` with a missing, malformed, or unknown token returning every event (or a 500) instead of an empty/404 response.

---

## Task 1: Schema & migration

**Files:**
- Modify: `src/db/schema.ts`
- Test: none (schema correctness is proven by the migration generating cleanly and by every later task's tests running against it)

**Interfaces:**
- Produces: tables `project`, `projectMember`, `eventDetails`, `area`, `eventArea`, `eventSignup`, `decisionLog`; new `user` columns `canCreateEvents`, `icalToken`; exported types `ProjectKind`, `ProjectStatus`, `ProjectVisibility`, `ProjectMemberRole`, `SignupStatus`, `Project`, `ProjectMember`, `EventDetails`, `Area`, `EventArea`, `EventSignup`, `DecisionLog`.

- [ ] **Step 1: Add the new types, tables and `user` columns to `src/db/schema.ts`**

```ts
export type ProjectKind = 'event' | 'ongoing' | 'build' | 'purchase';
export type ProjectStatus = 'draft' | 'published' | 'cancelled' | 'closed' | 'archived';
export type ProjectVisibility = 'members' | 'public';
export type ProjectMemberRole = 'lead' | 'cocreator';
export type SignupStatus = 'going' | 'waitlist' | 'cancelled';

export const project = pgTable('project', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  title: text('title').notNull(),
  summary: text('summary').notNull().default(''),
  body: text('body').notNull().default(''),
  kind: text('kind', { enum: ['event', 'ongoing', 'build', 'purchase'] }).$type<ProjectKind>().notNull(),
  status: text('status', { enum: ['draft', 'published', 'cancelled', 'closed', 'archived'] }).$type<ProjectStatus>().notNull().default('draft'),
  visibility: text('visibility', { enum: ['members', 'public'] }).$type<ProjectVisibility>().notNull().default('members'),
  ownerUserId: text('owner_user_id').notNull().references(() => user.id),
  publishedAt: timestamp('published_at'), // set once, on draft->published; drives the signup-window default (§5 of the spec says "open from publishing until the start")
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const projectMember = pgTable('project_member', {
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['lead', 'cocreator'] }).$type<ProjectMemberRole>().notNull(),
}, (t) => [primaryKey({ columns: [t.projectId, t.userId] })]);

export const eventDetails = pgTable('event_details', {
  projectId: text('project_id').primaryKey().references(() => project.id, { onDelete: 'cascade' }),
  startsAt: timestamp('starts_at').notNull(),
  endsAt: timestamp('ends_at').notNull(),
  hasCapacityLimit: boolean('has_capacity_limit').notNull(),
  capacity: integer('capacity'), // NULL iff !hasCapacityLimit
  signupOpensAt: timestamp('signup_opens_at'),
  signupClosesAt: timestamp('signup_closes_at'), // null = until startsAt
  priceSek: integer('price_sek').notNull().default(0), // whole öre; informational only, never booked
  priceNote: text('price_note'),
  contactNote: text('contact_note'),
  showSignupsToParticipants: boolean('show_signups_to_participants').notNull().default(false),
});

export const area = pgTable('area', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  capacity: integer('capacity'), // advisory only
  bookable: boolean('bookable').notNull().default(true),
  mapRef: text('map_ref'),
});

export const eventArea = pgTable('event_area', {
  id: text('id').primaryKey(),
  eventProjectId: text('event_project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  areaId: text('area_id').notNull().references(() => area.id),
  from: timestamp('from').notNull(),
  to: timestamp('to').notNull(),
  setupNote: text('setup_note'),
}, (t) => [index('event_area_area_time_idx').on(t.areaId, t.from, t.to)]);

export const eventSignup = pgTable('event_signup', {
  eventProjectId: text('event_project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['going', 'waitlist', 'cancelled'] }).$type<SignupStatus>().notNull(),
  seats: integer('seats').notNull().default(1),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventProjectId, t.userId] })]);

export const decisionLog = pgTable('decision_log', {
  id: text('id').primaryKey(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  actorUserId: text('actor_user_id').notNull().references(() => user.id),
  action: text('action').notNull(),
  diff: text('diff').notNull(), // JSON string
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type Project = typeof project.$inferSelect;
export type ProjectMember = typeof projectMember.$inferSelect;
export type EventDetails = typeof eventDetails.$inferSelect;
export type Area = typeof area.$inferSelect;
export type EventArea = typeof eventArea.$inferSelect;
export type EventSignup = typeof eventSignup.$inferSelect;
export type DecisionLog = typeof decisionLog.$inferSelect;
```

Add to the `user` table: `canCreateEvents: boolean('can_create_events').notNull().default(true)`, `icalToken: text('ical_token').unique()`. Add `index` to the existing `drizzle-orm/pg-core` import alongside `boolean`, `pgTable`, etc.

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file under `drizzle/` creating the seven tables and the two `user` columns; no errors.

- [ ] **Step 3: Verify the CI gate passes**

Run: `npm run db:check`
Expected: exits 0 (the generated migration is already committed, so re-generating produces no diff).

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add project/event/area/signup schema"
```

## Task 2: Shared helpers — slug & decision log

**Files:**
- Create: `src/lib/slug.ts`
- Create: `src/lib/slug.test.ts`
- Create: `src/lib/decision-log.ts`
- Create: `src/lib/decision-log.test.ts`

**Interfaces:**
- Produces: `slugify(title: string): string`; `logDecision(db: Db, entry: { entity: string; entityId: string; actorUserId: string; action: string; diff: unknown }): Promise<void>`.

- [ ] **Step 1: Write failing tests for `slugify`**

```ts
import { describe, expect, it } from 'vitest';
import { slugify } from './slug';

describe('slugify', () => {
  it('lowercases and dashes words', () => {
    expect(slugify('Midsommar Work Weekend')).toBe('midsommar-work-weekend');
  });
  it('keeps non-ASCII letters', () => {
    expect(slugify('Midsommarfest på Alversjö!')).toBe('midsommarfest-på-alversjö');
  });
  it('collapses repeated punctuation and trims leading/trailing dashes', () => {
    expect(slugify('  -- Build day: kitchen & sauna --  ')).toBe('build-day-kitchen-sauna');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/slug.test.ts`
Expected: FAIL — `slugify` not defined.

- [ ] **Step 3: Implement `slugify(title: string): string` in `src/lib/slug.ts`**

Lowercase, replace runs of anything that isn't a Unicode letter or digit
(`/[^\p{L}\p{N}]+/gu`) with a single `-`, then strip leading/trailing `-`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/slug.test.ts`
Expected: PASS

- [ ] **Step 5: Write a failing test for `logDecision`**

```ts
import { eq } from 'drizzle-orm';
import { describe, expect, it, beforeEach } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { logDecision } from './decision-log';

describe('logDecision', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
  });

  it('writes one row with the diff serialized as JSON', async () => {
    await logDecision(db, { entity: 'project', entityId: 'p1', actorUserId: 'u1', action: 'status_change', diff: { from: 'draft', to: 'published' } });
    const [row] = await db.select().from(schema.decisionLog).where(eq(schema.decisionLog.entityId, 'p1'));
    expect(row).toMatchObject({ entity: 'project', entityId: 'p1', actorUserId: 'u1', action: 'status_change' });
    expect(JSON.parse(row.diff)).toEqual({ from: 'draft', to: 'published' });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/lib/decision-log.test.ts`
Expected: FAIL — `logDecision` not defined.

- [ ] **Step 7: Implement `logDecision` in `src/lib/decision-log.ts`**

```ts
export async function logDecision(db: Db, entry: { entity: string; entityId: string; actorUserId: string; action: string; diff: unknown }): Promise<void> {
  await db.insert(schema.decisionLog).values({
    id: randomUUID(), entity: entry.entity, entityId: entry.entityId,
    actorUserId: entry.actorUserId, action: entry.action, diff: JSON.stringify(entry.diff),
  });
}
```

- [ ] **Step 8: Run both test files to verify they pass**

Run: `npx vitest run src/lib/slug.test.ts src/lib/decision-log.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/slug.ts src/lib/slug.test.ts src/lib/decision-log.ts src/lib/decision-log.test.ts
git commit -m "feat: add slugify and decision-log helpers"
```

## Task 3: Project authorization helpers

**Files:**
- Create: `src/lib/projects/authorization.ts`
- Create: `src/lib/projects/authorization.test.ts`

**Interfaces:**
- Consumes: `schema.projectMember`, `SessionUser` (`@/lib/session`), `isMemberAdmin` (`@/lib/session`).
- Produces: `class NotAuthorizedError extends Error`; `getEventRole(db: Db, projectId: string, user: SessionUser): Promise<'lead' | 'cocreator' | 'override' | null>`; `assertEventPermission(db: Db, projectId: string, user: SessionUser, permission: 'editDetails' | 'manage'): Promise<void>` — used by every later task's event mutation actions. `'editDetails'` = edit title/body/event details/areas; `'manage'` = organiser list and status transitions (publish/cancel/close/archive).

- [ ] **Step 1: Write failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import type { SessionUser } from '@/lib/session';
import { assertEventPermission, getEventRole, NotAuthorizedError } from './authorization';

describe('event authorization', () => {
  let db: Db;
  const lead: SessionUser = { id: 'lead1', email: 'lead@example.org', role: 'member' };
  const cocreator: SessionUser = { id: 'co1', email: 'co@example.org', role: 'member' };
  const stranger: SessionUser = { id: 'stranger1', email: 'stranger@example.org', role: 'member' };
  const admin: SessionUser = { id: 'admin1', email: 'admin@example.org', role: 'admin' };

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'lead1', email: 'lead@example.org' }, { id: 'co1', email: 'co@example.org' },
      { id: 'stranger1', email: 'stranger@example.org' }, { id: 'admin1', email: 'admin@example.org', role: 'admin' },
    ]);
    await db.insert(schema.project).values({ id: 'p1', slug: 'p1', title: 'Test', kind: 'event', ownerUserId: 'lead1' });
    await db.insert(schema.projectMember).values([
      { projectId: 'p1', userId: 'lead1', role: 'lead' }, { projectId: 'p1', userId: 'co1', role: 'cocreator' },
    ]);
  });

  it('getEventRole returns the project_member role, "override" for admin, or null for a stranger', async () => {
    expect(await getEventRole(db, 'p1', lead)).toBe('lead');
    expect(await getEventRole(db, 'p1', cocreator)).toBe('cocreator');
    expect(await getEventRole(db, 'p1', admin)).toBe('override');
    expect(await getEventRole(db, 'p1', stranger)).toBeNull();
  });

  it('a lead and an admin/member-admin can editDetails and manage', async () => {
    await expect(assertEventPermission(db, 'p1', lead, 'editDetails')).resolves.toBeUndefined();
    await expect(assertEventPermission(db, 'p1', lead, 'manage')).resolves.toBeUndefined();
    await expect(assertEventPermission(db, 'p1', admin, 'manage')).resolves.toBeUndefined();
  });

  it('a cocreator can editDetails but not manage', async () => {
    await expect(assertEventPermission(db, 'p1', cocreator, 'editDetails')).resolves.toBeUndefined();
    await expect(assertEventPermission(db, 'p1', cocreator, 'manage')).rejects.toBeInstanceOf(NotAuthorizedError);
  });

  it('a stranger can do neither', async () => {
    await expect(assertEventPermission(db, 'p1', stranger, 'editDetails')).rejects.toBeInstanceOf(NotAuthorizedError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projects/authorization.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/projects/authorization.ts`**

```ts
export class NotAuthorizedError extends Error { constructor(action: string) { super(`Not authorized to ${action}`); this.name = 'NotAuthorizedError'; } }

export async function getEventRole(db: Db, projectId: string, user: SessionUser): Promise<'lead' | 'cocreator' | 'override' | null> {
  if (isMemberAdmin(user)) return 'override';
  const [row] = await db.select().from(schema.projectMember)
    .where(and(eq(schema.projectMember.projectId, projectId), eq(schema.projectMember.userId, user.id)));
  return row?.role ?? null;
}

export async function assertEventPermission(db: Db, projectId: string, user: SessionUser, permission: 'editDetails' | 'manage'): Promise<void> {
  const role = await getEventRole(db, projectId, user);
  const allowed = role === 'override' || role === 'lead' || (role === 'cocreator' && permission === 'editDetails');
  if (!allowed) throw new NotAuthorizedError(permission);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/projects/authorization.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects/authorization.ts src/lib/projects/authorization.test.ts
git commit -m "feat: add event authorization helpers"
```

## Task 4: Project service — create, edit meta, status machine

**Files:**
- Create: `src/lib/projects/service.ts`
- Create: `src/lib/projects/service.test.ts`

**Interfaces:**
- Consumes: `slugify` (Task 2), `logDecision` (Task 2).
- Produces: `class ProjectNotFoundError`, `class EventCreationBlockedError`, `class InvalidTransitionError`, `class IncompleteEventError`; `ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]>`; `createEvent(db, { title: string; summary: string; ownerUserId: string }): Promise<Project>`; `updateProjectMeta(db, { projectId: string; title: string; summary: string; body: string }): Promise<Project>`; `getProject(db, projectId: string): Promise<Project>`; `getProjectBySlug(db, slug: string): Promise<Project | null>`; `transitionStatus(db, { projectId: string; to: ProjectStatus; actorUserId: string }): Promise<Project>`. Later tasks call `getEventRole`/`assertEventPermission` (Task 3) themselves at the action layer before calling these — this service does not re-check authorization.

- [ ] **Step 1: Write failing tests for `createEvent` and slug uniqueness**

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { createEvent, EventCreationBlockedError, getProjectBySlug } from './service';

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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projects/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createEvent`, `getProject`, `getProjectBySlug`, `updateProjectMeta` in `src/lib/projects/service.ts`**

`createEvent` loads the `user` row, throws `EventCreationBlockedError` if `!canCreateEvents`; computes `const base = slugify(input.title)` then an internal `uniqueSlug(db, base)` that appends `-2`, `-3`, ... until `getProjectBySlug` returns null; inserts the `project` row (`kind: 'event'`, `status: 'draft'`, `visibility: 'members'`) and the `projectMember` row (`role: 'lead'`) in one `db.transaction`. `updateProjectMeta` updates `title`/`summary`/`body` only — the slug is fixed at creation and never recalculated.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/projects/service.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for `transitionStatus`**

```ts
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
```

- [ ] **Step 6: Run to verify it fails**

Run: `npx vitest run src/lib/projects/service.test.ts`
Expected: FAIL — `transitionStatus` not defined.

- [ ] **Step 7: Implement `ALLOWED_TRANSITIONS` and `transitionStatus`**

```ts
export const ALLOWED_TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  draft: ['published', 'archived'],
  published: ['cancelled', 'closed'],
  cancelled: ['archived'],
  closed: ['archived'],
  archived: [],
};

export async function transitionStatus(db: Db, input: { projectId: string; to: ProjectStatus; actorUserId: string }): Promise<Project> {
  const current = await getProject(db, input.projectId);
  if (!ALLOWED_TRANSITIONS[current.status].includes(input.to)) throw new InvalidTransitionError(current.status, input.to);
  if (input.to === 'published') {
    const [details] = await db.select().from(schema.eventDetails).where(eq(schema.eventDetails.projectId, input.projectId));
    if (!details) throw new IncompleteEventError('missing event details');
    const [anyArea] = await db.select().from(schema.eventArea).where(eq(schema.eventArea.eventProjectId, input.projectId));
    if (!anyArea) throw new IncompleteEventError('no area booked');
  }
  const [row] = await db.update(schema.project)
    .set({ status: input.to, publishedAt: input.to === 'published' ? new Date() : current.publishedAt, updatedAt: new Date() })
    .where(eq(schema.project.id, input.projectId)).returning();
  await logDecision(db, { entity: 'project', entityId: input.projectId, actorUserId: input.actorUserId, action: 'status_change', diff: { from: current.status, to: input.to } });
  return row;
}
```

- [ ] **Step 8: Run full file to verify it passes**

Run: `npx vitest run src/lib/projects/service.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/projects/service.ts src/lib/projects/service.test.ts
git commit -m "feat: add project service with status machine"
```

## Task 5: `canCreateEvents` toggle

**Files:**
- Modify: `src/lib/members/service.ts` (add `setCanCreateEvents`)
- Modify: `src/lib/members/service.test.ts`
- Modify: `src/app/members/[id]/page.tsx` (one more checkbox, mirroring `isActiveMember`)
- Modify: `src/app/members/actions.ts` (extend `updateMemberAction` to read/pass it) — or add a second tiny action; extending `updateMemberAction` is simpler and matches how `isActiveMember` is already just another checkbox on the same form.
- Modify: `src/app/members/page.tsx` (optional: show a badge/column — not required; skip if it doesn't fit the existing table without crowding)

**Interfaces:**
- Produces: `setCanCreateEvents(db: Db, input: { id: string; canCreateEvents: boolean }): Promise<User>` (exported separately from `updateMember` so Task 9/10's `createEvent` tests don't need the full member-admin edit form).

- [ ] **Step 1: Write a failing test**

```ts
it('setCanCreateEvents flips the flag', async () => {
  const updated = await setCanCreateEvents(db, { id: 'viktor', canCreateEvents: false });
  expect(updated.canCreateEvents).toBe(false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/members/service.test.ts`
Expected: FAIL — `setCanCreateEvents` not defined.

- [ ] **Step 3: Implement `setCanCreateEvents` in `src/lib/members/service.ts`**

Same shape as `clearAvatar`: `db.update(schema.user).set({ canCreateEvents: input.canCreateEvents }).where(eq(schema.user.id, input.id)).returning()`, throw `UserNotFoundError` if no row.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/members/service.test.ts`
Expected: PASS

- [ ] **Step 5: Wire it into the member edit form**

In `src/app/members/[id]/page.tsx`, add a checkbox next to `isActiveMember`:
`<div className="flex items-center gap-2"><Checkbox id="canCreateEvents" name="canCreateEvents" defaultChecked={member.canCreateEvents} /><Label htmlFor="canCreateEvents">Can create events</Label></div>`.
In `src/app/members/actions.ts`, extend `updateMemberAction`'s call into `updateMember` — add `canCreateEvents: formData.get('canCreateEvents') !== null` to the input, and add the matching field to `updateMember`'s `input` type and `.set()` call in `src/lib/members/service.ts`.

- [ ] **Step 6: Manually verify**

Run: `npm run dev`, log in as a member-admin, open `/members/<id>`, toggle "Can create events," save, reload, confirm it persisted.

- [ ] **Step 7: Commit**

```bash
git add src/lib/members/service.ts src/lib/members/service.test.ts src/app/members/[id]/page.tsx src/app/members/actions.ts
git commit -m "feat: let member-admins block a member from creating events"
```

## Task 6: Event details service

**Files:**
- Create: `src/lib/events/details-service.ts`
- Create: `src/lib/events/details-service.test.ts`

**Interfaces:**
- Produces: `class InvalidCapacityError`; `upsertEventDetails(db, input: { projectId: string; startsAt: Date; endsAt: Date; hasCapacityLimit: boolean; capacity: number | null; signupOpensAt: Date | null; signupClosesAt: Date | null; priceSek: number; priceNote: string | null; contactNote: string | null; showSignupsToParticipants: boolean }): Promise<EventDetails>`; `getEventDetails(db, projectId: string): Promise<EventDetails | null>`.

- [ ] **Step 1: Write failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { getEventDetails, InvalidCapacityError, upsertEventDetails } from './details-service';

describe('upsertEventDetails', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.project).values({ id: 'p1', slug: 'p1', title: 'T', kind: 'event', ownerUserId: 'u1' });
  });

  const base = { projectId: 'p1', startsAt: new Date('2027-06-20T10:00:00Z'), endsAt: new Date('2027-06-20T18:00:00Z'), signupOpensAt: null, signupClosesAt: null, priceSek: 0, priceNote: null, contactNote: null, showSignupsToParticipants: false };

  it('inserts, then updates the same row on a second call', async () => {
    const first = await upsertEventDetails(db, { ...base, hasCapacityLimit: true, capacity: 40 });
    expect(first.capacity).toBe(40);
    const second = await upsertEventDetails(db, { ...base, hasCapacityLimit: true, capacity: 50 });
    expect(second.capacity).toBe(50);
    expect(await getEventDetails(db, 'p1')).toMatchObject({ capacity: 50 });
  });

  it('accepts hasCapacityLimit=false with capacity=null', async () => {
    const row = await upsertEventDetails(db, { ...base, hasCapacityLimit: false, capacity: null });
    expect(row.capacity).toBeNull();
  });

  it('rejects hasCapacityLimit=true with capacity=null', async () => {
    await expect(upsertEventDetails(db, { ...base, hasCapacityLimit: true, capacity: null })).rejects.toBeInstanceOf(InvalidCapacityError);
  });

  it('rejects hasCapacityLimit=false with a non-null capacity', async () => {
    await expect(upsertEventDetails(db, { ...base, hasCapacityLimit: false, capacity: 10 })).rejects.toBeInstanceOf(InvalidCapacityError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/events/details-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/events/details-service.ts`**

Validate `(input.capacity === null) === !input.hasCapacityLimit` first, else throw `InvalidCapacityError`. Then `db.insert(schema.eventDetails).values({ ...input }).onConflictDoUpdate({ target: schema.eventDetails.projectId, set: { ...input } }).returning()`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/events/details-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/events/details-service.ts src/lib/events/details-service.test.ts
git commit -m "feat: add event details upsert with capacity invariant"
```

## Task 7: Area service (admin CRUD) + area management UI

**Files:**
- Create: `src/lib/areas/service.ts`
- Create: `src/lib/areas/service.test.ts`
- Create: `src/app/areas/page.tsx`
- Create: `src/app/areas/actions.ts`
- Modify: `src/components/app-shell.tsx` (add "Areas" nav link, member-admin only)

**Interfaces:**
- Produces: `class AreaNotFoundError`; `listAreas(db): Promise<Area[]>`; `createArea(db, input: { name: string; description: string; capacity: number | null; bookable: boolean; mapRef: string | null }): Promise<Area>`; `updateArea(db, input: { id: string } & same fields): Promise<Area>`. Used by Task 8's booking UI (to populate the area picker) and Task 9 (event edit page).

- [ ] **Step 1: Write failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '@/db';
import { AreaNotFoundError, createArea, listAreas, updateArea } from './service';

describe('area service', () => {
  let db: Db;
  beforeEach(async () => { db = await createDb('pglite://memory'); });

  it('creates and lists areas', async () => {
    await createArea(db, { name: 'Kitchen', description: '', capacity: 20, bookable: true, mapRef: null });
    await createArea(db, { name: 'Big top', description: 'Main tent', capacity: null, bookable: true, mapRef: null });
    const areas = await listAreas(db);
    expect(areas.map((a) => a.name)).toEqual(['Kitchen', 'Big top']);
  });

  it('updates an existing area', async () => {
    const created = await createArea(db, { name: 'Kitchen', description: '', capacity: 20, bookable: true, mapRef: null });
    const updated = await updateArea(db, { id: created.id, name: 'Kitchen', description: 'Renovated', capacity: 25, bookable: true, mapRef: null });
    expect(updated).toMatchObject({ description: 'Renovated', capacity: 25 });
  });

  it('throws for an unknown id', async () => {
    await expect(updateArea(db, { id: 'nope', name: 'X', description: '', capacity: null, bookable: true, mapRef: null })).rejects.toBeInstanceOf(AreaNotFoundError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/areas/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/areas/service.ts`**

`listAreas` orders by `name`. `createArea` inserts with `id: randomUUID()`. `updateArea` updates by id, throws `AreaNotFoundError` if no row returned.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/areas/service.test.ts`
Expected: PASS

- [ ] **Step 5: Build the area management page**

`src/app/areas/page.tsx`: `requireMemberAdmin()`, `listAreas`, a table (same `Table`/`TableRow` components as `/members`) with an inline "add area" form at the bottom posting to a `createAreaAction`, and each row linking to an edit form (reuse the members `[id]` pattern: a small inline edit isn't needed — a simple `<details>`/expand-in-place edit form per row, posting to `updateAreaAction`, is enough; no separate `[id]` route is needed since areas have no sub-resources to link to yet).

`src/app/areas/actions.ts`: `createAreaAction`/`updateAreaAction`, both `requireMemberAdmin()` then parse `FormData` (`capacity` empty string → `null`), call the service, `revalidatePath('/areas')`, `redirect('/areas')`.

- [ ] **Step 6: Add the nav link**

In `src/components/app-shell.tsx`, add `{isMemberAdmin(user) && <Link href="/areas" ...>Areas</Link>}` next to the existing "Members" link.

- [ ] **Step 7: Manually verify**

Run: `npm run dev`, log in as member-admin, visit `/areas`, create two areas, edit one, confirm both persist after reload.

- [ ] **Step 8: Commit**

```bash
git add src/lib/areas/service.ts src/lib/areas/service.test.ts src/app/areas/ src/components/app-shell.tsx
git commit -m "feat: add admin-managed area list"
```

## Task 8: Event-area booking service

**Files:**
- Create: `src/lib/areas/booking-service.ts`
- Create: `src/lib/areas/booking-service.test.ts`

**Interfaces:**
- Consumes: `schema.eventArea`, `schema.area`, `schema.project` (Task 1).
- Produces: `type AreaOverlapWarning = { eventAreaId: string; eventProjectId: string; eventTitle: string; from: Date; to: Date }`; `bookEventArea(db, input: { eventProjectId: string; areaId: string; from: Date; to: Date; setupNote: string | null }): Promise<{ booking: EventArea; overlaps: AreaOverlapWarning[] }>`; `listEventAreas(db, eventProjectId: string): Promise<EventArea[]>`; `removeEventArea(db, eventAreaId: string): Promise<void>`.

- [ ] **Step 1: Write failing tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { bookEventArea, listEventAreas, removeEventArea } from './booking-service';

describe('booking-service', () => {
  let db: Db;
  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.area).values({ id: 'kitchen', name: 'Kitchen' });
    await db.insert(schema.project).values([
      { id: 'e1', slug: 'e1', title: 'Breakfast', kind: 'event', ownerUserId: 'u1' },
      { id: 'e2', slug: 'e2', title: 'Lunch', kind: 'event', ownerUserId: 'u1' },
    ]);
  });

  it('books an area with no existing bookings and reports no overlaps', async () => {
    const { booking, overlaps } = await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date('2027-06-20T08:00:00Z'), to: new Date('2027-06-20T09:00:00Z'), setupNote: null });
    expect(booking.areaId).toBe('kitchen');
    expect(overlaps).toEqual([]);
  });

  it('still books an overlapping time but reports the conflicting event', async () => {
    await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date('2027-06-20T08:00:00Z'), to: new Date('2027-06-20T10:00:00Z'), setupNote: null });
    const { booking, overlaps } = await bookEventArea(db, { eventProjectId: 'e2', areaId: 'kitchen', from: new Date('2027-06-20T09:00:00Z'), to: new Date('2027-06-20T11:00:00Z'), setupNote: null });
    expect(booking.eventProjectId).toBe('e2'); // saved despite the conflict
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ eventProjectId: 'e1', eventTitle: 'Breakfast' });
  });

  it('does not treat back-to-back (non-overlapping) bookings as a conflict', async () => {
    await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date('2027-06-20T08:00:00Z'), to: new Date('2027-06-20T09:00:00Z'), setupNote: null });
    const { overlaps } = await bookEventArea(db, { eventProjectId: 'e2', areaId: 'kitchen', from: new Date('2027-06-20T09:00:00Z'), to: new Date('2027-06-20T10:00:00Z'), setupNote: null });
    expect(overlaps).toEqual([]);
  });

  it('lists and removes bookings for an event', async () => {
    const { booking } = await bookEventArea(db, { eventProjectId: 'e1', areaId: 'kitchen', from: new Date(), to: new Date(), setupNote: null });
    expect(await listEventAreas(db, 'e1')).toHaveLength(1);
    await removeEventArea(db, booking.id);
    expect(await listEventAreas(db, 'e1')).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/areas/booking-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/areas/booking-service.ts`**

Overlap query: rows in `eventArea` with the same `areaId`, a different `eventProjectId`, where `from < input.to AND to > input.from` (strict inequalities, so back-to-back bookings don't overlap), joined to `project` for the title:

```ts
export async function bookEventArea(db: Db, input: {...}): Promise<{ booking: EventArea; overlaps: AreaOverlapWarning[] }> {
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
```

`listEventAreas` filters by `eventProjectId`. `removeEventArea` deletes by `id`.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/areas/booking-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/areas/booking-service.ts src/lib/areas/booking-service.test.ts
git commit -m "feat: add area booking with advisory overlap detection"
```

## Task 9: Event create/edit UI

**Files:**
- Create: `src/app/events/new/page.tsx`
- Create: `src/app/events/new/actions.ts`
- Create: `src/app/events/[slug]/edit/page.tsx`
- Create: `src/app/events/[slug]/edit/actions.ts`

**Interfaces:**
- Consumes: `createEvent`, `updateProjectMeta`, `getProjectBySlug` (Task 4); `upsertEventDetails`, `getEventDetails` (Task 6); `listAreas` (Task 7); `bookEventArea`, `listEventAreas`, `removeEventArea` (Task 8); `assertEventPermission` (Task 3).
- Produces: nothing new consumed elsewhere — this is a leaf UI task. (Task 12 links to `/events/new` and `/events/[slug]/edit`.)

- [ ] **Step 1: Build the minimal create form**

`src/app/events/new/page.tsx`: `requireUser()`, a form with `title` and `summary` fields posting to `createEventAction`.
`src/app/events/new/actions.ts`: `createEventAction(formData)` calls `requireUser()`, then `createEvent(await getDb(), { title, summary, ownerUserId: user.id })`; on `EventCreationBlockedError`, redirect back to `/events/new?error=...`; on success `redirect(`/events/${project.slug}/edit`)`.

- [ ] **Step 2: Build the edit page**

`src/app/events/[slug]/edit/page.tsx`: `requireUser()`, `getProjectBySlug(db, slug)` (→ `notFound()` if missing), `await assertEventPermission(db, project.id, user, 'editDetails')` (catch `NotAuthorizedError` → `redirect('/events')`), `getEventDetails`, `listEventAreas`, `listAreas`. Three forms on one page: project meta (title/summary/body), event details (starts/ends, capacity-or-unlimited radio + number input, price/priceNote, signup window, `showSignupsToParticipants`), and an area-booking form (select from `listAreas`, from/to) plus a list of current `eventArea` rows with a "remove" link and, if `bookEventArea` returned any `overlaps` on the last submit (passed via `?warning=`), a visible warning banner.

`src/app/events/[slug]/edit/actions.ts`: `updateEventMetaAction`, `updateEventDetailsAction` (parses the capacity radio: `hasCapacityLimit = formData.get('capacityMode') === 'limited'`, `capacity = hasCapacityLimit ? Number(formData.get('capacity')) : null`), `bookAreaAction` (on success with `overlaps.length > 0`, redirect with `?warning=` describing the conflicting event titles; otherwise plain redirect), `removeAreaAction`. Every action calls `assertEventPermission(..., 'editDetails')` before mutating.

- [ ] **Step 3: Manually verify**

Run: `npm run dev`. Create an event, fill in details and book an area, confirm the data persists across reload. Book a second event into the same area/time and confirm the warning banner appears but the booking still saves.

- [ ] **Step 4: Commit**

```bash
git add src/app/events/new/ src/app/events/\[slug\]/edit/
git commit -m "feat: add event create and edit pages"
```

## Task 10: Duplicate as new event

**Files:**
- Modify: `src/lib/projects/service.ts` (add `duplicateEvent`)
- Modify: `src/lib/projects/service.test.ts`
- Modify: `src/app/events/[slug]/actions.ts` (create this file now; Task 12 adds more to it) — `duplicateEventAction`

**Interfaces:**
- Produces: `duplicateEvent(db, input: { sourceProjectId: string; actorUserId: string }): Promise<Project>` — reads the source `project` + `projectMember[]` + `eventArea[]` (not `eventDetails`, not `eventSignup`), creates a new `draft` project (same `title`/`summary`/`body`, new slug), copies `projectMember` rows, and copies `eventArea` rows with `from`/`to` set to `null`... **Drizzle note:** `eventArea.from`/`to` are `notNull()`; a duplicated booking can't be inserted with blanked dates under the current schema. Resolve this by not copying `eventArea` rows at all — copy only `title`/`summary`/`body`/`projectMember`, and let the organiser re-book areas on the new draft via the Task 9 edit page. This is simpler than relaxing the `NOT NULL` constraint for a rare, already-manual flow, and still satisfies the spec's "duplicate as new event" intent (§3) since area bookings are exactly the part that changes between occurrences.

- [ ] **Step 1: Write a failing test**

```ts
describe('duplicateEvent', () => {
  it('copies meta and organisers, not areas or signups, and starts in draft', async () => {
    const source = await draftEventWithDetailsAndArea(db); // helper from Task 4's transitionStatus tests; re-add here if not shared
    await db.insert(schema.projectMember).values({ projectId: source.id, userId: 'u1', role: 'lead' });
    const dup = await duplicateEvent(db, { sourceProjectId: source.id, actorUserId: 'u1' });
    expect(dup.status).toBe('draft');
    expect(dup.title).toBe(source.title);
    expect(dup.slug).not.toBe(source.slug);
    const members = await db.select().from(schema.projectMember).where(eq(schema.projectMember.projectId, dup.id));
    expect(members.map((m) => m.userId)).toEqual(['u1']);
    expect(await db.select().from(schema.eventArea).where(eq(schema.eventArea.eventProjectId, dup.id))).toEqual([]);
  });

  it('rejects for a user whose canCreateEvents is false', async () => {
    await db.update(schema.user).set({ canCreateEvents: false }).where(eq(schema.user.id, 'u1'));
    const source = await createEvent(db, { title: 'X', summary: '', ownerUserId: 'u1' });
    await expect(duplicateEvent(db, { sourceProjectId: source.id, actorUserId: 'u1' })).rejects.toBeInstanceOf(EventCreationBlockedError);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/projects/service.test.ts`
Expected: FAIL — `duplicateEvent` not defined.

- [ ] **Step 3: Implement `duplicateEvent`**

Re-checks `canCreateEvents` exactly like `createEvent` (this is the Review Focus item: duplicate is a separate entry point and must not skip the check). Loads the source project and its `projectMember` rows, then runs the same insert logic as `createEvent` for the new project (new id, deduped slug via `uniqueSlug`), followed by inserting a `projectMember` row for every row on the source project (preserving each person's role).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/projects/service.test.ts`
Expected: PASS

- [ ] **Step 5: Wire up the action**

`src/app/events/[slug]/actions.ts`: `duplicateEventAction(formData)` — `requireUser()`, `getProjectBySlug`, call `duplicateEvent`, `redirect(`/events/${dup.slug}/edit`)`. On `EventCreationBlockedError`, redirect back to the source event with an error message.

- [ ] **Step 6: Commit**

```bash
git add src/lib/projects/service.ts src/lib/projects/service.test.ts src/app/events/\[slug\]/actions.ts
git commit -m "feat: add duplicate-as-new-event"
```

## Task 11: Sign-up service

**Files:**
- Create: `src/lib/events/signup-service.ts`
- Create: `src/lib/events/signup-service.test.ts`

**Interfaces:**
- Consumes: `ProjectNotFoundError` from `@/lib/projects/service` (Task 4) — reused as-is for a missing event, not redefined here.
- Produces: `type SignupResult = { status: 'going' | 'waitlist'; signup: EventSignup }`; `signUp(db, input: { eventProjectId: string; userId: string; seats: number; note: string | null }): Promise<SignupResult>`; `cancelSignup(db, input: { eventProjectId: string; userId: string }): Promise<{ promoted: EventSignup[] }>`; `listSignups(db, eventProjectId: string): Promise<EventSignup[]>`. Task 12's actions call `cancelSignup` and then, for each row in `promoted`, look up that user's email and call `sendSignupPromotedEmail` (Task 11 does not send email itself — matches the existing convention where `actions.ts`, not `service.ts`, sends mail, per `sendRenewalAskAction`).

**Testing note:** PGlite backs a single in-process connection, so these tests exercise the capacity-check *logic* (including the `FOR UPDATE` statement executing without error) via sequential calls that reproduce the same decision a race would force — not true lock contention between two real concurrent connections. That would require an integration test against a real Postgres instance, which is out of scope here.

- [ ] **Step 1: Write failing tests**

```ts
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
    await cancelSignup(db, { eventProjectId: 'e1', userId: 'b' });
    await signUp(db, { eventProjectId: 'e1', userId: 'b', seats: 1, note: null }); // re-queued, now behind c
    await signUp(db, { eventProjectId: 'e1', userId: 'c', seats: 1, note: null }); // waitlist, now 1st in line
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/events/signup-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `signUp`**

```ts
export async function signUp(db: Db, input: { eventProjectId: string; userId: string; seats: number; note: string | null }): Promise<SignupResult> {
  return db.transaction(async (tx) => {
    const [details] = await tx.select().from(schema.eventDetails).where(eq(schema.eventDetails.projectId, input.eventProjectId)).for('update');
    if (!details) throw new ProjectNotFoundError(input.eventProjectId);
    let status: SignupStatus = 'going';
    if (details.hasCapacityLimit) {
      const others = await tx.select({ seats: schema.eventSignup.seats }).from(schema.eventSignup)
        .where(and(eq(schema.eventSignup.eventProjectId, input.eventProjectId), eq(schema.eventSignup.status, 'going'), ne(schema.eventSignup.userId, input.userId)));
      const total = others.reduce((sum, o) => sum + o.seats, 0);
      status = total + input.seats <= details.capacity! ? 'going' : 'waitlist';
    }
    const now = new Date();
    const [row] = await tx.insert(schema.eventSignup)
      .values({ eventProjectId: input.eventProjectId, userId: input.userId, status, seats: input.seats, note: input.note, createdAt: now })
      .onConflictDoUpdate({ target: [schema.eventSignup.eventProjectId, schema.eventSignup.userId], set: { status, seats: input.seats, note: input.note, createdAt: now } })
      .returning();
    await logDecision(tx as unknown as Db, { entity: 'event_signup', entityId: `${input.eventProjectId}:${input.userId}`, actorUserId: input.userId, action: status, diff: { status } });
    return { status, signup: row };
  });
}
```

- [ ] **Step 4: Implement `cancelSignup`**

```ts
export async function cancelSignup(db: Db, input: { eventProjectId: string; userId: string }): Promise<{ promoted: EventSignup[] }> {
  return db.transaction(async (tx) => {
    const [details] = await tx.select().from(schema.eventDetails).where(eq(schema.eventDetails.projectId, input.eventProjectId)).for('update');
    if (!details) throw new ProjectNotFoundError(input.eventProjectId);
    const [existing] = await tx.select().from(schema.eventSignup)
      .where(and(eq(schema.eventSignup.eventProjectId, input.eventProjectId), eq(schema.eventSignup.userId, input.userId)));
    if (!existing || existing.status === 'cancelled') return { promoted: [] };
    await tx.update(schema.eventSignup).set({ status: 'cancelled' })
      .where(and(eq(schema.eventSignup.eventProjectId, input.eventProjectId), eq(schema.eventSignup.userId, input.userId)));
    await logDecision(tx as unknown as Db, { entity: 'event_signup', entityId: `${input.eventProjectId}:${input.userId}`, actorUserId: input.userId, action: 'cancelled', diff: {} });
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
```

`listSignups` is a plain `db.select().from(schema.eventSignup).where(eq(...)).orderBy(asc(schema.eventSignup.createdAt))`.

- [ ] **Step 5: Run to verify all pass**

Run: `npx vitest run src/lib/events/signup-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/events/signup-service.ts src/lib/events/signup-service.test.ts
git commit -m "feat: add sign-up service with waitlist promotion"
```

## Task 12: Event detail page, sign-up UI, listing, nav

**Files:**
- Create: `src/app/events/page.tsx`
- Create: `src/app/events/[slug]/page.tsx`
- Modify: `src/app/events/[slug]/actions.ts` (add `signUpAction`, `cancelSignupAction`, `publishAction`, `cancelEventAction`, `closeEventAction`, `archiveEventAction`)
- Create: `src/app/events/[slug]/signups.csv/route.ts`
- Modify: `src/lib/email.ts` (add `sendSignupPromotedEmail`)
- Modify: `src/components/app-shell.tsx` (add "Events" nav link, visible to everyone)

**Interfaces:**
- Consumes: everything from Tasks 3, 4, 6, 7, 8, 11.

- [ ] **Step 1: Add the promotion email**

```ts
export type SignupPromotedMail = { to: string; eventTitle: string; eventUrl: string };
/** Sent when a cancellation frees a seat and moves someone off the waitlist. */
export async function sendSignupPromotedEmail({ to, eventTitle, eventUrl }: SignupPromotedMail): Promise<void> {
  const subject = `You're in: ${eventTitle}`;
  const text = `A seat opened up and you're now going to ${eventTitle}.\n\n${eventUrl}`;
  const key = process.env.RESEND_API_KEY;
  if (!key) { console.log(`[email] to=${to} subject="${subject}"`); return; }
  const from = process.env.EMAIL_FROM ?? 'Alversjö <no-reply@notifications.alversjo.land>';
  const { error } = await new Resend(key).emails.send({ from, to: [to], subject, text });
  if (error) throw new Error(`Resend: ${error.message}`);
}
```

- [ ] **Step 2: Build `/events` listing**

`requireUser()`, load published projects of `kind='event'` with their `eventDetails`, split into upcoming (`startsAt >= now`, ascending) and past (descending), each row linking to `/events/[slug]`. Include a "New event" link to `/events/new`.

- [ ] **Step 3: Build `/events/[slug]` detail page**

`getProjectBySlug` (→ `notFound()`), `getEventDetails`, `listEventAreas`, `getEventRole(db, project.id, user)` to decide what to show:
- Everyone who can view: title/body, when, areas, price, a sign-up button (if `status==='published'`) or their current sign-up status with a cancel button, and (if `showSignupsToParticipants` or the viewer organises) the attendee list.
- Organisers (`role !== null`) additionally see: edit link, duplicate button, a CSV export link (`/events/[slug]/signups.csv`), and the attendee list with notes regardless of `showSignupsToParticipants`.
- `role === 'lead' || role === 'override'` additionally see: publish/cancel/close/archive buttons, gated to the transitions valid from the current `status` (use `ALLOWED_TRANSITIONS[project.status]` to decide which buttons render).

- [ ] **Step 4: Implement the new actions in `src/app/events/[slug]/actions.ts`**

`signUpAction`/`cancelSignupAction`: `requireUser()`, `getProjectBySlug`, call `signUp`/`cancelSignup`; for `cancelSignupAction`, after it resolves, loop `promoted` and for each row fetch that user's email and call `sendSignupPromotedEmail`; `revalidatePath` the detail page; redirect back to it.
`publishAction`/`cancelEventAction`/`closeEventAction`/`archiveEventAction`: `requireUser()`, `getProjectBySlug`, `await assertEventPermission(db, project.id, user, 'manage')`, then `transitionStatus(db, { projectId: project.id, to: <target>, actorUserId: user.id })`; redirect back to the detail page. On `InvalidTransitionError`/`IncompleteEventError`/`NotAuthorizedError`, redirect with `?error=`.

- [ ] **Step 5: Implement the CSV export route**

`src/app/events/[slug]/signups.csv/route.ts`: `export async function GET(req, { params })` — `requireUser()`, `getProjectBySlug`, `await assertEventPermission(db, project.id, user, 'editDetails')` (viewing the list is an "editDetails"-level action per the authorization matrix — both `lead` and `cocreator` can view/export per spec §5), `listSignups`, join to `user` for name/email, build CSV text (`name,email,seats,note,status`), return `new Response(csv, { headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="signups.csv"' } })`.

- [ ] **Step 6: Add the nav link**

In `src/components/app-shell.tsx`: `<Link href="/events" ...>Events</Link>`, unconditional (every member can at least view).

- [ ] **Step 7: Manually verify end to end**

Run: `npm run dev`. As one member: create an event, set capacity 1, publish it. As a second member (second browser/incognito + the printed login code): sign up (goes `going`). As a third: sign up (goes `waitlist`). Cancel the first member's sign-up and confirm the console logs a promotion email to the third member, and the UI reflects it on reload. As the organiser, export the CSV and open it.

- [ ] **Step 8: Commit**

```bash
git add src/app/events/ src/lib/email.ts src/components/app-shell.tsx
git commit -m "feat: add event detail page, sign-up flow, and listing"
```

## Task 13: iCal feed

**Files:**
- Create: `src/lib/events/ical.ts`
- Create: `src/lib/events/ical.test.ts`
- Modify: `src/lib/members/service.ts` (add `getOrCreateIcalToken`, `getUserByIcalToken`)
- Modify: `src/lib/members/service.test.ts`
- Create: `src/app/events/members.ics/route.ts`
- Create: `src/app/events/[slug]/ics/route.ts`
- Modify: `src/app/events/[slug]/page.tsx` (add the "Add to calendar" link)
- Modify: `src/app/profile/page.tsx` or wherever is simplest (a "Subscribe" link exposing the member's `/events/members.ics?token=...` URL) — if `src/app/profile/page.tsx` doesn't exist or doesn't fit, add it to `src/app/events/page.tsx` instead.

**Interfaces:**
- Produces: `buildEventIcs(event: { uid: string; title: string; startsAt: Date; endsAt: Date; description: string }): string`; `buildFeedIcs(events: Array<same>): string`; `getOrCreateIcalToken(db, userId: string): Promise<string>`; `getUserByIcalToken(db, token: string): Promise<User | null>`.

- [ ] **Step 1: Write failing tests for the ICS builders**

```ts
import { describe, expect, it } from 'vitest';
import { buildEventIcs, buildFeedIcs } from './ical';

describe('ical', () => {
  const event = { uid: 'e1', title: 'Work day', startsAt: new Date('2027-06-20T08:00:00Z'), endsAt: new Date('2027-06-20T16:00:00Z'), description: 'Bring gloves' };

  it('buildEventIcs produces a single VEVENT with UTC timestamps', () => {
    const ics = buildEventIcs(event);
    expect(ics).toContain('BEGIN:VEVENT');
    expect(ics).toContain('UID:e1');
    expect(ics).toContain('SUMMARY:Work day');
    expect(ics).toContain('DTSTART:20270620T080000Z');
    expect(ics).toContain('DTEND:20270620T160000Z');
    expect(ics).toContain('END:VEVENT');
  });

  it('buildFeedIcs wraps multiple events in one VCALENDAR', () => {
    const ics = buildFeedIcs([event, { ...event, uid: 'e2', title: 'Second' }]);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('END:VCALENDAR');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/events/ical.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/events/ical.ts`**

Format dates as `YYYYMMDDTHHMMSSZ` from the UTC fields of the `Date`. `buildEventIcs` returns a standalone `BEGIN:VCALENDAR...BEGIN:VEVENT...END:VEVENT...END:VCALENDAR` block (a single-event download is still a full valid `.ics`); `buildFeedIcs` wraps one `BEGIN:VCALENDAR`/`END:VCALENDAR` around every event's `BEGIN:VEVENT...END:VEVENT` block, each produced by a shared internal helper (don't call `buildEventIcs` itself for each, since that would nest `VCALENDAR` blocks — factor the `VEVENT`-only body out into an unexported `veventBlock(event)` used by both).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/events/ical.test.ts`
Expected: PASS

- [ ] **Step 5: Write failing tests for the token helpers**

```ts
it('getOrCreateIcalToken generates one on first call and is stable after', async () => {
  const first = await getOrCreateIcalToken(db, 'viktor');
  const second = await getOrCreateIcalToken(db, 'viktor');
  expect(first).toBe(second);
});

it('getUserByIcalToken finds the right user, or null for an unknown token', async () => {
  const token = await getOrCreateIcalToken(db, 'viktor');
  expect((await getUserByIcalToken(db, token))?.id).toBe('viktor');
  expect(await getUserByIcalToken(db, 'not-a-real-token')).toBeNull();
});
```

- [ ] **Step 6: Run to verify it fails, then implement in `src/lib/members/service.ts`, then verify it passes**

Run: `npx vitest run src/lib/members/service.test.ts` (expect FAIL, implement, expect PASS).
`getOrCreateIcalToken`: select the user; if `icalToken` is set, return it; else generate `randomUUID()`, `update ... set({ icalToken })`, return it. `getUserByIcalToken`: plain `select().from(user).where(eq(user.icalToken, token))`, return the row or `null`.

- [ ] **Step 7: Implement the route handlers**

`src/app/events/[slug]/ics/route.ts`: `requireUser()` (session-gated, since it's a manual "Add to calendar" click, not a subscribed feed), `getProjectBySlug`, `getEventDetails`, return `buildEventIcs(...)` with `Content-Type: text/calendar`.
`src/app/events/members.ics/route.ts`: reads `?token=`; if missing/unknown, return `new Response(null, { status: 404 })` (no session check — calendar apps can't send cookies); otherwise look up the user, list every `published` event's details, return `buildFeedIcs(...)`.

- [ ] **Step 8: Add the UI entry points**

On `/events/[slug]/page.tsx`: a plain `<a href={`/events/${project.slug}/ics`}>Add to calendar</a>` link. On `/events/page.tsx`: a "Subscribe to all events" link built from `await getOrCreateIcalToken(db, user.id)` as `/events/members.ics?token=${token}`.

- [ ] **Step 9: Manually verify**

Run: `npm run dev`. Visit an event page, click "Add to calendar," confirm a valid `.ics` downloads. Visit `/events`, copy the subscribe link, `curl` it without any cookie and confirm it returns calendar data; `curl` it with a garbage token and confirm a 404.

- [ ] **Step 10: Commit**

```bash
git add src/lib/events/ical.ts src/lib/events/ical.test.ts src/lib/members/service.ts src/lib/members/service.test.ts src/app/events/members.ics/ src/app/events/\[slug\]/ics/ src/app/events/\[slug\]/page.tsx src/app/events/page.tsx
git commit -m "feat: add iCal feed for events"
```

---

## Final check (after Task 13)

- [ ] Run the full suite: `npm run test` — expect PASS.
- [ ] Run `npm run lint` — expect no errors.
- [ ] Run `npm run db:check` — expect exit 0 (no drift between schema and committed migrations).
- [ ] Re-read the spec (`docs/superpowers/specs/2026-10-22-events-module-design.md`) end to end once more and confirm every §1 bullet has a corresponding task above.
