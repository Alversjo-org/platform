# Event drafts and publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After creating or editing an event, an organiser can actually find and publish their draft — `/events` surfaces their own drafts, and the edit page (where `createEventAction`/`updateEventMetaAction` land them) carries its own Publish/Cancel/Close/Archive controls instead of requiring a trip to the event's public page.

**Architecture:** `/events` gets one more query, scoped to the signed-in user's own `project_member` rows with `status = 'draft'`, surfaced as a new section above Upcoming/Past using the page's existing `EventTable`. The edit page gets the exact transition-button block that `/events/[slug]/page.tsx` already renders (same `ALLOWED_TRANSITIONS`/`getEventRole` logic, same `publishAction`/`cancelEventAction`/`closeEventAction`/`archiveEventAction` from `../actions`) — this block already exists as an uncommitted diff in this worktree and only needs verifying and committing. The "noisy redirect" is investigated last, as a flake triage, not a guaranteed code change.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Drizzle on PGlite, vitest.

**Spec:** No separate spec doc — the spec is the diagnosis in this conversation: (1) show the user's own drafts on `/events`, (2) put a Publish button on the edit page, (3) optionally quiet the redirect error. Confirmed live against a running dev server on this box before writing this plan:
- A fresh draft never appears anywhere on `/events` (checked via direct DB query + rendered HTML).
- `createEventAction`/`updateEventMetaAction` land the organiser on `/events/<slug>/edit`, which today has no status badge or transition buttons — those only exist on `/events/<slug>` (`src/app/events/[slug]/page.tsx:106-113`).
- The uncommitted diff to `src/app/events/[slug]/edit/page.tsx` in this worktree reproduces that exact block and is otherwise correct (imports, `ALLOWED_TRANSITIONS`, `getEventRole` all already exist on `main`).
- Clicking Publish via a real (JS, `fetch`-action) request reproducibly 500s with a server-logged `Error: Connection closed.` (digest `1426309558`), thrown by Next's own app-relative-redirect streaming (`action-handler.js`'s `createRedirectRenderResult`), not by any app `catch` block — every `redirect()` call site in this codebase already follows the correct `if (e instanceof X) redirect(...); throw e;` pattern. The same transition via a plain (no-JS) form POST completes with a clean 303, no noise. This environment also had ~10 leftover `vitest --watch` processes from an unrelated session saturating CPU/RAM throughout testing, so resource contention is a live confound and must be ruled out before treating this as a code bug.

## Global Constraints

- Follow existing repo conventions exactly: `'use server'` actions parse `FormData`, call a service function, `revalidatePath`, then `redirect` — already true of every action touched here, don't restructure it.
- `ALLOWED_TRANSITIONS`, `getEventRole`, `canViewEvent`, `publishAction`/`cancelEventAction`/`closeEventAction`/`archiveEventAction` already exist (`src/lib/projects/service.ts`, `src/lib/projects/authorization.ts`, `src/app/events/[slug]/actions.ts`) — reuse them verbatim, do not duplicate or rename.
- A draft is only ever visible to its organisers (`project_member` row) or a member-admin/admin override — never list another member's draft (`canViewEvent` in `src/lib/projects/authorization.ts` encodes this rule; the new `/events` query must not contradict it).
- Service-level functions get `*.test.ts` beside them using `createDb('pglite://memory')`, matching `src/lib/projects/service.test.ts`; this codebase has no page-level/route tests, so `page.tsx` changes are verified by a quick manual pass against the dev server, not new test files.

## Review Focus

- A member-admin/override who is not an organiser on an event seeing it under "your drafts" — the query must filter by `project_member.user_id = <current user>`, not just `kind='event' AND status='draft'`.
- A `cocreator` (not `lead`) on a draft seeing Publish/Archive buttons on the edit page they shouldn't have — `canManage` must stay `role === 'lead' || role === 'override'`, matching the detail page exactly.
- An event with no `event_details` row yet (shouldn't normally happen post-creation, but `IncompleteEventError` exists for a reason) showing a Publish button that then redirects to `/events/<slug>/edit?error=...` with no visible change — confirm the edit page already renders the `error` query param (it does, `src/app/events/[slug]/edit/page.tsx:24,50`).
- A cancelled/closed/archived event's organiser expecting to see it in the new "your drafts" section — out of scope per the spec ("your own drafts"); confirm the query is scoped to `status = 'draft'` only, not "any non-published status," so this doesn't silently balloon.
- Publishing from the edit page leaving the user looking at a stale page (no `revalidatePath('/events')`) even though the new drafts section depends on fresh data — `transition()` in `src/app/events/[slug]/actions.ts:67-79` only revalidates `/events/${slug}`, not `/events`.

---

## Task 1: Show the organiser's own drafts on `/events`

**Files:**
- Modify: `src/app/events/page.tsx`

**Interfaces:**
- Consumes: `schema.project`, `schema.eventDetails`, `schema.projectMember` from `@/db` (existing); `EventTable`/`EventRow` already defined in this file.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Add the draft query**

  In `EventsPage`, after the existing `rows` query, add a second query joining `project` → `eventDetails` → `projectMember`, filtered to `kind='event'`, `status='draft'`, and `projectMember.userId = user.id`:

  ```ts
  const draftRows = await db.select({ project: schema.project, details: schema.eventDetails })
    .from(schema.project)
    .innerJoin(schema.eventDetails, eq(schema.eventDetails.projectId, schema.project.id))
    .innerJoin(schema.projectMember, eq(schema.projectMember.projectId, schema.project.id))
    .where(and(
      eq(schema.project.kind, 'event'),
      eq(schema.project.status, 'draft'),
      eq(schema.projectMember.userId, user.id),
    ))
    .orderBy(desc(schema.project.updatedAt));
  ```

  Add `desc` to the existing `drizzle-orm` import alongside `and`, `eq`.

- [ ] **Step 2: Render the section**

  Above the "Upcoming" `<h2>`, render a "Your drafts" section using the same `EventTable` component, only when non-empty:

  ```tsx
  {draftRows.length > 0 && (
    <>
      <h2 className="mb-2 text-lg font-medium">Your drafts</h2>
      <EventTable items={draftRows} />
    </>
  )}
  ```

  `EventTable` links each row to `/events/${project.slug}` (its edit affordance lives there, per Task 2) and calls `formatEventWhen`, which both work unchanged for drafts.

- [ ] **Step 3: Manual verification**

  With the dev server running (`npm run dev`), sign in, create an event via `/events/new`, then load `/events`. Confirm the new draft appears under "Your drafts" and does not appear under "Upcoming"/"Past". Confirm a second member account does not see it at all.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/events/page.tsx
  git commit -m "feat: show the organiser's own drafts on /events"
  ```

## Task 2: Publish/Cancel/Close/Archive buttons on the edit page

**Files:**
- Modify: `src/app/events/[slug]/edit/page.tsx` (already modified, uncommitted, in this worktree)
- Modify: `src/app/events/[slug]/actions.ts` (add one `revalidatePath` call)

**Interfaces:**
- Consumes: `publishAction`, `cancelEventAction`, `closeEventAction`, `archiveEventAction` from `../actions` (already exported); `ALLOWED_TRANSITIONS` from `@/lib/projects/service`; `getEventRole` from `@/lib/projects/authorization`. All already exist on `main` — no new exports needed.
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Review the existing uncommitted diff**

  Run `git diff -- src/app/events/\[slug\]/edit/page.tsx` and confirm it matches the transition-button block already shipped on `src/app/events/[slug]/page.tsx:106-113` (same four `allowedNext.includes(...)` conditions, same hidden `slug` input, same `canManage` gate). It does as of this plan's writing — no code change should be needed here, only review.

- [ ] **Step 2: Revalidate `/events` on every transition**

  In `src/app/events/[slug]/actions.ts`, the shared `transition()` helper (around line 67-79) currently calls `revalidatePath(`/events/${slug}`)` but not `/events`. Since Task 1 put a drafts list on `/events` that must drop an entry the moment it's published/archived, add a second call:

  ```ts
  revalidatePath(`/events/${slug}`);
  revalidatePath('/events');
  redirect(`/events/${slug}`);
  ```

- [ ] **Step 3: Manual verification**

  Using the draft created in Task 1's verification pass, open `/events/<slug>/edit`, confirm the status badge and a Publish button are visible, click Publish, confirm it lands on `/events/<slug>` (the public page — `transition()` redirects there, not back to `/edit`) showing status `published`. Reload `/events` and confirm the event moved from "Your drafts" to "Upcoming"/"Past" and disappeared from drafts.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/events/\[slug\]/edit/page.tsx src/app/events/\[slug\]/actions.ts
  git commit -m "feat: add status transition buttons to the event edit page"
  ```

## Task 3: Triage the noisy redirect error (optional — investigate before changing code)

**Files:**
- Investigate only; modify only if Step 2 confirms a reproducible, non-environmental cause.

**Interfaces:**
- None — this task does not produce anything Task 1/2 depend on, and can be skipped or dropped without affecting them.

- [ ] **Step 1: Rule out resource contention**

  Run `ps aux | grep vitest` before starting the dev server. If leftover `vitest`/`forks.js` processes from an unrelated session are present, this box's CPU/RAM is already contended — note that and do not treat it as the production behavior. Do not kill another session's processes without asking first.

- [ ] **Step 2: Reproduce the real (JS) publish click**

  A plain `<form>` POST (no JS) publishes cleanly with a 303 — confirmed. The actual button click in a browser is a Server Actions `fetch` request, which is harder to fake with `curl` but was reproduced this way during planning: fetch `/events/<slug>/edit`, extract the Publish form's `$ACTION_ID_...` hidden field name, then POST to `/events/<slug>` with that field plus `slug=<slug>` as multipart form data, and headers `Next-Action: <the same id, without the $ACTION_ID_ prefix>`, `Accept: text/x-component`, `Origin: http://localhost:<port>`. On this box (even on a fresh draft, valid `draft→published` transition) this returned `500` with a server-logged `Error: Connection closed.` (digest `1426309558`), while the DB showed the transition had *not* taken effect (status remained `draft`) — so the failure happens before or during the action, not only during the post-success redirect render.

  If a real browser (not curl) is available in this environment, prefer that: open the edit page, click Publish, watch both the terminal and the Network tab. Trust the browser result over the curl approximation if they disagree — curl cannot perfectly replicate the Server Actions wire protocol (e.g. it omits the `Next-Router-State-Tree` header a real client sends).

- [ ] **Step 3: Decide whether this is an app bug**

  - If it only reproduces while other heavy processes are contending for CPU/RAM (per Step 1), record that finding in the PR description and stop — it is environmental, not a code defect, and there is nothing to change.
  - If it reproduces cleanly on an idle box with a real browser, the next place to look is `createRedirectRenderResult` in `node_modules/next/dist/server/app-render/action-handler.js` (the same-origin self-fetch Next performs to stream a Server Action's redirect target without a full page reload) and how the custom `createServer` handler in `server.ts` processes that self-fetch — in particular whether it ever fails to forward the original `Host` header, which that function requires (`action-handler.js:270`, "Missing `host` header from a forwarded Server Actions request").

- [ ] **Step 4: Fix and verify, or close out**

  If Step 3 finds a concrete, narrow cause in this app's code (not a Next.js internal), fix it and re-run the Step 2 repro to confirm the 500 and console error are both gone, with the transition still completing. If Step 3 doesn't turn up an app-side cause, leave the code as-is and note the finding (with repro steps) in the PR description for whoever picks this up next — do not guess at a fix for a framework-internal error.

  Commit only if a code change was made:

  ```bash
  git add -A
  git commit -m "fix: <describe the actual cause found in step 3>"
  ```
