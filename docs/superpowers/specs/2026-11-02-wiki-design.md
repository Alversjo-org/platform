# Wiki module design

Nov 2, 2026

## 1. Summary

Replaces the Coda "Alversjö Land Manual" with a members-editable wiki built
as a normal module in this repo: Drizzle schema + migrations, a service in
`src/lib/wiki/` tested on PGlite, server actions, shadcn UI — same shape as
`events`/`map`. Content comes from a one-time import of the Coda Markdown
export (36 pages, ~9k words, ~70 images).

What ships:

- Wiki pages with a BlockNote (Notion-style block editor) body, publicly
  readable, editable by anyone holding a new `wiki-editor` role.
- A general **role request** mechanism added to the existing roles system:
  any active member can ask for a role; an admin/role-admin approves or
  denies it on `/roles`. Not wiki-specific — built so `mapper`,
  `member-admin` etc. could use the same flow later, though this pass only
  wires up `wiki-editor`.
- Full revision history per page (every save keeps a snapshot; list past
  versions, restore one) — the actual safety net against bad edits, not
  role gating.
- Optimistic locking on save (reject with "this page changed, reload" if
  someone else saved first).
- A reorganizable page tree (parent + manual order) with a permanent,
  separately-assigned slug, so moving/renaming never breaks a URL.
- Postgres full-text search (title + body), exact/stemmed matching.
- Flat (non-threaded) comments per page, open to any active member.
- Image uploads via sharp-resized files in a Tigris bucket, behind a small
  storage interface that defaults to a fake/local-disk implementation in
  tests and dev — no cloud credentials required to build or test any of
  this.
- A new, independent **Task** entity (backlog/doing/done, optional
  assignee, optional image, optionally attached to a project) — the Coda
  "task list" idea, generalized so big projects can use it for sub-todos
  too.
- The Coda "Stuff Wish List" becomes 17 `purchase`-kind `project` rows
  (that `project.kind` value already exists, unused) instead of wiki
  content — plus a minimal list/detail view for `purchase`-kind projects
  (there's no kind-agnostic project UI today; every existing route under
  `/events/**` hardcodes `kind = 'event'`). **My call**: in scope for this
  pass, scaled down from the full co-budgeting UI — just enough to list
  and view wish-list items, reusing `projects/service.ts` CRUD. Without
  this, the imported rows would exist in the DB with no way for a member
  to ever see them, which defeats the point of migrating them at all.
- A one-time, re-runnable import script from the Markdown export.

Out of scope for this pass: diff view between revisions, fuzzy/typo-tolerant
search (`pg_trgm`), real-time co-editing, notifications/"watch this page",
non-English content, threaded comments, and any tie-in between building
wiki pages and the map module's `area` rows (today's `area` rows are
event-camping zones, not buildings — there's no existing overlap to wire
up; revisit if/when buildings get their own map areas).

## 2. Roles & permissions

**Flagged by the builder-check pass, needs your call (§11.4)**: "any active
member" below is used loosely. `isActiveMember` (paid-dues status) exists
today as a pure display/renewal flag — it's never used as an authorization
gate anywhere in the app, and there's no `requireActiveMember()` helper.
The actual precedent this doc cited (event creation) really just gates on
`requireUser()` (any logged-in member) plus an unrelated `canCreateEvents`
flag — not on dues status. Every "active member" below provisionally means
"any logged-in member," matching that real precedent, pending your answer.

Reading every page is public — no `requireUser()` gate on the read path at
all, unlike the rest of this app (which has no unauthenticated routes
today). **My call, flag for confirmation**: this is the first public
surface in the platform; confirm that's intended before this ships, since
it's a bigger change than it looks (search engines, no session needed,
image URLs are effectively public too).

Writing (create, edit, move, reorder, delete/restore a page) requires a new
role, `wiki-editor`. Deliberately a single role for all of those actions —
revision history is the protection against someone "ruining things," not a
narrower permission split between editing and restructuring.

### Role requests (general mechanism, `src/lib/roles/`)

```ts
export type RoleRequestStatus = 'pending' | 'approved' | 'denied';

export const roleRequest = pgTable('role_request', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  // Inlined enum array, matching userRole's existing pattern (role: text('role', {enum: [...]}))
  // rather than introducing a new shared constant — this Drizzle `enum` is a TS-only hint,
  // not a Postgres CHECK constraint, same as the existing user_role column.
  role: text('role', { enum: ['admin', 'member-admin', 'mapper', 'role-admin', 'treasurer', 'wiki-editor'] }).$type<Role>().notNull(),
  status: text('status', { enum: ['pending', 'approved', 'denied'] }).$type<RoleRequestStatus>().notNull().default('pending'),
  requestedAt: timestamp('requested_at').notNull().defaultNow(),
  decidedByUserId: text('decided_by_user_id').references(() => user.id),
  decidedAt: timestamp('decided_at'),
});
```

- `Role` gains `'wiki-editor'`. Added to `GRANTABLE_ROLES` (labels.ts) like
  `mapper`/`treasurer`.
- A new `SELF_REQUESTABLE_ROLES` list (separate from `GRANTABLE_ROLES`) —
  **my call**: only `wiki-editor` is self-requestable for now. `mapper`,
  `member-admin`, `treasurer` stay admin/role-admin-initiated only; nothing
  here forces them onto the request flow, it's just available to a future
  role that wants it.
- `requestRole(db, {userId, role})`: no-ops (via `onConflictDoNothing`-style
  check) if the user already holds the role or already has a pending
  request for it; otherwise inserts a `pending` row. No admin check — this
  is the self-service half.
- `decideRoleRequest(db, {actor, requestId, approve})`: requires
  `requireRoleAdmin()`-equivalent (admin or role-admin), same rule as
  granting directly — if `role === 'wiki-editor'` this never hits the
  `ADMIN_ONLY_ROLES` branch since it isn't one. On approve, calls the
  existing `setUserRole(grant: true)` and marks the request `approved`; on
  deny, just marks it `denied`. Both call `logDecision` (entity
  `role_request`), same as the existing grant/revoke path.
- `/roles` page gets a "Pending requests" section above the existing
  member/role grid, listing requester, role, requested-at, with
  Approve/Deny buttons. Visible to `role-admin`/`admin` only, like the rest
  of that page.
- The wiki UI gets an "Ask to edit" button (shown to any active member who
  isn't a `wiki-editor` and has no pending request; shows "Request pending"
  once they've asked) wherever an edit action would otherwise appear.

## 3. Data model

New tables in `src/db/schema.ts`.

```ts
export type WikiPageStatus = 'published' | 'deleted';

export const wikiPage = pgTable('wiki_page', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(), // permanent once created, never regenerated on title change
  title: text('title').notNull(), // current title, denormalized for tree/nav rendering without a join
  content: jsonb('content').notNull(), // current BlockNote document (array of blocks)
  parentId: text('parent_id').references(() => wikiPage.id), // nullable = top-level; no cascade, see §5 on reparenting
  position: integer('position').notNull().default(0), // manual order among siblings
  status: text('status', { enum: ['published', 'deleted'] }).$type<WikiPageStatus>().notNull().default('published'),
  version: integer('version').notNull().default(1), // bumped every save; optimistic-lock token
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const wikiPageRevision = pgTable('wiki_page_revision', {
  id: text('id').primaryKey(),
  pageId: text('page_id').notNull().references(() => wikiPage.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  content: jsonb('content').notNull(), // full snapshot, not a diff
  editedByUserId: text('edited_by_user_id').notNull().references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const wikiPageComment = pgTable('wiki_page_comment', {
  id: text('id').primaryKey(),
  pageId: text('page_id').notNull().references(() => wikiPage.id, { onDelete: 'cascade' }),
  authorUserId: text('author_user_id').notNull().references(() => user.id),
  body: text('body').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export type TaskStatus = 'backlog' | 'doing' | 'done';

export const task = pgTable('task', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  status: text('status', { enum: ['backlog', 'doing', 'done'] }).$type<TaskStatus>().notNull().default('backlog'),
  assigneeUserId: text('assignee_user_id').references(() => user.id), // nullable
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id),
  projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }), // nullable: standalone vs. a project's sub-todo
  imageUrl: text('image_url'), // nullable; same storage path as wiki images
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

Notes:

- No FK from `wikiPage` to a "current revision" row — avoids a circular
  reference. `wikiPage.title`/`content` is simply the latest state, kept in
  sync with the latest `wikiPageRevision` row inside the same service call
  (not a trigger). "Current" is always `wikiPage` itself; history is always
  `wikiPageRevision` ordered by `createdAt`.
- Deletion is the existing codebase's `status`-enum pattern (see
  `project.status`), not a hard delete — `deleted` pages drop out of the
  tree/search/nav but stay restorable (flip back to `published`) by any
  `wiki-editor`. No separate "trash" permission level.
- **My call, flag for confirmation**: deleting a page does *not* cascade to
  its children — a page with children can't be deleted until they're
  reparented or deleted first (service-level check, mirrors how `area`
  deletion already blocks on related rows elsewhere). Simpler than
  deciding what should happen to orphaned children automatically.
- `task` permissions: **my call** — same as event creation today (any
  active member, no new role), since this is project-management bookkeeping
  rather than content that needs protecting. Anyone can create/reassign/
  change status on any task; `createdByUserId` is just provenance, not an
  ownership gate.
- `wikiPageComment` deletion: author can delete their own; `admin` or
  `wiki-editor` can delete any (moderation), direct DB delete, no history
  kept for comments (unlike pages).

## 4. Editor & content format

BlockNote (built on Tiptap/ProseMirror) for the page body — Notion-style
block editing: slash-command menu, drag-and-drop reordering, image blocks,
built-in table blocks (covers the few tables in the export, e.g. the Wish
List table before it's split out per §8). `content` is BlockNote's native
JSON block array, stored as-is in `jsonb` — it's the editor's lossless
source of truth, so no conversion happens on every keystroke/save.

Search (§6) and migration (§9) both need plain text out of that JSON:
a small `extractPlainText(blocks): string` walks the block tree. No
separate Markdown copy is kept as a second source of truth — if
portability is ever needed, BlockNote's `blocksToMarkdownLossy()` can
generate one on demand from the JSON.

**Correction from the builder-check pass**: a Postgres `GENERATED ALWAYS
AS (...) STORED` column can't call application code, so `extractPlainText`
can't feed a true generated column directly. Instead: `wikiPage` gets a
plain `searchText: text` column, written by the service on every save
(`extractPlainText(content)`); a true DB-generated `tsvector` column,
`searchVector: tsvector('search_vector').generatedAlwaysAs(sql\`to_tsvector('english', title || ' ' || search_text)\`)`,
derives from `title` + that column via Postgres's own `to_tsvector`, GIN-indexed.
One extra column, but Postgres (not app code) still owns the tsvector.

## 5. Page tree, slugs & navigation

A page has one nullable `parentId` and a `position` among siblings — this
is purely for the sidebar tree and breadcrumbs, independent of the page's
URL. Moving a page (changing `parentId`/`position`) or renaming it (`title`)
never changes its `slug`, so no link anywhere ever breaks from
reorganizing. This directly mirrors `project.slug`: generated once from the
title via the existing `slugify()` + unique-suffix loop at creation time,
fixed forever after (confirmed: no rename path touches `project.slug`
today either).

Cross-page references (the Coda version's "Buildings" page linking to every
building, or Big Barn linking sideways to its neighbors) are just ordinary
links inside a page's BlockNote content — they don't need to match the
formal tree. No multi-parent modeling.

Reordering/reparenting UI: drag-and-drop in the sidebar tree, available to
any `wiki-editor`. **My call**: new top-level pages default to the end of
the root list; a page's children keep their relative order when the page
itself is moved.

URLs: `/wiki/[slug]`. No path nesting (`/wiki/buildings/big-barn`) — see
above, nesting is purely a tree/UI concept, not reflected in the URL.

## 6. Concurrent edits & search

**Concurrency**: optimistic locking via `wikiPage.version`. Loading a page
for edit captures its current `version`; saving passes that value back,
and the update is `WHERE id = ... AND version = $loaded`. Zero rows
updated → reject with "this page changed since you started editing,
reload to see the latest" and discard the in-progress edit. No merge
attempt. Expected to be rare for this community's size.

**Search**: a generated `tsvector` column (title + `extractPlainText`
output, §4) on `wikiPage`, indexed with a GIN index, queried via
`plainto_tsquery`. Exact/stemmed English matching only — no `pg_trgm`.

## 7. Comments

One flat list per page, oldest-first, rendered inline directly under the
page content (no separate "Discussion" view/route). A plain form at the
bottom to add one. Open to any active member — no `wiki-editor` requirement,
since a question/note is lower-stakes than editing content.

## 8. Images & storage

A small interface, `src/lib/wiki/image-storage.ts`:

```ts
export interface ImageStorage {
  put(key: string, buffer: Buffer, contentType: string): Promise<string>; // returns a public URL
  delete(key: string): Promise<void>;
}
```

- **Production**: `TigrisImageStorage`, an S3 client (`@aws-sdk/client-s3`,
  new dependency) pointed at the Tigris endpoint via the standard
  `AWS_*` env vars that `fly storage create` injects as app secrets.
- **Tests & dev default**: `LocalImageStorage`, writes to a gitignored
  folder on disk (served by a tiny dynamic route in dev) — used whenever
  the `AWS_*` env vars aren't set, which is the default everywhere except
  the deployed app. Mirrors the existing `FlyOps`/`fakeFly()` split in the
  box module (`src/lib/boxes/live.test.ts`): tests never touch a real
  external service.
- Uploads go through `prepareImageUpload(buffer): Promise<Buffer>` —
  `sharp`, resize to a max width (**my call: 1600px**, members' photos are
  usually much larger than any page needs), re-encode to webp. Reuses the
  `sharp` dependency already in the repo for avatars/map constants.
- A **production** Tigris bucket and a separate **dev** Tigris bucket are
  provisioned via the Tigris/Fly CLI (`fly storage create`, then
  `tigris env --format dotenv` for the dev bucket's credentials) — no
  manual console work, no secrets committed anywhere. ~$0.02/GB-month, free
  egress; at this corpus's size (~70 images today) this stays inside
  Tigris's free tier for a long time.
- **Deferred, not a blocker**: giving contributor boxes the dev bucket's
  credentials (a small, Tigris-only addition to `BoxSecrets`/`boxEnv()` in
  `src/lib/boxes/env.ts` — deliberately *not* the broad `FLY_API_TOKEN`
  that only admin boxes get today). Until that's done, contributor-box dev
  work just uses `LocalImageStorage` automatically; nothing is blocked.

## 9. Migration (one-time, re-runnable import)

A script (`src/lib/wiki/import-coda-export.ts` or similar, run via a
one-off `npm run` task, not a UI) reading the extracted export
(`manifest.json`, one `.md` per page, images alongside).

- **Tree construction**: the export has no explicit parent field — the
  root page (`Alversjo-Land-Manual.md`) and hub pages like `Buildings.md`
  are just bullet lists of links. The importer treats a page's leading
  bullet-list-of-links block as its children for tree purposes, walked
  recursively from the root; any page never reached this way becomes a
  top-level page. **My call, flag for confirmation**: I read all 36 pages'
  link structure to confirm this covers every page, but it's worth a
  manual look at the imported tree once before calling migration done.
- **Dropped entirely**: `Events.md`, `Calendar.md` (redundant with the
  events module).
- **Diverted, not imported as wiki pages**: `Stuff-Wish-List.md` — its
  17-row table becomes 17 `purchase`-kind `project` rows (title = item
  name, summary = "what it's for" + any note/link column), via the
  existing `projects` service, not new code.
- **Content cleanup**: strips the `[Original page](...) · Saved ...`
  header line and the trailing `## Image sources` section from rendered
  content on import (not useful to a member reading the page) — kept as
  import metadata (original Coda URL, import timestamp) rather than shown
  on the page, in case the original is ever needed for provenance.
- **Conversion**: remaining Markdown → BlockNote blocks via BlockNote's
  Markdown-import helper; images uploaded through the `ImageStorage`
  interface (§8) and references rewritten to the resulting URLs; internal
  links (`(Some-Page.md)`) rewritten to `/wiki/<slug>` by matching the
  original filename.
- **Work Weekends**: imported as a normal (static) wiki page preserving its
  dated log/table/photos as read-only history — **my call**: not backfilled
  into the new `task` table, since those are already-done 2022-23 chores,
  not live work to track. The `task` board starts empty.
- **Idempotency**: each imported page/project row records its source
  filename as import metadata; re-running the script upserts by that key
  (update existing content) rather than creating duplicates. Re-running
  after someone has since edited the live page **overwrites their edit**
  — **my call, flag for confirmation**: acceptable because this script is
  meant to run once, close to migration day, not as an ongoing sync; worth
  you confirming no one should be editing pages during that window.

## 10. Testing

Same pattern as every other module: `*.test.ts` beside each service file,
real PGlite + real migrations via `createDb('pglite://memory')`, no mocks
for the database. `ImageStorage` is the one seam that's swapped for a fake
in tests (§8), same shape as `FlyOps`. The importer gets tests against a
small fixture export (2-3 pages, not the real 36), not the live Coda data.

## 11. Open questions (yours, not mine to settle)

1. §2: this is the platform's first-ever public (unauthenticated) route.
   Confirm that's actually wanted — it also means every page's images are
   publicly fetchable URLs.
2. §9: confirm the "re-running the importer overwrites live edits" behavior
   is acceptable, given the plan is to run it once near migration day.
3. §9: once the importer's tree-building runs once, you should eyeball the
   resulting page tree before calling the migration done — some Coda pages
   may need their parent reassigned by hand (the heuristic is link-based,
   not a guarantee of Coda's original intent).
4. §2: does "active member" for role requests/comments/task creation mean
   paid-dues status (`isActiveMember`) — which is new authorization wiring,
   plus deciding what a lapsed member sees instead (hidden button? inline
   message?) — or just "logged in," matching how event creation actually
   works today? This doc assumes the latter until told otherwise.
