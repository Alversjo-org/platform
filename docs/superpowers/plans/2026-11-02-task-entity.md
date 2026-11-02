# Task Entity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lightweight, standalone to-do item (description, optional assignee, optional image, status: backlog/doing/done, visible creator) that can stand alone on its own task-list page or hang off a bigger project as a sub-todo.

**Architecture:** One new table (`task`) and a narrow service (`src/lib/tasks/service.ts`), following the same `db`-first-argument, typed-error-throwing shape as `src/lib/events/*`. This plan also builds the **shared image-storage module** (`src/lib/images/`) that both this task entity and the wiki module (a later, separate plan) depend on for image uploads — built here because this plan comes first in the sequence.

**Tech Stack:** Next.js 16 App Router, Drizzle ORM, Postgres (PGlite in tests), vitest, `sharp` (already a dependency), `@aws-sdk/client-s3` (new dependency, for Tigris).

**Spec:** `docs/superpowers/specs/2026-11-02-wiki-design.md` §3 (`task` table), §8 (image storage — built here first since this plan precedes the wiki-core plan).

## Global Constraints

- No new role: any logged-in member can create a task, assign/reassign it to anyone, and change its status (spec §3 — "my call... same as event creation today"). `createdByUserId` is provenance only, not an ownership gate.
- `task.projectId` is nullable; `null` means a standalone task-list item, a value means it's a sub-todo of that project. `onDelete: 'cascade'` — deleting a project deletes its tasks.
- No revision history for tasks (unlike wiki pages) — plain CRUD, matching the spec's framing of tasks as lightweight bookkeeping, not content to protect.
- Image storage defaults to `LocalImageStorage` (writes to a gitignored local folder, served by a dynamic route) whenever Tigris credentials (`AWS_ACCESS_KEY_ID` etc.) aren't present in the environment — this must work with zero configuration in tests and `next dev`.
- Images are resized server-side via `sharp` before storage: max width 1600px, re-encoded to webp (spec §8).

## Review Focus

- Unassigning a task (`assigneeUserId: null`) must actually clear the column, not be a no-op — nullable-field update is the easy bug to miss.
- Deleting a project with attached tasks must cascade-delete those tasks (not leave orphaned rows with a dangling `projectId`).
- Listing tasks for a `projectId` that doesn't exist (typo, already-deleted project) returns an empty list, not an error — matches every other `list*` function in this codebase.
- Updating the status or assignee of a task id that doesn't exist throws a typed error rather than silently affecting zero rows.
- `prepareImageUpload` given a buffer that isn't a decodable image must reject with a clear error (sharp throws on invalid input) rather than silently storing garbage.

---

## File Structure

- Modify: `src/db/schema.ts` — add `TaskStatus` type, `task` table, `Task` inferred type.
- Create: `drizzle/<timestamp>_task.sql` — generated.
- Create: `src/lib/images/storage.ts` — `ImageStorage` interface, `LocalImageStorage`, `TigrisImageStorage`, `getImageStorage()` factory.
- Create: `src/lib/images/storage.test.ts`.
- Create: `src/lib/images/resize.ts` — `prepareImageUpload`.
- Create: `src/lib/images/resize.test.ts`.
- Create: `src/app/images/[...key]/route.ts` — serves files written by `LocalImageStorage` in dev.
- Create: `src/lib/tasks/service.ts` — `createTask`, `listTasks`, `updateTaskStatus`, `assignTask`, `deleteTask`.
- Create: `src/lib/tasks/service.test.ts`.
- Create: `src/app/tasks/page.tsx` — backlog/doing/done board.
- Create: `src/app/tasks/actions.ts` — `createTaskAction`, `updateTaskStatusAction`, `assignTaskAction`, `deleteTaskAction`.
- Modify: `src/components/app-shell.tsx` — add a "Tasks" nav link, visible to any logged-in member.

## Task 1: Schema

**Files:**
- Modify: `src/db/schema.ts`

**Interfaces:**
- Produces: `export type TaskStatus = 'backlog' | 'doing' | 'done'`; `export const task: PgTable`; `export type Task = typeof task.$inferSelect`.

- [ ] **Step 1: Add the `task` table** in `src/db/schema.ts`:

```ts
export type TaskStatus = 'backlog' | 'doing' | 'done';

export const task = pgTable('task', {
  id: text('id').primaryKey(),
  description: text('description').notNull(),
  status: text('status', { enum: ['backlog', 'doing', 'done'] }).$type<TaskStatus>().notNull().default('backlog'),
  assigneeUserId: text('assignee_user_id').references(() => user.id),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id),
  projectId: text('project_id').references(() => project.id, { onDelete: 'cascade' }),
  imageUrl: text('image_url'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export type Task = typeof task.$inferSelect;
```

- [ ] **Step 2: Generate the migration.**

Run: `cd /work/platform && npx drizzle-kit generate`
Expected: a new migration file creating `task`.

- [ ] **Step 3: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(tasks): add task table"
```

## Task 2: Image resize helper

**Files:**
- Create: `src/lib/images/resize.ts`
- Test: `src/lib/images/resize.test.ts`

**Interfaces:**
- Produces: `export async function prepareImageUpload(buffer: Buffer): Promise<{ buffer: Buffer; contentType: 'image/webp' }>`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { prepareImageUpload } from './resize';

describe('prepareImageUpload', () => {
  it('re-encodes to webp and caps width at 1600px', async () => {
    const wide = await sharp({ create: { width: 2000, height: 100, channels: 3, background: 'red' } }).png().toBuffer();
    const { buffer, contentType } = await prepareImageUpload(wide);
    expect(contentType).toBe('image/webp');
    const meta = await sharp(buffer).metadata();
    expect(meta.format).toBe('webp');
    expect(meta.width).toBe(1600);
  });

  it('leaves an already-narrow image at its original width', async () => {
    const narrow = await sharp({ create: { width: 400, height: 100, channels: 3, background: 'blue' } }).png().toBuffer();
    const { buffer } = await prepareImageUpload(narrow);
    const meta = await sharp(buffer).metadata();
    expect(meta.width).toBe(400);
  });

  it('rejects a buffer that is not a decodable image', async () => {
    await expect(prepareImageUpload(Buffer.from('not an image'))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/images/resize.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `prepareImageUpload`** in `src/lib/images/resize.ts`: `sharp(buffer).resize({ width: 1600, withoutEnlargement: true }).webp().toBuffer()`, return alongside the fixed content type.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/images/resize.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/images/resize.ts src/lib/images/resize.test.ts
git commit -m "feat(images): add prepareImageUpload resize helper"
```

## Task 3: Image storage

**Files:**
- Create: `src/lib/images/storage.ts`
- Test: `src/lib/images/storage.test.ts`
- Create: `src/app/images/[...key]/route.ts`

**Interfaces:**
- Produces: `export interface ImageStorage { put(key: string, buffer: Buffer, contentType: string): Promise<string>; delete(key: string): Promise<void>; }`; `export class LocalImageStorage implements ImageStorage` (constructor takes a base directory, defaults to `.data/images` relative to the repo root); `export class TigrisImageStorage implements ImageStorage` (constructor takes `{ bucket: string }`, reads `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_ENDPOINT_URL_S3`/`AWS_REGION` from `process.env`); `export function getImageStorage(): ImageStorage` (returns `TigrisImageStorage` if `process.env.AWS_ACCESS_KEY_ID` is set, else `LocalImageStorage`).

- [ ] **Step 1: Write the failing tests** (for `LocalImageStorage` only — `TigrisImageStorage` is exercised manually against the real dev bucket, not in automated tests, matching the spec's "tests never touch a real external service"):

```ts
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocalImageStorage } from './storage';

describe('LocalImageStorage', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'wiki-images-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('writes the buffer under the given key and returns a URL containing it', async () => {
    const storage = new LocalImageStorage(dir);
    const url = await storage.put('pages/abc/photo.webp', Buffer.from('fake-bytes'), 'image/webp');
    expect(url).toContain('pages/abc/photo.webp');
    const written = await readFile(path.join(dir, 'pages/abc/photo.webp'));
    expect(written.toString()).toBe('fake-bytes');
  });

  it('delete removes the file', async () => {
    const storage = new LocalImageStorage(dir);
    await storage.put('x.webp', Buffer.from('a'), 'image/webp');
    await storage.delete('x.webp');
    await expect(readFile(path.join(dir, 'x.webp'))).rejects.toThrow();
  });
});

describe('getImageStorage', () => {
  it('returns LocalImageStorage when no AWS credentials are configured', () => {
    delete process.env.AWS_ACCESS_KEY_ID;
    expect(getImageStorage()).toBeInstanceOf(LocalImageStorage);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/images/storage.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `LocalImageStorage`**: `put` creates parent directories (`mkdir(dirname, {recursive: true})`) and writes the file under the base directory at `key`; returns `/images/${key}`. `delete` removes the file, ignoring "already gone" errors.

- [ ] **Step 4: Implement `TigrisImageStorage`** using `@aws-sdk/client-s3`'s `S3Client` (constructed with `endpoint: process.env.AWS_ENDPOINT_URL_S3`, `region: process.env.AWS_REGION`, credentials from env) — `put` issues `PutObjectCommand` and returns the public URL (`${process.env.AWS_ENDPOINT_URL_S3}/${bucket}/${key}` — **implementer's call**: confirm Tigris's actual public-URL format against a real bucket before wiring this into production use; the shape here is a reasonable starting point, not verified against a live bucket). `delete` issues `DeleteObjectCommand`.

- [ ] **Step 5: Implement `getImageStorage()`** and add `@aws-sdk/client-s3` to `package.json` dependencies.

- [ ] **Step 6: Implement the serving route** `src/app/images/[...key]/route.ts`: reads the file from `LocalImageStorage`'s base directory for the given `key` segments, returns it with the right `Content-Type` (infer from extension, or store content-type alongside the file as a sidecar — **implementer's call**, simplest is inferring from extension since all uploads are webp). 404 if missing. This route is dev/local-storage-only; production traffic hits Tigris URLs directly and never reaches this route.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run src/lib/images/storage.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/images/storage.ts src/lib/images/storage.test.ts src/app/images package.json package-lock.json
git commit -m "feat(images): add ImageStorage with Tigris and local-disk implementations"
```

## Task 4: Task service

**Files:**
- Create: `src/lib/tasks/service.ts`
- Test: `src/lib/tasks/service.test.ts`

**Interfaces:**
- Consumes: `schema.task` (Task 1).
- Produces: `export class TaskNotFoundError extends Error {}`; `export async function createTask(db: Db, input: { description: string; createdByUserId: string; assigneeUserId?: string | null; projectId?: string | null; imageUrl?: string | null }): Promise<Task>`; `export async function listTasks(db: Db, filter?: { projectId?: string | null }): Promise<Task[]>`; `export async function updateTaskStatus(db: Db, input: { taskId: string; status: TaskStatus }): Promise<Task>`; `export async function assignTask(db: Db, input: { taskId: string; assigneeUserId: string | null }): Promise<Task>`; `export async function deleteTask(db: Db, taskId: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('tasks/service', () => {
  it('createTask defaults to backlog status and no assignee', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const t = await createTask(db, { description: 'Fix the gate', createdByUserId: 'u1' });
    expect(t.status).toBe('backlog');
    expect(t.assigneeUserId).toBeNull();
    expect(t.createdByUserId).toBe('u1');
  });

  it('listTasks(undefined) returns every task; {projectId: null} returns only standalone ones; {projectId: X} returns only that project’s', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.project).values({ id: 'p1', slug: 'p1', title: 'P1', kind: 'build', status: 'draft' });
    await createTask(db, { description: 'standalone', createdByUserId: 'u1' });
    await createTask(db, { description: 'sub-todo', createdByUserId: 'u1', projectId: 'p1' });
    expect(await listTasks(db)).toHaveLength(2);
    expect(await listTasks(db, { projectId: null })).toHaveLength(1);
    expect(await listTasks(db, { projectId: 'p1' })).toHaveLength(1);
    expect(await listTasks(db, { projectId: 'does-not-exist' })).toHaveLength(0);
  });

  it('updateTaskStatus changes the status and throws for an unknown id', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    const t = await createTask(db, { description: 'x', createdByUserId: 'u1' });
    const updated = await updateTaskStatus(db, { taskId: t.id, status: 'doing' });
    expect(updated.status).toBe('doing');
    await expect(updateTaskStatus(db, { taskId: 'missing', status: 'done' })).rejects.toThrow(TaskNotFoundError);
  });

  it('assignTask sets and then clears the assignee', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values([{ id: 'u1', email: 'u1@example.org' }, { id: 'u2', email: 'u2@example.org' }]);
    const t = await createTask(db, { description: 'x', createdByUserId: 'u1' });
    const assigned = await assignTask(db, { taskId: t.id, assigneeUserId: 'u2' });
    expect(assigned.assigneeUserId).toBe('u2');
    const unassigned = await assignTask(db, { taskId: t.id, assigneeUserId: null });
    expect(unassigned.assigneeUserId).toBeNull();
  });

  it('deleteTask removes the row; deleting a project cascades to its tasks', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'u1@example.org' });
    await db.insert(schema.project).values({ id: 'p1', slug: 'p1', title: 'P1', kind: 'build', status: 'draft' });
    const standalone = await createTask(db, { description: 'x', createdByUserId: 'u1' });
    await createTask(db, { description: 'sub', createdByUserId: 'u1', projectId: 'p1' });
    await deleteTask(db, standalone.id);
    expect(await listTasks(db, { projectId: null })).toHaveLength(0);
    await db.delete(schema.project).where(eq(schema.project.id, 'p1'));
    expect(await listTasks(db, { projectId: 'p1' })).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tasks/service.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement all five functions** in `src/lib/tasks/service.ts`, following `src/lib/events/details-service.ts`'s shape (typed errors, `db` first argument, plain Drizzle queries — no need for a transaction, every mutation here touches one row).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tasks/service.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tasks/service.ts src/lib/tasks/service.test.ts
git commit -m "feat(tasks): add task service"
```

## Task 5: Task board UI

**Files:**
- Create: `src/app/tasks/page.tsx`
- Create: `src/app/tasks/actions.ts`
- Modify: `src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `createTask`, `listTasks`, `updateTaskStatus`, `assignTask`, `deleteTask` (Task 4); `getImageStorage`, `prepareImageUpload` (Tasks 2-3); `requireUser` from `@/lib/session`.
- Produces: `createTaskAction`, `updateTaskStatusAction`, `assignTaskAction`, `deleteTaskAction` server actions in `src/app/tasks/actions.ts`.

- [ ] **Step 1: Implement `src/app/tasks/actions.ts`**: each action calls `requireUser()` then the matching service function; `createTaskAction` additionally handles an optional uploaded image file from the form — if present, runs it through `prepareImageUpload` then `getImageStorage().put(...)` before calling `createTask` with the resulting URL. `revalidatePath('/tasks')` after each mutation.

- [ ] **Step 2: Implement `src/app/tasks/page.tsx`**: three columns (Backlog / Doing / Done) from `listTasks(db, {projectId: null})` (standalone tasks only — a project's own sub-todos render on that project's own page, not here, per spec §3's "optionally attached to a project"); each card shows description, assignee (or "Unassigned"), creator, image thumbnail if present, a status dropdown/buttons posting to `updateTaskStatusAction`, and a delete button. A form at the top for creating a new task (description, optional assignee picker reusing the existing member-picker pattern from `src/app/boxes/[id]/member-picker.tsx`, optional image file input).

- [ ] **Step 3: Add a "Tasks" link to the nav** in `src/components/app-shell.tsx`, visible to any logged-in member (no role check — matches §3's "no new role").

- [ ] **Step 4: Verify the build and existing tests still pass**

Run: `npm run build && npx vitest run`
Expected: build succeeds; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks src/components/app-shell.tsx
git commit -m "feat(tasks): add task board UI"
```

---

## Self-Review

**Spec coverage**: §3's `task` table (Task 1) and §8's image storage (Tasks 2-3) are both covered; the board UI (Task 5) covers "standalone on its own task-list page" from §1's summary. A project's own embedded sub-todo list (also mentioned in §1) is explicitly left to whichever later work builds project detail pages generally — `listTasks(db, {projectId})` already supports it, there's just no project-detail page in this repo yet to embed it in.

**Step scan**: Task 3 Step 4 and Task 5 Step 2 flag the two genuine implementer choices (Tigris URL shape unverified against a live bucket; content-type inference strategy) rather than guessing silently.

**Type consistency**: `Task`, `TaskStatus`, `ImageStorage`, `prepareImageUpload`'s return shape are used identically across Tasks 1-5.

**Review Focus**: all five items have a covering test — unassign (Task 4 test 4), cascade delete (Task 4 test 5), unknown `projectId` filter (Task 4 test 2), not-found errors (Task 4 test 3), invalid image buffer (Task 2 test 3).

**Proportion**: test bodies are fully specified per TDD; implementation steps stay at the signature/approach level.
