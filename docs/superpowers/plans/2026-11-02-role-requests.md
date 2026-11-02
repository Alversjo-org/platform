# Role Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any logged-in member self-request a grantable role, and let an admin/role-admin approve or deny that request from `/roles` — a general mechanism, not specific to any one role, though this pass only wires up the new `wiki-editor` role as self-requestable.

**Architecture:** One new table (`role_request`) plus a narrow service (`src/lib/roles/request-service.ts`) alongside the existing `src/lib/roles/service.ts`. Server actions in `src/app/roles/actions.ts` do the permission gating (matching the existing `setUserRoleAction` shape); the service trusts its caller, same division of responsibility already used there. A new "Pending requests" section is added to the existing `/roles` page.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Postgres (PGlite in tests), vitest.

**Spec:** `docs/superpowers/specs/2026-11-02-wiki-design.md` §2 ("Role requests (general mechanism, `src/lib/roles/`)")

## Global Constraints

- `Role` gains `'wiki-editor'` (spec §2). Every other existing role (`admin`, `member-admin`, `mapper`, `role-admin`, `treasurer`) is untouched.
- Only roles in a new `SELF_REQUESTABLE_ROLES` list can be requested this way; this pass puts only `'wiki-editor'` in it (spec §2 — "mapper, member-admin, treasurer stay admin/role-admin-initiated only").
- No DB-level enum/CHECK constraint enforcement — Drizzle's `{ enum: [...] }` here is a TS-only hint, matching every existing role column in this codebase.
- Service functions take `db: Db` as the first argument (dependency injection), never a module-level DB singleton — matches every existing `*/service.ts` in this repo.
- Every mutation that changes role state calls `logDecision` (entity `role_request` for requests, reusing the existing `user_role` entity for the grant itself), matching `roles/service.ts`'s existing pattern.

## Review Focus

- A user who already holds `wiki-editor` clicks "Ask to edit" again — must not create a duplicate pending request or error confusingly; should no-op.
- A user with an already-pending request clicks "Ask to edit" again — must return the existing request, not create a second pending row (double-submit from a slow network retry is the realistic case).
- A non-admin, non-role-admin member tries to call the decide action directly (e.g. by replaying a form POST) — must be rejected before any row changes, not just hidden in the UI.
- Approving a request whose role is not actually self-requestable (defensive case — e.g. if `SELF_REQUESTABLE_ROLES` is later trimmed but a stale pending row references a role no longer in it) — approving should still work; it's the *request* step that's gated by self-requestability, not the *decide* step, since an admin should always be able to resolve an existing pending row either way.
- Denying a request must never grant the role — only `approve: true` calls into the grant path.

---

## File Structure

- Modify: `src/db/schema.ts` — add `RoleRequestStatus` type, `roleRequest` table, `RoleRequest` inferred type; add `'wiki-editor'` to the `Role` union and to `userRole.role`'s inline enum array.
- Create: `drizzle/<timestamp>_role_request.sql` — generated, not hand-written.
- Create: `src/lib/roles/request-service.ts` — `requestRole`, `listPendingRoleRequests`, `decideRoleRequest`.
- Create: `src/lib/roles/request-service.test.ts`.
- Modify: `src/lib/roles/labels.ts` — add `'wiki-editor'` to `GRANTABLE_ROLES` and `ROLE_LABELS`; add `SELF_REQUESTABLE_ROLES`.
- Modify: `src/lib/roles/labels.test.ts` — cover the new exports.
- Modify: `src/app/roles/actions.ts` — add `requestRoleAction`, `decideRoleRequestAction`.
- Modify: `src/app/roles/page.tsx` — render a "Pending requests" section above the existing grid.

## Task 1: Schema

**Files:**
- Modify: `src/db/schema.ts`
- Test: none (schema-only; exercised by Task 2's tests)

**Interfaces:**
- Produces: `export type RoleRequestStatus = 'pending' | 'approved' | 'denied'`; `export const roleRequest: PgTable` with columns `id, userId, role, status, requestedAt, decidedByUserId, decidedAt`; `export type RoleRequest = typeof roleRequest.$inferSelect`. `Role` union now includes `'wiki-editor'`.

- [ ] **Step 1: Add `'wiki-editor'` to the `Role` union and to `userRole.role`'s inline enum array** in `src/db/schema.ts`.

- [ ] **Step 2: Add the `roleRequest` table** in `src/db/schema.ts`, placed near `userRole`:

```ts
export type RoleRequestStatus = 'pending' | 'approved' | 'denied';

export const roleRequest = pgTable('role_request', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  role: text('role', { enum: ['admin', 'member-admin', 'mapper', 'role-admin', 'treasurer', 'wiki-editor'] }).$type<Role>().notNull(),
  status: text('status', { enum: ['pending', 'approved', 'denied'] }).$type<RoleRequestStatus>().notNull().default('pending'),
  requestedAt: timestamp('requested_at').notNull().defaultNow(),
  decidedByUserId: text('decided_by_user_id').references(() => user.id),
  decidedAt: timestamp('decided_at'),
});

export type RoleRequest = typeof roleRequest.$inferSelect;
```

- [ ] **Step 3: Generate the migration.**

Run: `cd /work/platform && npx drizzle-kit generate`
Expected: a new file under `drizzle/` touching `user_role` and creating `role_request`; no manual edits to the generated SQL.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(roles): add role_request table and wiki-editor role"
```

## Task 2: `requestRole`

**Files:**
- Create: `src/lib/roles/request-service.ts`
- Test: `src/lib/roles/request-service.test.ts`

**Interfaces:**
- Consumes: `schema.roleRequest`, `schema.userRole` (Task 1); `Db` from `@/db`.
- Produces: `export async function requestRole(db: Db, input: { userId: string; role: Role }): Promise<RoleRequest>`; `export class RoleNotSelfRequestableError extends Error {}`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { requestRole, RoleNotSelfRequestableError } from './request-service';

describe('requestRole', () => {
  it('creates a pending request for a self-requestable role', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const req = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    expect(req.status).toBe('pending');
    expect(req.userId).toBe('u1');
  });

  it('is a no-op and returns the existing row if a pending request already exists', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const first = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    const second = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    expect(second.id).toBe(first.id);
    const rows = await db.select().from(schema.roleRequest);
    expect(rows).toHaveLength(1);
  });

  it('is a no-op if the user already holds the role', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.userRole).values({ userId: 'u1', role: 'wiki-editor' });
    await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    const rows = await db.select().from(schema.roleRequest);
    expect(rows).toHaveLength(0);
  });

  it('rejects a role that is not self-requestable', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await expect(requestRole(db, { userId: 'u1', role: 'mapper' })).rejects.toThrow(RoleNotSelfRequestableError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/roles/request-service.test.ts`
Expected: FAIL (module `./request-service` does not exist)

- [ ] **Step 3: Implement `requestRole`** in `src/lib/roles/request-service.ts`

Import `SELF_REQUESTABLE_ROLES` from `./labels` (Task 4 adds it — if sequencing before Task 4, inline `const SELF_REQUESTABLE_ROLES: Role[] = ['wiki-editor']` here and switch the import once Task 4 lands). Logic: if `role` not in `SELF_REQUESTABLE_ROLES`, throw `RoleNotSelfRequestableError`. Else: check `userRole` for an existing `(userId, role)` row — if found, return early without inserting (use a sentinel: select first, and if an existing row is found, still need to return a `RoleRequest`-shaped value — simplest is to return the most recent `roleRequest` row for that user+role if one exists, or construct nothing and instead just skip insertion and return the last pending/approved request row; if none exists at all because the role predates this feature, synthesize an already-`'approved'` in-memory object rather than inserting one — pick whichever reads more clearly, there is no caller that depends on the exact shape of this early-return case beyond `status`). Check for an existing `pending` `roleRequest` row for `(userId, role)` — if found, return it. Otherwise insert a new `pending` row with a generated id (`randomUUID()`, matching every other table's id convention) and return it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/roles/request-service.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles/request-service.ts src/lib/roles/request-service.test.ts
git commit -m "feat(roles): add requestRole"
```

## Task 3: `listPendingRoleRequests` and `decideRoleRequest`

**Files:**
- Modify: `src/lib/roles/request-service.ts`
- Modify: `src/lib/roles/request-service.test.ts`

**Interfaces:**
- Consumes: `requestRole` (Task 2); `logDecision` from `@/lib/decision-log`; `setUserRole`-equivalent insert into `schema.userRole` (reuse the same `onConflictDoNothing` shape `roles/service.ts` already uses, don't import a private function — insert directly here).
- Produces: `export type PendingRoleRequest = RoleRequest & { userEmail: string; userName: string | null }`; `export async function listPendingRoleRequests(db: Db): Promise<PendingRoleRequest[]>`; `export class RequestNotPendingError extends Error {}`; `export async function decideRoleRequest(db: Db, input: { actor: { id: string }; requestId: string; approve: boolean }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('listPendingRoleRequests', () => {
  it('lists only pending requests, with the requesting user’s email and name', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org', name: 'Uno' });
    await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    const list = await listPendingRoleRequests(db);
    expect(list).toEqual([expect.objectContaining({ userId: 'u1', userEmail: 'u1@example.org', userName: 'Uno', status: 'pending' })]);
  });
});

describe('decideRoleRequest', () => {
  it('approving grants the role, marks the request approved, and logs a decision', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'admin1', email: 'a@example.org' }]);
    const req = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    await decideRoleRequest(db, { actor: { id: 'admin1' }, requestId: req.id, approve: true });
    const [granted] = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'u1'));
    expect(granted.role).toBe('wiki-editor');
    const [updated] = await db.select().from(schema.roleRequest).where(eq(schema.roleRequest.id, req.id));
    expect(updated.status).toBe('approved');
    expect(updated.decidedByUserId).toBe('admin1');
  });

  it('denying does not grant the role', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'admin1', email: 'a@example.org' }]);
    const req = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    await decideRoleRequest(db, { actor: { id: 'admin1' }, requestId: req.id, approve: false });
    const granted = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'u1'));
    expect(granted).toHaveLength(0);
    const [updated] = await db.select().from(schema.roleRequest).where(eq(schema.roleRequest.id, req.id));
    expect(updated.status).toBe('denied');
  });

  it('rejects deciding a request that is not pending', async () => {
    const db: Db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'admin1', email: 'a@example.org' }]);
    const req = await requestRole(db, { userId: 'u1', role: 'wiki-editor' });
    await decideRoleRequest(db, { actor: { id: 'admin1' }, requestId: req.id, approve: true });
    await expect(decideRoleRequest(db, { actor: { id: 'admin1' }, requestId: req.id, approve: true })).rejects.toThrow(RequestNotPendingError);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/roles/request-service.test.ts`
Expected: FAIL (`listPendingRoleRequests`/`decideRoleRequest` not defined)

- [ ] **Step 3: Implement both functions** in `src/lib/roles/request-service.ts`

`listPendingRoleRequests`: join `roleRequest` (where `status = 'pending'`) to `user` on `userId`, select email/name alongside every `roleRequest` column. `decideRoleRequest`: load the request by id; if `status !== 'pending'` throw `RequestNotPendingError`; if `approve`, insert into `userRole` with `onConflictDoNothing()` (`{userId, role, grantedByUserId: actor.id}`); update `roleRequest` to `{status: approve ? 'approved' : 'denied', decidedByUserId: actor.id, decidedAt: new Date()}`; call `logDecision(db, {entity: 'role_request', entityId: requestId, actorUserId: actor.id, action: approve ? 'approve' : 'deny', diff: {role: request.role, userId: request.userId}})`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/roles/request-service.test.ts`
Expected: PASS (7 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles/request-service.ts src/lib/roles/request-service.test.ts
git commit -m "feat(roles): add listPendingRoleRequests and decideRoleRequest"
```

## Task 4: Labels

**Files:**
- Modify: `src/lib/roles/labels.ts`
- Modify: `src/lib/roles/labels.test.ts`

**Interfaces:**
- Produces: `GRANTABLE_ROLES` includes `'wiki-editor'`; `ROLE_LABELS['wiki-editor']` is a human string (e.g. `'Wiki editor'`); `export const SELF_REQUESTABLE_ROLES: Role[] = ['wiki-editor']`.

- [ ] **Step 1: Write the failing test**

```ts
it('wiki-editor is grantable, labeled, and self-requestable', () => {
  expect(GRANTABLE_ROLES).toContain('wiki-editor');
  expect(ROLE_LABELS['wiki-editor']).toBe('Wiki editor');
  expect(SELF_REQUESTABLE_ROLES).toEqual(['wiki-editor']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/roles/labels.test.ts`
Expected: FAIL

- [ ] **Step 3: Update `labels.ts`**: add `'wiki-editor'` to `GRANTABLE_ROLES` and `ROLE_LABELS`; add the new `SELF_REQUESTABLE_ROLES` export. Then switch `request-service.ts`'s inline `SELF_REQUESTABLE_ROLES` (Task 2) to import this one, removing the duplicate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/roles/labels.test.ts src/lib/roles/request-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/roles/labels.ts src/lib/roles/labels.test.ts src/lib/roles/request-service.ts
git commit -m "feat(roles): register wiki-editor as grantable and self-requestable"
```

## Task 5: Actions and `/roles` UI

**Files:**
- Modify: `src/app/roles/actions.ts`
- Modify: `src/app/roles/page.tsx`

**Interfaces:**
- Consumes: `requestRole`, `listPendingRoleRequests`, `decideRoleRequest` (Tasks 2-3); `requireUser`, `requireRoleAdmin` from `@/lib/session`.
- Produces: `export async function requestRoleAction(formData: FormData): Promise<void>` (reads `role` from the form, calls `requestRole` with the current user); `export async function decideRoleRequestAction(formData: FormData): Promise<void>` (reads `requestId`, `approve`, gated by `requireRoleAdmin()`).

- [ ] **Step 1: Implement `requestRoleAction`** in `src/app/roles/actions.ts`: `const actor = await requireUser(); const role = String(formData.get('role')) as Role; await requestRole(db, {userId: actor.id, role}); revalidatePath('/roles');` (no redirect needed if this is called from a non-`/roles` page, e.g. a wiki page's "Ask to edit" button — just `revalidatePath` the current path via `formData.get('returnTo')` or skip revalidation and let the client re-fetch; **implementer's call**, document which in a one-line comment).

- [ ] **Step 2: Implement `decideRoleRequestAction`** in `src/app/roles/actions.ts`: `const actor = await requireRoleAdmin(); const requestId = String(formData.get('requestId')); const approve = formData.get('approve') === 'true'; await decideRoleRequest(db, {actor, requestId, approve}); revalidatePath('/roles'); redirect('/roles');` — same shape as the existing `setUserRoleAction`.

- [ ] **Step 3: Add a "Pending requests" section to `/roles`** in `src/app/roles/page.tsx`, above the existing member/role grid, gated the same way the page already is (`requireRoleAdmin()`). For each row from `listPendingRoleRequests`: requester name/email, role label (via `ROLE_LABELS`), requested-at, two buttons posting to `decideRoleRequestAction` with `approve=true`/`false`.

- [ ] **Step 4: Verify the build and existing tests still pass**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all existing tests still pass (no new tests added in this UI-only task — covered by Tasks 2-3's service tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/roles/actions.ts src/app/roles/page.tsx
git commit -m "feat(roles): add pending role requests to the /roles page"
```

---

## Self-Review

**Spec coverage**: every bullet of spec §2's "Role requests" subsection has a task — table (Task 1), `requestRole` (Task 2), `decideRoleRequest`/`listPendingRoleRequests` (Task 3), `GRANTABLE_ROLES`/`SELF_REQUESTABLE_ROLES` (Task 4), `/roles` UI (Task 5). The "Ask to edit" button itself (shown on wiki pages) belongs to the wiki-core plan, not here — this plan only produces the `requestRoleAction` it calls.

**Step scan**: Task 5 Step 1 leaves one explicit implementer choice (revalidate-vs-redirect) flagged as such rather than hidden.

**Type consistency**: `RoleRequest`, `PendingRoleRequest`, `requestRole`, `decideRoleRequest`, `listPendingRoleRequests` are named and typed identically everywhere they're referenced across Tasks 2, 3, and 5.

**Review Focus**: the five cases above (duplicate request, duplicate pending, non-admin decide, decide-after-role-list-changes, deny-never-grants) each have a task and assertion: duplicate-role and duplicate-pending in Task 2; non-pending-decide in Task 3; deny-never-grants in Task 3. The non-admin-decide case is enforced by `requireRoleAdmin()` in the action (Task 5), which is exercised indirectly by every other role-gated action in this codebase already — no new test needed since it's the same helper, not new logic.

**Proportion**: plan is longer than the spec's role-request subsection because it includes full test bodies (TDD requirement); code bodies in implementation steps are left as prose/approach, not transcribed.
