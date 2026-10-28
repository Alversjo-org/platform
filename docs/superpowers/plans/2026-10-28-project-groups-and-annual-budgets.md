# Project groups and annual budgets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a treasurer group projects into budget areas mapped to Fortnox cost centres, enter and approve a versioned annual budget per group (and optionally per project) per month, and assign an existing project to a group.

**Architecture:** Two new flat service modules (`project-groups`, `budgets`) following the exact shape of the existing `areas` module (plain CRUD, no internal permission checks — gating happens in `actions.ts` via `requireTreasurer()`), plus one new field and one new action on the existing events edit flow. No classification, no actuals, no member-facing views yet — this plan is purely "enter and approve this year's budget," which is independently useful and testable before the next plan (classification) can compute anything against it.

**Tech Stack:** Next.js 16 App Router, Drizzle on Postgres/PGlite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-budget-tracking-fortnox-sync-design.md` §3 (role, already shipped — this plan only consumes `requireTreasurer`), §4.2, and the "Project groups page" / "Budget entry page" bullets of §6. Classification, the Unclassified list, the Year Overview, the project page, and the reconciliation check (the rest of §4.3 and §6) are a separate, later plan — nothing here computes an actual.

## Global Constraints

- Amounts are whole öre as integers, `_sek`-suffixed (existing convention); UI input/output in kronor via the existing `sekToOre`/`oreToSek` (`src/lib/money.ts`).
- `project_group.costCentreCode` is unique: a cost centre maps to at most one group.
- Editing an approved `annual_budget` is never in-place: a version is immutable once `approved`; any later change is a new version that copies forward every unchanged `budget_amount` row, approving which supersedes the prior approved version. Every transition writes a `decisionLog` row (existing `logDecision` helper, `entity='annual_budget'`).
- `drizzle-kit generate` output is committed under `drizzle/` in the same commit as the schema change (CI's `db:check` gate).
- Group nesting (`parentId`) is organisational only this pass — no rollup of a child's budget into its parent.

## Review Focus

- Revising an *already-approved* budget must copy forward every group's unchanged lines into the new version, not just the one being edited — otherwise every other group's "current budget" silently reads as zero the instant one line changes. → Task 5.
- Approving a new version must flip the *previously approved* version (not every other version) to `superseded`, leaving older superseded versions untouched and still queryable. → Task 5.
- A line add/edit attempted against a version that is `approved` or `superseded` (not the current draft) must be rejected, not silently succeed against a dead version. → Task 5.
- A `project_group.costCentreCode` collision (assigning a cost centre already mapped to another group) must be rejected with a clear error, not silently overwrite the existing mapping. → Task 2.
- A non-treasurer hitting any of this plan's actions must be rejected the same way `/areas`/`/roles` already reject a non-`mapper`/non-`role-admin` — not merely hidden from the nav. → Tasks 3, 6.

---

## File structure

- `src/db/schema.ts` — modify: add `projectGroup`, `project.projectGroupId`, `annualBudget`, `budgetAmount`.
- `src/lib/project-groups/service.ts` — create: flat CRUD for `project_group`.
- `src/app/project-groups/page.tsx`, `src/app/project-groups/actions.ts` — create: treasurer-only CRUD list, same shape as `/areas`.
- `src/lib/projects/service.ts` — modify: add `setProjectGroup`.
- `src/app/events/[slug]/edit/actions.ts`, `src/app/events/[slug]/edit/page.tsx` — modify: a "Project group" select, gated the same as the existing meta-edit action.
- `src/lib/budgets/service.ts` — create: `annual_budget`/`budget_amount` versioning.
- `src/app/budget/page.tsx`, `src/app/budget/actions.ts` — create: treasurer-only budget entry.

---

### Task 1: Schema — `project_group`, `project.projectGroupId`, `annual_budget`, `budget_amount`

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/<generated>.sql`

**Interfaces:**
- Produces: `projectGroup`, `annualBudget`, `budgetAmount` tables and their inferred row types; `project` gains `projectGroupId`. Consumed by every later task.

- [ ] **Step 1: Add the schema additions**

```ts
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
// (added to the existing drizzle-orm/pg-core import line alongside boolean/index/integer/etc.)

export type AnnualBudgetStatus = 'draft' | 'approved' | 'superseded';
export type BudgetLineKind = 'cost' | 'income';

export const projectGroup = pgTable('project_group', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  costCentreCode: text('cost_centre_code').unique().references(() => fxCostCentre.code),
  parentId: text('parent_id').references((): AnyPgColumn => projectGroup.id),
});

export const annualBudget = pgTable('annual_budget', {
  id: text('id').primaryKey(),
  fiscalYear: integer('fiscal_year').notNull(), // assumed calendar year — see the design doc's open question
  version: integer('version').notNull(),
  status: text('status', { enum: ['draft', 'approved', 'superseded'] }).$type<AnnualBudgetStatus>().notNull().default('draft'),
  approvedByUserId: text('approved_by_user_id').references(() => user.id),
  approvedAt: timestamp('approved_at'),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [unique('annual_budget_year_version_key').on(t.fiscalYear, t.version)]);

export const budgetAmount = pgTable('budget_amount', {
  id: text('id').primaryKey(),
  annualBudgetId: text('annual_budget_id').notNull().references(() => annualBudget.id, { onDelete: 'cascade' }),
  projectGroupId: text('project_group_id').notNull().references(() => projectGroup.id),
  projectId: text('project_id').references(() => project.id),
  kind: text('kind', { enum: ['cost', 'income'] }).$type<BudgetLineKind>().notNull(),
  month: integer('month'), // 1-12, null = whole-year line
  amountSek: integer('amount_sek').notNull(), // öre, despite the name — platform-wide convention
  accountFrom: integer('account_from'),
  accountTo: integer('account_to'),
});

// added to the existing `project` table:
projectGroupId: text('project_group_id').references(() => projectGroup.id),
```

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`

- [ ] **Step 3: Verify schema and migration agree**

Run: `npm run db:check`
Expected: passes with no diff.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add project_group, annual_budget and budget_amount tables"
```

---

### Task 2: Project group service

**Files:**
- Create: `src/lib/project-groups/service.ts`
- Test: `src/lib/project-groups/service.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 3, 4, 5, 6):

```ts
export class ProjectGroupNotFoundError extends Error {}
export class CostCentreAlreadyMappedError extends Error {}

export async function listProjectGroups(db: Db): Promise<ProjectGroup[]>; // ordered by name
export async function createProjectGroup(db: Db, input: { name: string; costCentreCode: string | null; parentId: string | null }): Promise<ProjectGroup>;
export async function updateProjectGroup(db: Db, input: { id: string; name: string; costCentreCode: string | null; parentId: string | null }): Promise<ProjectGroup>;
export async function getProjectGroup(db: Db, id: string): Promise<ProjectGroup | null>;
```

- [ ] **Step 1: Write the failing tests**

```ts
it('lists groups ordered by name', async () => {
  await createProjectGroup(db, { name: 'Kitchen', costCentreCode: null, parentId: null });
  await createProjectGroup(db, { name: 'Infrastructure', costCentreCode: null, parentId: null });
  expect((await listProjectGroups(db)).map((g) => g.name)).toEqual(['Infrastructure', 'Kitchen']);
});

it('creates and updates a group, including its cost-centre mapping', async () => {
  const created = await createProjectGroup(db, { name: 'Infrastructure', costCentreCode: 'INFRA', parentId: null });
  const updated = await updateProjectGroup(db, { id: created.id, name: 'Infra', costCentreCode: 'INFRA', parentId: null });
  expect(updated).toMatchObject({ name: 'Infra', costCentreCode: 'INFRA' });
});

it('rejects mapping a cost centre already mapped to another group', async () => {
  await createProjectGroup(db, { name: 'Infrastructure', costCentreCode: 'INFRA', parentId: null });
  await expect(createProjectGroup(db, { name: 'Kitchen', costCentreCode: 'INFRA', parentId: null }))
    .rejects.toBeInstanceOf(CostCentreAlreadyMappedError);
});

it('throws for an unknown id on update', async () => {
  await expect(updateProjectGroup(db, { id: 'nope', name: 'X', costCentreCode: null, parentId: null }))
    .rejects.toBeInstanceOf(ProjectGroupNotFoundError);
});
```

(`db` set up in `beforeEach` via `createDb('pglite://memory')`, matching `src/lib/areas/service.test.ts`'s convention. Note `project_group.costCentreCode` references `fx_cost_centre.code` with a real FK — seed a row in `fx_cost_centre` first wherever a test passes a non-null `costCentreCode`, the same lesson as the previous plan's Task 5.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/project-groups/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Mirror `src/lib/areas/service.ts`'s shape exactly (`randomUUID()` ids, plain `db.insert`/`db.update`/`.returning()`, a `NotFoundError` thrown when `.returning()` comes back empty). For the cost-centre-collision check: catch the unique-constraint violation from Postgres on insert/update (same technique already used nowhere else in this codebase for a *unique* violation specifically — the existing precedent, `user.email` uniqueness, is enforced by BetterAuth before the insert, not by catching a DB error) — so catch the Postgres error by its `code` property (`'23505'`) and re-throw as `CostCentreAlreadyMappedError` when the violated constraint's name contains `cost_centre_code`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/project-groups/service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/project-groups/service.ts src/lib/project-groups/service.test.ts
git commit -m "feat: add project group service"
```

---

### Task 3: Project groups page (treasurer-only CRUD)

**Files:**
- Create: `src/app/project-groups/page.tsx`, `src/app/project-groups/actions.ts`

**Interfaces:**
- Consumes: `requireTreasurer` (`src/lib/session.ts`, already shipped); `listProjectGroups`, `createProjectGroup`, `updateProjectGroup`, `CostCentreAlreadyMappedError` (Task 2).

- [ ] **Step 1: Implement**

Copy `src/app/areas/page.tsx` + `src/app/areas/actions.ts` structure exactly, substituting `requireMapper()` → `requireTreasurer()`, `area` → `projectGroup`, and the field set (name, cost-centre code, parent — a `<select>` of other groups for `parentId`, "No parent" as the empty option). On `CostCentreAlreadyMappedError`, redirect back with `?error=cost_centre_already_mapped` and render it the same way `/events/[slug]/edit` already renders a `?warning=`/`?error=` query param (see that page's existing pattern) rather than throwing.

No new test file for this task — matches the existing convention that `/areas`/`/roles` page rendering and their thin `'use server'` actions aren't unit-tested beyond the service layer underneath them (`src/lib/areas/service.test.ts` is the test; `src/app/areas/actions.ts` has none).

- [ ] **Step 2: Verify manually against the service tests**

Run: `npx vitest run src/lib/project-groups/service.test.ts` (same command as Task 2 — this task adds no new test, so re-running the task it depends on is the task's own verification that nothing it calls changed shape)
Expected: PASS

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit -p tsconfig.json && npx next build`
Expected: both succeed — this is the step that actually proves the new page/action compile and route correctly, since there's no dedicated test for them.

- [ ] **Step 4: Commit**

```bash
git add src/app/project-groups/
git commit -m "feat: add project groups page"
```

---

### Task 4: Assign a project to a group

**Files:**
- Modify: `src/lib/projects/service.ts`, `src/app/events/[slug]/edit/actions.ts`, `src/app/events/[slug]/edit/page.tsx`
- Test: `src/lib/projects/service.test.ts`

**Interfaces:**
- Consumes: `projectGroup` (Task 1).
- Produces (consumed by Task 6's manual verification and the next plan): `setProjectGroup(db: Db, input: { projectId: string; projectGroupId: string | null }): Promise<Project>`.

- [ ] **Step 1: Write the failing test**

```ts
it('sets and clears a project\'s group', async () => {
  const event = await createEvent(db, { title: 'X', summary: '', ownerUserId: 'u1' });
  const group = await createProjectGroup(db, { name: 'Infrastructure', costCentreCode: null, parentId: null });
  const updated = await setProjectGroup(db, { projectId: event.id, projectGroupId: group.id });
  expect(updated.projectGroupId).toBe(group.id);
  const cleared = await setProjectGroup(db, { projectId: event.id, projectGroupId: null });
  expect(cleared.projectGroupId).toBeNull();
});
```

(Add alongside the existing `updateProjectMeta`/`duplicateEvent` tests in `src/lib/projects/service.test.ts`; that file's existing `beforeEach` already seeds a `u1` user — check before adding a second seed.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/projects/service.test.ts`
Expected: FAIL — `setProjectGroup` not defined.

- [ ] **Step 3: Implement**

`setProjectGroup` follows `updateProjectMeta`'s exact shape (`db.update(schema.project).set({projectGroupId, updatedAt: new Date()}).where(eq(schema.project.id, input.projectId)).returning()`, throwing the existing `ProjectNotFoundError` on an empty result).

In `actions.ts`, add `setProjectGroupAction(formData: FormData)` using the existing `loadEditableProject` helper (same `assertEventPermission(db, project.id, user, 'editDetails')` gate `updateEventMetaAction` already uses — no new permission concept). In `page.tsx`'s edit form, add a `<select name="projectGroupId">` (options from `listProjectGroups`, plus an empty "No group" option) alongside the existing title/summary/body fields, submitting to `setProjectGroupAction`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/projects/service.test.ts`
Expected: PASS

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit -p tsconfig.json && npx next build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/lib/projects/service.ts src/lib/projects/service.test.ts src/app/events/
git commit -m "feat: let an event be assigned to a project group"
```

---

### Task 5: Budget service (versioning)

**Files:**
- Create: `src/lib/budgets/service.ts`
- Test: `src/lib/budgets/service.test.ts`

**Interfaces:**
- Consumes: `projectGroup` (Task 1); `logDecision` (`src/lib/decision-log.ts`, already shipped).
- Produces (consumed by Task 6):

```ts
export class BudgetVersionNotEditableError extends Error {}

export async function getOrCreateDraft(db: Db, fiscalYear: number): Promise<AnnualBudget>;
export async function listVersions(db: Db, fiscalYear: number): Promise<AnnualBudget[]>; // all versions, newest first
export async function listBudgetAmounts(db: Db, annualBudgetId: string): Promise<BudgetAmount[]>;
export async function upsertBudgetAmount(db: Db, input: { id?: string; annualBudgetId: string; projectGroupId: string; projectId: string | null; kind: BudgetLineKind; month: number | null; amountSek: number; accountFrom: number | null; accountTo: number | null }): Promise<BudgetAmount>; // id omitted = insert, id given = update that line
export async function deleteBudgetAmount(db: Db, id: string): Promise<void>;
export async function approveBudget(db: Db, input: { annualBudgetId: string; actorUserId: string }): Promise<AnnualBudget>;
```

**One call this plan makes that the design doc leaves open:** when does a new, editable version get created? **My call:** `getOrCreateDraft(db, fiscalYear)` is the single entry point the budget page always calls first. It returns the existing `draft` version for that fiscal year if one exists; otherwise, if the latest version is `approved`, it creates `version + 1` as a fresh `draft`, copying every `budgetAmount` row from that approved version verbatim; otherwise (no version exists at all) it creates `version = 1` as an empty `draft`. `upsertBudgetAmount`/`deleteBudgetAmount` only ever operate on a `draft` — both throw `BudgetVersionNotEditableError` if the given `annualBudgetId` isn't currently `draft`, so a stale page (two tabs open, one still showing a since-approved draft) can't silently edit a dead version. `approveBudget` sets the given draft to `approved` (`approvedByUserId`, `approvedAt`) and, in the same transaction, sets any *other* version for that fiscal year currently `approved` to `superseded` — there is at most one per fiscal year by construction, so "the previously approved version" is unambiguous.

- [ ] **Step 1: Write the failing tests**

```ts
async function seedGroup(db: Db, name = 'Infrastructure') {
  return createProjectGroup(db, { name, costCentreCode: null, parentId: null });
}

it('creates version 1 as draft when no budget exists for the year', async () => {
  const draft = await getOrCreateDraft(db, 2027);
  expect(draft).toMatchObject({ fiscalYear: 2027, version: 1, status: 'draft' });
});

it('returns the existing draft on a second call instead of creating another', async () => {
  const first = await getOrCreateDraft(db, 2027);
  const second = await getOrCreateDraft(db, 2027);
  expect(second.id).toBe(first.id);
});

it('upsertBudgetAmount adds a line to the draft', async () => {
  const draft = await getOrCreateDraft(db, 2027);
  const group = await seedGroup(db);
  const line = await upsertBudgetAmount(db, { annualBudgetId: draft.id, projectGroupId: group.id, projectId: null, kind: 'cost', month: null, amountSek: 12_000_00, accountFrom: null, accountTo: null });
  expect(await listBudgetAmounts(db, draft.id)).toMatchObject([{ id: line.id, amountSek: 12_000_00 }]);
});

it('approveBudget freezes the draft and copying forward starts a new draft that supersedes it on its own approval', async () => {
  const group = await seedGroup(db);
  const v1 = await getOrCreateDraft(db, 2027);
  await upsertBudgetAmount(db, { annualBudgetId: v1.id, projectGroupId: group.id, projectId: null, kind: 'cost', month: null, amountSek: 10_000_00, accountFrom: null, accountTo: null });
  await approveBudget(db, { annualBudgetId: v1.id, actorUserId: 'u1' });

  const v2 = await getOrCreateDraft(db, 2027); // revising: should copy v1's line forward
  expect(v2.id).not.toBe(v1.id);
  expect(v2).toMatchObject({ version: 2, status: 'draft' });
  expect(await listBudgetAmounts(db, v2.id)).toMatchObject([{ projectGroupId: group.id, amountSek: 10_000_00 }]);

  await approveBudget(db, { annualBudgetId: v2.id, actorUserId: 'u1' });
  const versions = await listVersions(db, 2027);
  expect(versions.find((v) => v.id === v1.id)?.status).toBe('superseded');
  expect(versions.find((v) => v.id === v2.id)?.status).toBe('approved');
});

it('rejects editing a version that is not the current draft', async () => {
  const group = await seedGroup(db);
  const v1 = await getOrCreateDraft(db, 2027);
  await approveBudget(db, { annualBudgetId: v1.id, actorUserId: 'u1' });
  await expect(upsertBudgetAmount(db, { annualBudgetId: v1.id, projectGroupId: group.id, projectId: null, kind: 'cost', month: null, amountSek: 1, accountFrom: null, accountTo: null }))
    .rejects.toBeInstanceOf(BudgetVersionNotEditableError);
});
```

(`beforeEach` seeds `u1` into `schema.user`, since `approveBudget` writes `approvedByUserId`/`decisionLog.actorUserId` against a real FK — same lesson as before.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/budgets/service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`getOrCreateDraft`: `SELECT ... ORDER BY version DESC LIMIT 1` for the fiscal year; if the top row is `draft`, return it; if it's `approved`, insert `version + 1` as `draft` and bulk-copy its `budgetAmount` rows (fresh ids, same `annualBudgetId` swapped to the new draft's); if there is no row at all, insert `version = 1` as `draft`. `upsertBudgetAmount`/`deleteBudgetAmount`: load the `annualBudget` row for the given id first and throw `BudgetVersionNotEditableError` unless `status === 'draft'`; "upsert" here means "insert if no `id` is given, update if one is" (the plan's `upsertBudgetAmount` signature has no `id` field — add one as an optional input for the update path, since the form in Task 6 needs to edit an existing line, not just add new ones; a line with no `id` is always an insert). `approveBudget`: in one `db.transaction()`, set the given draft to `approved` with `approvedByUserId`/`approvedAt`, find the fiscal year's other `approved` row (if any) and set it `superseded`, and call `logDecision` for the approval (`entity='annual_budget'`, `action='approved'`, `diff={fiscalYear, version}`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/budgets/service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/budgets/service.ts src/lib/budgets/service.test.ts
git commit -m "feat: add budget versioning service"
```

---

### Task 6: Budget entry page (treasurer-only)

**Files:**
- Create: `src/app/budget/page.tsx`, `src/app/budget/actions.ts`

**Interfaces:**
- Consumes: `requireTreasurer`; `getOrCreateDraft`, `listVersions`, `listBudgetAmounts`, `upsertBudgetAmount`, `deleteBudgetAmount`, `approveBudget`, `BudgetVersionNotEditableError` (Task 5); `listProjectGroups` (Task 2).

- [ ] **Step 1: Implement**

`src/app/budget/page.tsx`: `requireTreasurer()`; reads `fiscalYear` from a `?year=` search param (default: current calendar year); calls `getOrCreateDraft(db, fiscalYear)` to get the editable draft and `listBudgetAmounts` for its lines; `listVersions(db, fiscalYear)` to list every version (draft/approved/superseded) for a "prior versions" section showing each one's lines read-only (reuse one table-rendering helper for both the editable draft and the read-only historical versions, toggling an edit column). A line-add form (`<select>` of `listProjectGroups()`, optional project — out of scope to wire a project picker this pass since no page lists non-event projects yet; leave the `projectId` input as a free-text project id field with a one-line note that a picker comes with the classification plan, **my call**, flag for confirmation — kind, month-or-blank, amount in kronor via `sekToOre`/`oreToSek`) posting to `addLineAction`; each existing line gets an inline edit form (same fields, pre-filled) posting to `updateLineAction`, and a delete button posting to `deleteLineAction`; an "Approve this budget" button posting to `approveAction`. On `BudgetVersionNotEditableError` (the two-tabs-open race from the Review Focus list), redirect back with `?error=version_no_longer_editable` and render it the same way `/project-groups` renders its error param (Task 3).

`src/app/budget/actions.ts`: each action calls `requireTreasurer()` first, then the corresponding Task 5 function, then `revalidatePath('/budget')` and redirects back to `/budget?year=<fiscalYear>`.

No new test file — same reasoning as Task 3 (the service underneath is already tested; this task's own correctness is proven by typecheck + build, since there's no existing precedent in this codebase for testing a page/action layer beyond its service).

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit -p tsconfig.json && npx next build`
Expected: both succeed.

- [ ] **Step 3: Add the nav link**

In `src/components/app-shell.tsx`, alongside the `isTreasurer(user) && <Link href="/fortnox">` link added by the previous plan, add `<Link href="/budget">` and `<Link href="/project-groups">` under the same `isTreasurer(user)` check.

- [ ] **Step 4: Commit**

```bash
git add src/app/budget/ src/components/app-shell.tsx
git commit -m "feat: add budget entry page"
```

---

## Self-review notes

- **Spec coverage:** §4.2's `project_group`/`annual_budget`/`budget_amount` tables and all five of its "My call" items (unique cost-centre mapping, no rollup, versioning-via-copy-forward, approve-doesn't-model-a-vote, account range never gates actuals) → Task 1 (schema) and Task 5 (versioning logic; the account-range point has nothing to implement yet since no actuals exist in this plan — carried as a comment on `accountFrom`/`accountTo` for the next plan to honor). §6's "Project groups page" and "Budget entry page" bullets → Tasks 3 and 6. `project.projectGroupId` being assignable → Task 4. Everything else in §6 (Unclassified list, Year Overview, project page) and all of §4.3 is explicitly the next plan.
- **Proportion check:** test bodies make up most of the length because each one pins an exact value from the design doc's versioning rule (copy-forward, single-supersede, reject-on-non-draft) that a reasonable implementer could otherwise get subtly wrong; the implementation steps themselves stay at approach-plus-signature.
