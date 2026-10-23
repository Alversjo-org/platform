# Events module design

## 1. Summary

Adds the first money-free slice from the internal projects/events/co-budgeting
reference note (Oct 15, 2026): a generic `project` entity, and the first real
use of it — events with sign-ups and area bookings. Budgets, funds, rounds,
allocations, receipts and Fortnox (steps 4–8 of that note) are a separate,
later slice and are not touched here.

What ships:

- A `project` table generic enough to later hold non-event kinds (ongoing
  groups, builds, purchases), but this pass only builds the creation/edit UI
  for `kind = 'event'`.
- Create, edit, publish, cancel an event with the four required facts: when,
  capacity, cost (informational only), areas used.
- Sign-ups with waitlist and cancellation, under a seat-count transaction.
- An admin-managed list of bookable areas; events book time against them with
  an advisory (non-blocking) overlap warning.
- Members-only and public event lists, an event page, an iCal feed.
- "Duplicate as new event" to reuse a past event as a starting point, instead
  of a structured recurring-series model.
- A per-member switch (`member-admin`+) to block someone from creating events.

Out of scope for this pass: budgets/funds/rounds/allocations, Fortnox, taking
payment for sign-ups (price is shown, not charged), a structured recurring
series (parent/child events), hard-blocking area double-booking, a map/grid
area picker (areas stay a flat admin-managed list), a retention policy for
old sign-up data (flagged in §9, not decided), and any public-facing
(unauthenticated) surface — see §6. This platform has no unauthenticated
routes today (v0's design explicitly says "no public services"), and where a
public events page would actually live (this app, a new domain, or the
separate legacy Hostpoint site at the bare domain) isn't decided. Everything
in this pass is members-only.

## 2. Roles & permissions

Reuses the existing `role`: `member` / `member-admin` / `admin`. No new
platform role.

- Any `member` can create an event, by default. A new `user.canCreateEvents`
  boolean (default `true`) gates this; a `member-admin` can flip it off for a
  specific member, the same way they already hand-edit other `user` fields in
  `/members` (membership-management design, §6). **My call, flag for
  confirmation:** member-admin rather than admin-only, since it's the same
  moderation-adjacent editing they already do — easy to narrow to admin-only
  later if that's wrong.
- `project_member.role`: `lead` | `cocreator` (`treasurer` is deferred to the
  budgets slice). An event needs at least one `lead` to be published. The
  creating user is inserted as `lead` automatically on creation, so a draft
  is never ownerless. **Authorization matrix, my call** (mirrors the
  site-wide pattern of member-admin/admin overriding member-owned data,
  e.g. membership-management §6): `lead` can edit details, areas, the
  organiser list, and publish/cancel/close; `cocreator` can edit details and
  areas but not the organiser list or status; both can view/export
  sign-ups. `member-admin`/`admin` can do anything a `lead` can, on any
  event, same override precedent as elsewhere in the app.
- `project.visibility`: `members` | `public` as a column (kept now so a later
  pass doesn't need a migration just to add the value), but the create/edit
  UI only offers `members` this pass — see §6 for why `public` has no
  effect yet.

## 3. Data model

New tables, alongside the existing `user`/`boxes` tables in `src/db/schema.ts`.

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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
// project_group_id / fortnox_project_code columns come with the budgets slice;
// omitted now since nothing reads or writes them yet.

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
  capacity: integer('capacity'), // null iff !hasCapacityLimit
  signupOpensAt: timestamp('signup_opens_at'),
  signupClosesAt: timestamp('signup_closes_at'), // null = until starts_at
  priceSek: integer('price_sek').notNull().default(0), // `_sek`-suffixed fields hold whole öre as integers, per the reference note's convention (avoids floats) — informational only, never booked
  priceNote: text('price_note'),
  contactNote: text('contact_note'),
});

export const area = pgTable('area', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  capacity: integer('capacity'), // advisory only, see §4
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
});
// index on (area_id, from, to) for the overlap-warning query in §4.

export const eventSignup = pgTable('event_signup', {
  eventProjectId: text('event_project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  status: text('status', { enum: ['going', 'waitlist', 'cancelled'] }).$type<SignupStatus>().notNull(),
  seats: integer('seats').notNull().default(1), // self + guests
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventProjectId, t.userId] })]);

export const decisionLog = pgTable('decision_log', {
  id: text('id').primaryKey(),
  entity: text('entity').notNull(), // 'project' | 'event_signup'
  entityId: text('entity_id').notNull(),
  actorUserId: text('actor_user_id').notNull().references(() => user.id),
  action: text('action').notNull(), // e.g. 'status_change', 'signup_cancelled'
  diff: text('diff').notNull(), // JSON string: {from, to} or similar
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// user table addition:
canCreateEvents: boolean('can_create_events').notNull().default(true),
```

`decisionLog` is generic (`entity`/`entityId`) so the later budgets slice
reuses it for `allocation`/`budget_line` changes rather than inventing a
second audit table.

### Status machine

```
draft ──► published ──► cancelled
  │            │
  │            └──► closed
  └──► archived      │
                      ▼
                  archived
```

Allowed transitions only: `draft→published`, `draft→archived` (discarded
before publishing), `published→cancelled`, `published→closed`,
`cancelled→archived`, `closed→archived`. Any other transition is rejected at
the server-action layer. Every transition writes a `decisionLog` row
(`entity='project'`, `action='status_change'`, `diff={from, to}`,
`actorUserId`).

### "Duplicate as new event"

Not a schema relation — a server action that reads a source `project` +
`eventDetails` + `eventArea[]` + `projectMember[]` and inserts a new `project`
in `draft`, copying `title`/`summary`/`body`, the area bookings (dates
blanked, left for the organiser to set), and the organiser team
(`projectMember` rows). `eventSignup` rows are **not** copied — each
occurrence gets fresh sign-ups. **My interpretation, flag for confirmation:**
"including invited people" was read as copying the organiser/co-creator team,
not re-inviting past attendees; past attendees have no natural "invite"
mechanism in this design since sign-up is open, not invite-only.

This also means no `parent_project_id` or series concept is added — each
duplicated event is a fully independent `project` row. If recurring series
turn out to matter later, that's a new pass with its own design, not a
retrofit of these tables (duplication doesn't block adding a `parent_project_id`
column later; it just means nothing depends on one existing now).

## 4. Areas & bookings

`area` stays a flat, admin-managed list for this pass — matching "that work
is not done yet" on the map/grid picker. When a map-based picker (named areas
plus custom drawn/grid areas) is built later, it needs no migration here: a
custom area is just another `area` row with an id, referenced by `eventArea`
exactly like a named one; the only addition at that point is a column to hold
the drawn shape, which is purely additive. Nothing speculative is added now.

Overlap is advisory, not enforced: saving an `eventArea` row runs a query for
other `eventArea` rows on the same `areaId` whose `[from, to]` range
intersects, and surfaces them as a warning to the organiser ("Kitchen is also
booked by `<event>` from `<time>` to `<time>`") with no block — "organisers
work it out between themselves." No DB exclusion constraint, no row lock. The
`(area_id, from, to)` index keeps that query cheap as bookings grow.

`area.capacity` (if set) is shown next to the event's own capacity as the same
kind of advisory signal ("this area holds 40, you've set capacity to 60") —
not a constraint, consistent with the area model being informational
throughout this pass.

## 5. Sign-ups & capacity

`eventDetails.hasCapacityLimit` makes "no limit" an explicit choice (not an
empty field) at the database level, not just in the UI: the create form
forces a choice between a number and "no limit," and `capacity` is `NULL` iff
`hasCapacityLimit = false`.

Signing up runs inside one transaction:

1. `SELECT ... FOR UPDATE` the `eventDetails` row (lock point).
2. If `!hasCapacityLimit`, insert `going`.
3. Else, sum `seats` over existing `going` rows; if the new sign-up's seats
   fit under `capacity`, insert `going`; otherwise insert `waitlist`.

Cancelling (status → `cancelled`) runs in the same kind of transaction: after
freeing seats, it re-checks the waitlist in `createdAt` order and promotes as
many as now fit, flipping their status to `going` and sending a Resend email
each (`sendSignupPromotedEmail`, mirroring the existing `sendOtpEmail` /
`sendRenewalEmail` pattern — console-logged without `RESEND_API_KEY`, same as
today). Both paths log a `decisionLog` row (`entity='event_signup'`).

Organisers (`projectMember` role `lead`/`cocreator` on that event) see the
full list — name, seats, note — with CSV export. Whether other *participants*
see each other's names is left as a per-event toggle on `eventDetails`
(`showSignupsToParticipants`, default false) — small enough to add directly
rather than treat as an open question.

**Re-signing up after cancelling, my call:** `eventSignup`'s PK is
`(eventProjectId, userId)`, so a cancelled member signing up again is an
*upsert*, not a fresh row: `status` flips back to `going`/`waitlist` per the
same capacity check, `seats`/`note` overwrite, and `createdAt` resets to now.
Resetting `createdAt` means they re-enter any waitlist at the back of the
queue rather than keeping their original place — treated as fair, since
cancelling was their choice to give up the spot.

## 6. Visibility, listing & iCal

Members-only only, this pass: `/events` list and `/events/[slug]` detail
page, both behind `requireUser()` like every other route today, filtered to
`status = 'published'` (plus upcoming/past split by `startsAt`). No
unauthenticated route is added — the platform has none today, and where a
public events surface would live (this app with a new auth exception, a new
domain, or the separate legacy Hostpoint site) is an open question for a
later pass, not this one.

iCal: `/events/members.ics`, behind a per-user token in the URL rather than a
login-gated fetch (calendar apps can't do session auth) — covers every
published event visible to that member. A per-event "Add to calendar" link
downloading a single-event `.ics` is included too.

## 7. Testing

Following the existing per-module `.test.ts` convention (PGlite for DB-backed
tests, Resend faked):

- Seat-count transaction: two concurrent sign-ups racing the last seat (only
  one gets `going`); cancellation promotes the earliest waitlisted sign-up;
  `hasCapacityLimit=false` always admits.
- Status machine: every allowed transition succeeds and logs; every
  disallowed transition (e.g. `draft→cancelled`) is rejected.
- `canCreateEvents=false` blocks the create action; member-admin toggling it
  logs who/when.
- Area overlap: a conflicting booking saves successfully and surfaces the
  warning (not an error).
- Duplicate-as-new-event: copies organisers and area/text fields, starts in
  `draft`, carries no sign-ups.

## 8. Migration

Single `drizzle-kit generate` after the schema additions in §3, committed
under `drizzle/`, per the existing `db:check` CI gate.

## 9. Open questions

- [ ] Where a public (unauthenticated) events surface eventually lives —
  this app with a new auth exception and layout, a new domain, or the
  separate legacy Hostpoint site at the bare domain — is undecided.
  Deferred to a later pass; this slice is members-only throughout (§1, §6).
- [ ] Confirm "duplicate as new event" copying the organiser team rather than
  attendees matches what "including invited people" meant (§3).
- [ ] Confirm `member-admin` (not admin-only) is the right level to toggle
  `canCreateEvents` (§2).
- [ ] No retention/deletion policy for `eventSignup` rows is set yet
  (personal data: name via `userId`, guest count, free-text note). Not a
  blocker for this pass, but should be decided before sign-up volume grows.
- [ ] Parked from the wider reference note, not this slice: whether the
  credit-based "dreams" round and a consent-based group-budget round can
  really share one `allocation` shape, and whether annual-budget rows are
  directly editable with a `decisionLog` audit trail (confirmed: not
  versioned/immutable, since Fortnox — not this platform — is the ledger of
  record). Both apply to the later budgets slice, recorded here only for
  continuity.
