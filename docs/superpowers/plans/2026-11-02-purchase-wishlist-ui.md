# Purchase-Project Wishlist UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing, currently-unused `project.kind = 'purchase'` a real home: a minimal list/detail/create UI at `/wishlist`, so the Coda "Stuff Wish List" has somewhere to live once migrated (a later, separate migration plan inserts the 17 rows this UI will display).

**Architecture:** No schema change — `project` already supports this `kind`. A small new service file (`src/lib/projects/purchase-service.ts`) alongside the existing `src/lib/projects/service.ts`, reusing its `uniqueSlug`/`transitionStatus`/`logDecision` machinery rather than duplicating it. New routes under `src/app/wishlist/`.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Postgres (PGlite in tests), vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-wiki-design.md` §1 ("Stuff Wish List becomes 17 `purchase`-kind project rows... plus a minimal list/detail view").

## Global Constraints

- Any logged-in member can add a wishlist item — no `canCreateEvents`-style gate (that flag is event-specific; a wishlist item isn't an event). No new role.
- A wishlist item is created directly in `status: 'published'` — there is no draft/review step for this kind, unlike events. It becomes invisible on the list once marked fulfilled (`status: 'closed'`, via the *existing* `transitionStatus`, unchanged).
- No new `projectMember` row on creation — the "lead organizer" concept is event-specific; `project.ownerUserId` alone records who added the item.
- `transitionStatus` (existing function) is reused as-is for marking an item fulfilled — it is not modified by this plan. Its event-only publish check (`to === 'published'` requires `eventDetails`) is never triggered here because purchase items are created already-published.

## Review Focus

- Two members submit a wishlist item with the same title in quick succession — must get distinct slugs (`uniqueSlug`'s existing collision-suffix behavior), not a unique-constraint error.
- Listing the wishlist must never show a `draft`/`cancelled`/`archived` row, and must never show rows of a different `kind` (e.g. an event) — the filter is on both `kind` and `status`.
- Marking an item fulfilled removes it from the default list view but the row and its history (via `logDecision`, already called by `transitionStatus`) still exist — confirm nothing calls `DELETE`.
- An anonymous (logged-out) visitor hitting `/wishlist/new` must be redirected, not shown the form — `requireUser()` gate, same as every other write path in this app (this module has no public surface, unlike the wiki).

---

## File Structure

- Create: `src/lib/projects/purchase-service.ts` — `createPurchaseProject`, `listPurchaseProjects`.
- Create: `src/lib/projects/purchase-service.test.ts`.
- Modify: `src/lib/projects/service.ts` — export `uniqueSlug` (currently private) so the new file can reuse it instead of reimplementing collision handling.
- Create: `src/app/wishlist/page.tsx` — list view.
- Create: `src/app/wishlist/[slug]/page.tsx` — detail view.
- Create: `src/app/wishlist/new/page.tsx` — create form.
- Create: `src/app/wishlist/actions.ts` — `createPurchaseProjectAction`, `markFulfilledAction`.
- Modify: `src/components/app-shell.tsx` — add a "Wishlist" nav link, visible to any logged-in member.

## Task 1: `uniqueSlug` export

**Files:**
- Modify: `src/lib/projects/service.ts:45-53`

**Interfaces:**
- Produces: `export async function uniqueSlug(db: Db, base: string): Promise<string>` (same body, just exported — no signature or behavior change).

- [ ] **Step 1: Add `export` to the existing `uniqueSlug` function.** No test needed — behavior is unchanged and already covered by `createEvent`'s/`duplicateEvent`'s existing tests, which continue to pass unmodified.

- [ ] **Step 2: Run the existing projects test suite to confirm nothing broke.**

Run: `npx vitest run src/lib/projects`
Expected: PASS, same count as before this change.

- [ ] **Step 3: Commit**

```bash
git add src/lib/projects/service.ts
git commit -m "refactor(projects): export uniqueSlug for reuse by purchase-service"
```

## Task 2: Purchase service

**Files:**
- Create: `src/lib/projects/purchase-service.ts`
- Test: `src/lib/projects/purchase-service.test.ts`

**Interfaces:**
- Consumes: `uniqueSlug` (Task 1); `slugify` from `@/lib/slug`; `schema.project` from `@/db`.
- Produces: `export async function createPurchaseProject(db: Db, input: { title: string; summary: string; body?: string; ownerUserId: string }): Promise<Project>`; `export async function listPurchaseProjects(db: Db): Promise<Project[]>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { transitionStatus } from '@/lib/projects/service';
import { createPurchaseProject, listPurchaseProjects } from './purchase-service';

describe('createPurchaseProject', () => {
  it('creates a published purchase-kind project owned by the creator', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const p = await createPurchaseProject(db, { title: 'Woodchipper', summary: 'For clearing brush', ownerUserId: 'u1' });
    expect(p.kind).toBe('purchase');
    expect(p.status).toBe('published');
    expect(p.ownerUserId).toBe('u1');
  });

  it('gives colliding titles distinct slugs', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const a = await createPurchaseProject(db, { title: 'Ladder', summary: '', ownerUserId: 'u1' });
    const b = await createPurchaseProject(db, { title: 'Ladder', summary: '', ownerUserId: 'u1' });
    expect(a.slug).not.toBe(b.slug);
  });
});

describe('listPurchaseProjects', () => {
  it('lists only published purchase-kind projects', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const wanted = await createPurchaseProject(db, { title: 'Tractor', summary: '', ownerUserId: 'u1' });
    const fulfilled = await createPurchaseProject(db, { title: 'Digger', summary: '', ownerUserId: 'u1' });
    await transitionStatus(db, { projectId: fulfilled.id, to: 'closed', actorUserId: 'u1' });
    await db.insert(schema.project).values({ id: 'e1', slug: 'e1', title: 'An event', kind: 'event', status: 'published', ownerUserId: 'u1' });
    const list = await listPurchaseProjects(db);
    expect(list.map((p) => p.id)).toEqual([wanted.id]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/projects/purchase-service.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement both functions** in `src/lib/projects/purchase-service.ts`: `createPurchaseProject` mirrors `createEvent`'s slug/insert shape but with `kind: 'purchase'`, `status: 'published'`, no `canCreateEvents` check, no `projectMember` insert, no transaction needed (single insert). `listPurchaseProjects` selects `schema.project` `WHERE kind = 'purchase' AND status = 'published'`, ordered by `createdAt` descending.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/projects/purchase-service.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/projects/purchase-service.ts src/lib/projects/purchase-service.test.ts
git commit -m "feat(projects): add purchase-service for the wishlist"
```

## Task 3: Wishlist UI

**Files:**
- Create: `src/app/wishlist/page.tsx`
- Create: `src/app/wishlist/[slug]/page.tsx`
- Create: `src/app/wishlist/new/page.tsx`
- Create: `src/app/wishlist/actions.ts`
- Modify: `src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `createPurchaseProject`, `listPurchaseProjects` (Task 2); `getProjectBySlug`, `transitionStatus` (existing, `src/lib/projects/service.ts`); `requireUser` from `@/lib/session`.
- Produces: `createPurchaseProjectAction`, `markFulfilledAction` server actions.

- [ ] **Step 1: Implement `src/app/wishlist/actions.ts`**: `createPurchaseProjectAction(formData)` — `requireUser()`, read `title`/`summary`/`body`, call `createPurchaseProject`, `redirect('/wishlist')`. `markFulfilledAction(formData)` — `requireUser()`, read `projectId`, call `transitionStatus(db, {projectId, to: 'closed', actorUserId: actor.id})`, `revalidatePath('/wishlist')`.

- [ ] **Step 2: Implement `src/app/wishlist/page.tsx`**: `requireUser()`, render `listPurchaseProjects` as a simple list (title linking to the detail page, summary, a "Got it" button posting to `markFulfilledAction`) and a link to `/wishlist/new`.

- [ ] **Step 3: Implement `src/app/wishlist/[slug]/page.tsx`**: `requireUser()`, `getProjectBySlug`; 404 (via `notFound()`) if missing or not `kind === 'purchase'`; render title/summary/body.

- [ ] **Step 4: Implement `src/app/wishlist/new/page.tsx`**: `requireUser()`, a form (title, summary, body) posting to `createPurchaseProjectAction`.

- [ ] **Step 5: Add a "Wishlist" link to the nav** in `src/components/app-shell.tsx`, visible to any logged-in member.

- [ ] **Step 6: Verify the build and existing tests still pass**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/wishlist src/components/app-shell.tsx
git commit -m "feat(projects): add wishlist UI for purchase-kind projects"
```

---

## Self-Review

**Spec coverage**: the spec's one concrete ask here — "a minimal list/detail view for purchase-kind projects... just enough to list and view wish-list items" — is covered by Task 3. The 17-row data migration itself is explicitly a different, later plan (migration), which will call `createPurchaseProject` directly.

**Step scan**: Task 1 has no test step because it's a pure visibility change with zero behavior change, caught by the existing suite — adding a test that only asserts "the function exists" would be a transcript, not a test.

**Type consistency**: `createPurchaseProject`'s input/return shape matches `createEvent`'s existing shape minus the fields that don't apply (no `canCreateEvents` check); `listPurchaseProjects`'s return type (`Project[]`) matches every other `list*` function in `projects`/`events`.

**Review Focus**: slug collision (Task 2 test 2), kind+status filtering (Task 2 test 3), fulfilled-but-not-deleted (implied by test 3 using `transitionStatus` rather than any delete call — no delete function exists in this plan or `service.ts` at all), logged-out redirect (covered by the existing, unmodified `requireUser()` helper — not new behavior to test here).

**Proportion**: this is the smallest of the five plans, matching how little new logic it actually introduces — most of the heavy lifting (`uniqueSlug`, `transitionStatus`, `logDecision`) is reused, not rebuilt.
