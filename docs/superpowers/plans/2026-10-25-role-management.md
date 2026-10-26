# Role management implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `user.role` enum column with a many-to-many `user_role` table, so a person can hold any combination of roles, and add two new roles (`mapper`, `role-admin`) on top of the existing `admin`/`member-admin`.

**Architecture:** One new join table (`user_role`) plus a backfill migration; `SessionUser.role: Role` becomes `SessionUser.roles: Role[]`, checked everywhere through one shared `hasAnyRole`/`requireAnyRole` pair instead of per-site string comparisons. `admin` is never implied by another role in the data — every gate lists it explicitly via named wrapper functions (`requireAdmin`, `requireMemberAdmin`, `requireMapper`, `requireRoleAdmin`), so a future gate can't omit it by accident. New role-granting logic lives in a small testable service module, with a thin, untested server action on top — the same split the codebase already uses for members/areas.

**Tech Stack:** Next.js (App Router, server actions), Drizzle ORM / Postgres (PGlite in tests), BetterAuth, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-25-role-management-design.md`

## Global Constraints

- `Role` is `'admin' | 'member-admin' | 'mapper' | 'role-admin'` (exact union, from spec §3). `'member'` is not a value — it's the absence of any `user_role` row.
- `user_role` primary key is `(userId, role)`; `grantedByUserId` is **nullable** (spec §3), unlike the equivalent column on `boxAccess`.
- `role-admin` can grant/revoke `mapper` and `member-admin` but never `admin` or `role-admin` — only an actor who already holds `admin` can touch those two role values, in either direction (spec §2, §5).
- The `member-admin → mapper` backfill (spec §6) is a one-time migration step, not an ongoing rule: granting `member-admin` through the new `/roles` UI after this ships must never also grant `mapper`.
- No RLS/DB policies, no admin-configurable permission builder, no `makerspace-admin`/`resident` in this pass (spec §1).

## Review Focus

- Box-fleet access (`/boxes`, `canAccessBox`, `listBoxesFor`, `canStart`) must stay strictly `admin`-only — a `mapper`, `member-admin`, or `role-admin` user must not gain any box visibility or control through a broadened role check. → Task 4.
- Granting `member-admin` via the new `/roles` action must never also grant `mapper` (the coupling is migration-only). → Task 7.
- Revoking one role from a user must only delete that one `user_role` row, leaving their other roles untouched. → Task 7.
- Granting a role a user already holds, or revoking one they never held, must be a no-op, not an error (`onConflictDoNothing` on insert; delete-matching-zero-rows on revoke). → Task 7.
- The migration backfill must give the extra `mapper` row only to users whose *old* `role` was `member-admin` — plain `admin` rows get just `{role: 'admin'}`, never an extra `mapper` row (admins already pass every `admin`-inclusive check without it). → Task 1 (manual SQL inspection, no automated test for this one — see Task 1).

---

## File inventory

- Modify: `src/db/schema.ts` — `Role` type, new `userRole` table, drop `user.role`.
- Create: `drizzle/00XX_<auto>.sql` + matching `drizzle/meta/*` snapshot (via `drizzle-kit generate`, hand-edited for backfill).
- Modify: `src/lib/session.ts` — `SessionUser.roles`, `hasAnyRole`, `requireAnyRole`, `rolesFor`, `isMemberAdmin`, named wrappers, drop `roleFromRaw`.
- Modify: `src/lib/session.test.ts`.
- Modify: `src/lib/auth.ts` — bootstrap moves to an `after` hook; drop `additionalFields.role`.
- Modify: `src/lib/auth.test.ts`.
- Modify: `src/lib/boxes/access.ts` — `AccessUser.roles`, `hasAnyRole`.
- Create: `src/lib/boxes/access.test.ts`.
- Modify: `src/app/api/internal/box-session/route.ts` — use `rolesFor`/`hasAnyRole` instead of `roleFromRaw`.
- Modify: `src/app/api/internal/box-session/route.test.ts` — add a mapper-can't-start case.
- Modify: `src/app/boxes/page.tsx`, `src/app/boxes/[id]/page.tsx` — `user.role === 'admin'` → `hasAnyRole(user, ['admin'])`.
- Modify: `src/components/app-shell.tsx` — nav links, role badge.
- Modify: `src/app/areas/actions.ts`, `src/app/areas/page.tsx`, `src/app/areas/[id]/cells/actions.ts`, `src/app/areas/[id]/cells/page.tsx` — `requireMemberAdmin()` → `requireMapper()`.
- Create: `src/lib/roles/service.ts`, `src/lib/roles/service.test.ts`.
- Create: `src/app/roles/page.tsx`, `src/app/roles/actions.ts`.

---

### Task 1: Schema — `user_role` table and migration

**Files:**
- Modify: `src/db/schema.ts:3` (the `Role` type), near `boxAccess` (add `userRole`), `:13-33` (`user` table — drop `role`)
- Create: `drizzle/00XX_<generated_name>.sql` (exact name chosen by `drizzle-kit generate`)

**Interfaces:**
- Produces: `export type Role = 'admin' | 'member-admin' | 'mapper' | 'role-admin';`, `export const userRole: pgTable(...)` with columns `userId: text`, `role: text<Role>`, `grantedByUserId: text | null`, `createdAt: timestamp`, composite PK `(userId, role)`. `export type UserRole = typeof userRole.$inferSelect;`

This task is schema/config, not business logic — no RED/GREEN cycle; verified by the full test suite (every other test re-applies all migrations from empty, so a broken migration fails everything) plus a manual read of the generated SQL.

- [ ] **Step 1: Edit `src/db/schema.ts`**
  - Change the `Role` type (near the top, currently `'member' | 'member-admin' | 'admin'`) to `'admin' | 'member-admin' | 'mapper' | 'role-admin'`.
  - Add, near `boxAccess`:
    ```ts
    export const userRole = pgTable(
      'user_role',
      {
        userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
        role: text('role', { enum: ['admin', 'member-admin', 'mapper', 'role-admin'] }).$type<Role>().notNull(),
        grantedByUserId: text('granted_by_user_id').references(() => user.id),
        createdAt: timestamp('created_at').notNull().defaultNow(),
      },
      (t) => [primaryKey({ columns: [t.userId, t.role] })],
    );
    export type UserRole = typeof userRole.$inferSelect;
    ```
  - Remove the `role: text('role', { enum: [...] })...` line from the `user` table definition (`:20`).

- [ ] **Step 2: Generate the migration**

  Run: `npm run db:generate`
  Expected: a new `drizzle/00XX_<name>.sql` and matching `drizzle/meta/00XX_snapshot.json` + updated `drizzle/meta/_journal.json` appear, containing `CREATE TABLE "user_role" (...)` and `ALTER TABLE "user" DROP COLUMN "role"`.

- [ ] **Step 3: Hand-edit the generated `.sql` to backfill before the column drop**

  Insert these three statements immediately before the `ALTER TABLE "user" DROP COLUMN "role";` line, each followed by `--> statement-breakpoint` (matching the file's existing statement-separator convention):
  ```sql
  INSERT INTO "user_role" ("user_id", "role", "granted_by_user_id")
  SELECT "id", 'admin', NULL FROM "user" WHERE "role" = 'admin';
  --> statement-breakpoint
  INSERT INTO "user_role" ("user_id", "role", "granted_by_user_id")
  SELECT "id", 'member-admin', NULL FROM "user" WHERE "role" = 'member-admin';
  --> statement-breakpoint
  INSERT INTO "user_role" ("user_id", "role", "granted_by_user_id")
  SELECT "id", 'mapper', NULL FROM "user" WHERE "role" = 'member-admin';
  ```
  Do not touch `drizzle/meta/*` — those reflect schema shape, not data, and must stay exactly what `drizzle-kit generate` produced.

- [ ] **Step 4: Verify migration consistency**

  Run: `npm run db:check`
  Expected: exits 0 (no diff) — confirms the hand-edited file still matches the schema `drizzle-kit` would generate.

- [ ] **Step 5: Run the full test suite as a migration smoke test**

  Run: `npm test`
  Expected: fails at this point — every other file in the codebase still reads/writes `user.role` or `AccessUser.role`, which no longer compiles/exists. This is the *expected* failure for this task (not a sign of a bad migration); confirms the column is really gone. Move on to Task 2.

- [ ] **Step 6: Manually inspect the generated SQL for the Review Focus item**

  Confirm: the `role = 'admin'` backfill statement inserts only `{role: 'admin'}` (no `mapper` row for plain admins), and the `role = 'member-admin'` backfill inserts both `{role: 'member-admin'}` and `{role: 'mapper'}`.

- [ ] **Step 7: Commit**

  ```bash
  git add src/db/schema.ts drizzle/
  git commit -m "feat: replace user.role with a many-to-many user_role table"
  ```

---

### Task 2: Authorization helpers (`src/lib/session.ts`)

**Files:**
- Modify: `src/lib/session.ts` (full rewrite of role-related exports)
- Modify: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: `schema.userRole` (Task 1), `getDb` (`@/db`).
- Produces: `SessionUser = { id: string; email: string; roles: Role[] }`, `hasAnyRole(user: { roles: Role[] }, roles: Role[]): boolean`, `isMemberAdmin(user: { roles: Role[] }): boolean`, `rolesFor(db: Db, userId: string): Promise<Role[]>`, `requireAnyRole(roles: Role[]): Promise<SessionUser>`, `requireAdmin/requireMemberAdmin/requireMapper/requireRoleAdmin: () => Promise<SessionUser>`, `requireUser(): Promise<SessionUser>`, `getSessionUser(): Promise<SessionUser | null>`. `roleFromRaw` is deleted.

- [ ] **Step 1: Write the failing tests in `src/lib/session.test.ts`**

  Replace the file's contents (the `roleFromRaw` tests and the box-access describe block move/disappear — the latter is recreated in Task 4's new `access.test.ts`):
  ```ts
  import { describe, expect, it } from 'vitest';
  import { createDb, schema, type Db } from '@/db';
  import { hasAnyRole, isMemberAdmin, rolesFor } from './session';

  describe('hasAnyRole', () => {
    it('is true when the user holds any of the listed roles', () => {
      expect(hasAnyRole({ roles: ['mapper'] }, ['admin', 'mapper'])).toBe(true);
    });
    it('is false when the user holds none of the listed roles', () => {
      expect(hasAnyRole({ roles: [] }, ['admin', 'mapper'])).toBe(false);
    });
    it('does not treat admin as implicitly satisfying an unlisted role', () => {
      expect(hasAnyRole({ roles: ['admin'] }, ['mapper'])).toBe(false);
    });
  });

  describe('isMemberAdmin', () => {
    it('is true for admin and member-admin, false for mapper or no roles', () => {
      expect(isMemberAdmin({ roles: ['admin'] })).toBe(true);
      expect(isMemberAdmin({ roles: ['member-admin'] })).toBe(true);
      expect(isMemberAdmin({ roles: ['mapper'] })).toBe(false);
      expect(isMemberAdmin({ roles: [] })).toBe(false);
    });
  });

  describe('rolesFor', () => {
    let db: Db;

    it('returns every role row for a user, and an empty array for a user with none', async () => {
      db = await createDb('pglite://memory');
      await db.insert(schema.user).values([{ id: 'u1', email: 'a@example.org' }, { id: 'u2', email: 'b@example.org' }]);
      await db.insert(schema.userRole).values([
        { userId: 'u1', role: 'admin' },
        { userId: 'u1', role: 'mapper' },
      ]);
      expect((await rolesFor(db, 'u1')).sort()).toEqual(['admin', 'mapper']);
      expect(await rolesFor(db, 'u2')).toEqual([]);
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npx vitest run src/lib/session.test.ts`
  Expected: FAIL — `hasAnyRole`/`isMemberAdmin`/`rolesFor` are not exported yet (old `session.ts` still exports `roleFromRaw`/old-shaped `isMemberAdmin`).

- [ ] **Step 3: Rewrite `src/lib/session.ts`**

  ```ts
  import { headers } from 'next/headers';
  import { redirect } from 'next/navigation';
  import { eq } from 'drizzle-orm';
  import { getDb, schema, type Db } from '@/db';
  import type { Role } from '@/db/schema';
  import { getAuth } from '@/lib/auth';

  export type SessionUser = { id: string; email: string; roles: Role[] };

  export async function rolesFor(db: Db, userId: string): Promise<Role[]> {
    const rows = await db.select({ role: schema.userRole.role }).from(schema.userRole).where(eq(schema.userRole.userId, userId));
    return rows.map((r) => r.role);
  }

  export function hasAnyRole(user: { roles: Role[] }, roles: Role[]): boolean {
    return roles.some((r) => user.roles.includes(r));
  }

  export function isMemberAdmin(user: { roles: Role[] }): boolean {
    return hasAnyRole(user, ['admin', 'member-admin']);
  }

  export async function getSessionUser(): Promise<SessionUser | null> {
    const auth = await getAuth();
    const s = await auth.api.getSession({ headers: await headers() });
    if (!s) return null;
    const roles = await rolesFor(await getDb(), s.user.id);
    return { id: s.user.id, email: s.user.email, roles };
  }

  export async function requireUser(): Promise<SessionUser> {
    const u = await getSessionUser();
    if (!u) redirect('/login');
    return u;
  }

  export async function requireAnyRole(roles: Role[]): Promise<SessionUser> {
    const u = await requireUser();
    if (!hasAnyRole(u, roles)) redirect('/');
    return u;
  }

  export const requireAdmin = () => requireAnyRole(['admin']);
  export const requireMemberAdmin = () => requireAnyRole(['admin', 'member-admin']);
  export const requireMapper = () => requireAnyRole(['admin', 'mapper']);
  export const requireRoleAdmin = () => requireAnyRole(['admin', 'role-admin']);
  ```
  Keep the existing comment on the admin-redirect behavior (a member reaching an admin page is sent home, not errored).

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run src/lib/session.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/session.ts src/lib/session.test.ts
  git commit -m "feat: rebuild session role helpers on roles: Role[]"
  ```

---

### Task 3: Bootstrap (`src/lib/auth.ts`)

**Files:**
- Modify: `src/lib/auth.ts:19-39`
- Modify: `src/lib/auth.test.ts`

**Interfaces:**
- Consumes: `schema.userRole` (Task 1), `adminEmails()` (unchanged, `src/lib/auth.ts:8-13`).
- Produces: no new exports; `buildAuth`'s behavior changes from setting `user.role` to inserting a `user_role` row.

- [ ] **Step 1: Write the failing test in `src/lib/auth.test.ts`**

  Replace the two `// @ts-expect-error` assertions in the `'creates admins from ADMIN_EMAILS...'` test (lines 26-31) with DB checks:
  ```ts
  const admin = await loginWithCode(auth, sent, 'admin@example.org');
  const [adminRole] = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, admin.user.id));
  expect(adminRole).toMatchObject({ role: 'admin', grantedByUserId: null });

  const member = await loginWithCode(auth, sent, 'someone@example.org');
  const memberRoles = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, member.user.id));
  expect(memberRoles).toEqual([]);
  ```
  Add `import { eq } from 'drizzle-orm';` and `import { schema } from '@/db';` at the top.

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run src/lib/auth.test.ts`
  Expected: FAIL — `auth.ts` still sets `data.role` on the user row, not a `user_role` insert, so no row exists to match against.

- [ ] **Step 3: Update `src/lib/auth.ts`**
  - Remove `role: { type: [...], required: false, defaultValue: 'member', input: false }` from `user.additionalFields` (`:25`).
  - Replace the `databaseHooks.user.create.before` hook with an `after` hook:
    ```ts
    databaseHooks: {
      user: {
        create: {
          // Role is decided once, at first login, from ADMIN_EMAILS. An `after` hook (not
          // `before`) because it inserts into user_role, which needs the user's id to exist.
          after: async (u) => {
            if (adminEmails().includes(u.email.toLowerCase())) {
              await db.insert(schema.userRole).values({ userId: u.id, role: 'admin', grantedByUserId: null });
            }
          },
        },
      },
    },
    ```
    (`db` is already in scope as `buildAuth`'s parameter.)

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run src/lib/auth.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/auth.ts src/lib/auth.test.ts
  git commit -m "feat: bootstrap ADMIN_EMAILS into user_role instead of user.role"
  ```

---

### Task 4: Box access and the internal session route

**Files:**
- Modify: `src/lib/boxes/access.ts`
- Create: `src/lib/boxes/access.test.ts`
- Modify: `src/app/api/internal/box-session/route.ts:7,25-26,31`
- Modify: `src/app/api/internal/box-session/route.test.ts`
- Modify: `src/app/boxes/page.tsx:35`
- Modify: `src/app/boxes/[id]/page.tsx:51`

**Interfaces:**
- Consumes: `hasAnyRole`, `rolesFor` (Task 2).
- Produces: `AccessUser = { id: string; roles: Role[] }` (was `{ role: Role }`); `canAccessBox`/`listBoxesFor` signatures unchanged otherwise.

- [ ] **Step 1: Write the failing tests in `src/lib/boxes/access.test.ts`** (new file)

  ```ts
  import { describe, expect, it } from 'vitest';
  import { createDb, schema, type Db } from '@/db';
  import { canAccessBox, listBoxesFor } from './access';

  describe('canAccessBox / listBoxesFor', () => {
    it('an admin sees and can access every box, regardless of other roles', async () => {
      const db: Db = await createDb('pglite://memory');
      await db.insert(schema.user).values({ id: 'owner', email: 'owner@example.org' });
      await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'owner' });
      expect(await canAccessBox(db, { id: 'admin1', roles: ['admin'] }, 'b1')).toBe(true);
      expect(await listBoxesFor(db, { id: 'admin1', roles: ['admin'] })).toHaveLength(1);
    });

    it('a mapper (not admin) has no box access, same as a plain member', async () => {
      const db: Db = await createDb('pglite://memory');
      await db.insert(schema.user).values({ id: 'owner', email: 'owner@example.org' });
      await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'owner' });
      expect(await canAccessBox(db, { id: 'mapper1', roles: ['mapper'] }, 'b1')).toBe(false);
      expect(await listBoxesFor(db, { id: 'mapper1', roles: ['mapper'] })).toEqual([]);
    });

    it('member-admin and role-admin also have no box access by themselves', async () => {
      const db: Db = await createDb('pglite://memory');
      await db.insert(schema.user).values({ id: 'owner', email: 'owner@example.org' });
      await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'owner' });
      expect(await canAccessBox(db, { id: 'ma', roles: ['member-admin'] }, 'b1')).toBe(false);
      expect(await canAccessBox(db, { id: 'ra', roles: ['role-admin'] }, 'b1')).toBe(false);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run src/lib/boxes/access.test.ts`
  Expected: FAIL (TS error / wrong-shape argument — `AccessUser` still expects `{ role: Role }`, not `{ roles: Role[] }`).

- [ ] **Step 3: Update `src/lib/boxes/access.ts`**

  ```ts
  import { hasAnyRole } from '@/lib/session';
  // ...
  export type AccessUser = { id: string; roles: Role[] };

  export async function canAccessBox(db: Db, user: AccessUser, boxId: string): Promise<boolean> {
    if (hasAnyRole(user, ['admin'])) {
      // ...unchanged body...
    }
    // ...
  }

  export async function listBoxesFor(db: Db, user: AccessUser): Promise<Box[]> {
    if (hasAnyRole(user, ['admin'])) return db.select().from(schema.boxes).orderBy(schema.boxes.createdAt);
    // ...unchanged body...
  }
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run src/lib/boxes/access.test.ts`
  Expected: PASS.

- [ ] **Step 5: Update `src/app/api/internal/box-session/route.ts`**
  - Replace `import { roleFromRaw } from '@/lib/session';` with `import { hasAnyRole, rolesFor } from '@/lib/session';`.
  - Replace `const role = roleFromRaw((session.user as { role?: string }).role);` with `const roles = await rolesFor(db, session.user.id);`.
  - Replace `canAccessBox(db, { id: session.user.id, role }, boxId)` with `canAccessBox(db, { id: session.user.id, roles }, boxId)`.
  - Replace `canStart: role === 'admin'` with `canStart: hasAnyRole({ roles }, ['admin'])`.

- [ ] **Step 6: Add a failing test to `route.test.ts` for the Review Focus item, then make it pass**

  Add, after the existing `'ok with a token for an admin...'` test:
  ```ts
  it('forbidden (not just "can\'t start") for a mapper on a box they are not explicitly shared on', async () => {
    const cookie = await cookieFor('mapper@example.org');
    const [u] = await db.select().from(schema.user).where(eq(schema.user.email, 'mapper@example.org'));
    await db.insert(schema.userRole).values({ userId: u.id, role: 'mapper' });
    await db.insert(schema.boxes).values({ id: 'abc123abc123', name: 'b', profile: 'admin', jwtSecret: 's', ownerUserId: u.id, flyMachineId: 'm1' });
    expect(await (await call({ host: 'abc123abc123.boxes.localhost', cookie })).json()).toEqual({ status: 'forbidden' });
  });
  ```
  (Add `import { eq } from 'drizzle-orm';` if not already present.) Note `ownerUserId: u.id` still makes them the box's *owner*, but ownership alone isn't `boxAccess` — this mirrors the existing `'forbidden for a member without access'` case, now proving a `mapper` role doesn't change that outcome.

  Run: `npx vitest run src/app/api/internal/box-session/route.test.ts`
  Expected: FAIL first (old code still references `roleFromRaw`, won't compile) — confirms Step 5 is required — then PASS once Step 5's edits are in place.

- [ ] **Step 7: Update the two inline `user.role === 'admin'` checks**
  - `src/app/boxes/page.tsx:35`: `{user.role === 'admin' && ...}` → `{hasAnyRole(user, ['admin']) && ...}` (add `import { hasAnyRole } from '@/lib/session';` — `requireUser` is already imported from there).
  - `src/app/boxes/[id]/page.tsx:51`: `const isAdmin = user.role === 'admin';` → `const isAdmin = hasAnyRole(user, ['admin']);` (add `hasAnyRole` to the existing `@/lib/session` import).

- [ ] **Step 8: Run the full test suite**

  Run: `npm test`
  Expected: PASS for every file touched so far (`session`, `auth`, `boxes/access`, `box-session/route`); other files (areas, app-shell, roles) still fail/don't exist yet — expected until their tasks land.

- [ ] **Step 9: Commit**

  ```bash
  git add src/lib/boxes/access.ts src/lib/boxes/access.test.ts src/app/api/internal/box-session/route.ts src/app/api/internal/box-session/route.test.ts src/app/boxes/page.tsx "src/app/boxes/[id]/page.tsx"
  git commit -m "feat: resolve box access through hasAnyRole/rolesFor instead of role column"
  ```

---

### Task 5: Nav and account menu (`src/components/app-shell.tsx`)

**Files:**
- Modify: `src/components/app-shell.tsx:11,43,53-54`

No test — this component has no existing test file and this codebase has no React-rendering test infra (no `.test.tsx` files anywhere); verified by `npm run build` and a manual look (Task 8).

**Interfaces:**
- Consumes: `hasAnyRole`, `isMemberAdmin` (Task 2).

- [ ] **Step 1: Update imports and nav**
  - `import { isMemberAdmin, type SessionUser } from '@/lib/session';` → `import { hasAnyRole, isMemberAdmin, type SessionUser } from '@/lib/session';`.
  - Role badge (`:43`): replace
    ```tsx
    {user.role !== 'member' && <div className="px-1.5 py-1"><Badge>{user.role}</Badge></div>}
    ```
    with
    ```tsx
    {user.roles.length > 0 && (
      <div className="flex flex-wrap gap-1 px-1.5 py-1">
        {user.roles.map((r) => <Badge key={r}>{r}</Badge>)}
      </div>
    )}
    ```
  - Nav (`:53-54`): keep the "Members" link on `isMemberAdmin(user)`. Change the "Areas" link's condition from `isMemberAdmin(user)` to `hasAnyRole(user, ['admin', 'mapper'])`. Add, after it: `{hasAnyRole(user, ['admin', 'role-admin']) && <Link href="/roles" className="text-sm text-muted-foreground hover:text-foreground">Roles</Link>}`.

- [ ] **Step 2: Build check**

  Run: `npm run build`
  Expected: compiles (confirms the new JSX and imports type-check — `/roles` route doesn't exist yet until Task 7, which is fine, `Link href="/roles"` doesn't require the route to exist at build time).

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/app-shell.tsx
  git commit -m "feat: show per-role badges and gate Areas/Roles nav links on roles"
  ```

---

### Task 6: Areas gating (`mapper` instead of `member-admin`)

**Files:**
- Modify: `src/app/areas/actions.ts:7,20,27`
- Modify: `src/app/areas/page.tsx:11,17`
- Modify: `src/app/areas/[id]/cells/actions.ts:6,9`
- Modify: `src/app/areas/[id]/cells/page.tsx:7,12`

No new tests — these are thin, already-untested action/page wrappers (no `actions.test.ts` exists anywhere in this codebase); the behavior they rely on (`requireMapper` admits `admin` or `mapper`, denies everyone else) is already pinned by Task 2's `hasAnyRole`/`requireAnyRole` tests. Verified by `npm run build` and `npm test` (Task 8).

**Interfaces:**
- Consumes: `requireMapper` (Task 2).

- [ ] **Step 1: Swap the import and call in all four files**

  In each of the four files, replace `import { requireMemberAdmin } from '@/lib/session';` with `import { requireMapper } from '@/lib/session';`, and replace every `await requireMemberAdmin();` / `const admin = await requireMemberAdmin();` call with `requireMapper()` (keep the variable name as whatever each file already uses — `src/app/areas/page.tsx` assigns the result to `admin`; leave that binding name as-is, just swap the call, to keep the diff minimal).

- [ ] **Step 2: Build and test**

  Run: `npm run build && npm test`
  Expected: both pass.

- [ ] **Step 3: Commit**

  ```bash
  git add src/app/areas/actions.ts src/app/areas/page.tsx "src/app/areas/[id]/cells/actions.ts" "src/app/areas/[id]/cells/page.tsx"
  git commit -m "feat: gate area management on the mapper role instead of member-admin"
  ```

---

### Task 7: Role management (`/roles`)

**Files:**
- Create: `src/lib/roles/service.ts`
- Create: `src/lib/roles/service.test.ts`
- Create: `src/app/roles/actions.ts`
- Create: `src/app/roles/page.tsx`

**Interfaces:**
- Consumes: `hasAnyRole`, `requireRoleAdmin`, `SessionUser` (Task 2); `logDecision` (`@/lib/decision-log`, existing); `listMembers` (`@/lib/members/service`, existing); `schema.userRole` (Task 1).
- Produces: `GRANTABLE_ROLES: Role[] = ['member-admin', 'mapper', 'role-admin', 'admin']`; `class NotAuthorizedError extends Error`; `setUserRole(db: Db, input: { actor: { id: string; roles: Role[] }; targetUserId: string; role: Role; grant: boolean }): Promise<void>`; `listUserRoles(db: Db): Promise<UserRole[]>`; `groupRolesByUserId(rows: { userId: string; role: Role }[]): Map<string, Role[]>`; `setUserRoleAction(formData: FormData): Promise<void>` (server action, untested — matches the codebase's existing thin-action convention).

- [ ] **Step 1: Write the failing tests in `src/lib/roles/service.test.ts`**

  ```ts
  import { beforeEach, describe, expect, it } from 'vitest';
  import { eq } from 'drizzle-orm';
  import { createDb, schema, type Db } from '@/db';
  import { groupRolesByUserId, NotAuthorizedError, setUserRole } from './service';

  describe('setUserRole', () => {
    let db: Db;

    beforeEach(async () => {
      db = await createDb('pglite://memory');
      await db.insert(schema.user).values([{ id: 'actor', email: 'actor@example.org' }, { id: 'target', email: 'target@example.org' }]);
    });

    it('a role-admin can grant mapper', async () => {
      await setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'mapper', grant: true });
      const rows = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'));
      expect(rows).toMatchObject([{ role: 'mapper', grantedByUserId: 'actor' }]);
    });

    it('a role-admin can grant member-admin without also granting mapper', async () => {
      await setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'member-admin', grant: true });
      const rows = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'));
      expect(rows.map((r) => r.role)).toEqual(['member-admin']);
    });

    it('a role-admin cannot grant admin', async () => {
      await expect(
        setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'admin', grant: true }),
      ).rejects.toThrow(NotAuthorizedError);
      expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toEqual([]);
    });

    it('a role-admin cannot grant role-admin', async () => {
      await expect(
        setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'role-admin', grant: true }),
      ).rejects.toThrow(NotAuthorizedError);
    });

    it('a role-admin cannot revoke admin from someone either', async () => {
      await db.insert(schema.userRole).values({ userId: 'target', role: 'admin' });
      await expect(
        setUserRole(db, { actor: { id: 'actor', roles: ['role-admin'] }, targetUserId: 'target', role: 'admin', grant: false }),
      ).rejects.toThrow(NotAuthorizedError);
      expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toHaveLength(1);
    });

    it('an admin can grant admin', async () => {
      await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'admin', grant: true });
      expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toMatchObject([{ role: 'admin' }]);
    });

    it('granting a role the target already holds is a no-op, not an error', async () => {
      await db.insert(schema.userRole).values({ userId: 'target', role: 'mapper' });
      await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: true });
      expect(await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'))).toHaveLength(1);
    });

    it('revoking a role the target does not hold is a no-op, not an error', async () => {
      await expect(
        setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: false }),
      ).resolves.toBeUndefined();
    });

    it('revoking one role leaves the target\'s other roles untouched', async () => {
      await db.insert(schema.userRole).values([{ userId: 'target', role: 'mapper' }, { userId: 'target', role: 'member-admin' }]);
      await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: false });
      const rows = await db.select().from(schema.userRole).where(eq(schema.userRole.userId, 'target'));
      expect(rows.map((r) => r.role)).toEqual(['member-admin']);
    });

    it('writes a decisionLog row for a successful grant and for a successful revoke', async () => {
      await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: true });
      await setUserRole(db, { actor: { id: 'actor', roles: ['admin'] }, targetUserId: 'target', role: 'mapper', grant: false });
      const logs = await db.select().from(schema.decisionLog).where(eq(schema.decisionLog.entityId, 'target'));
      expect(logs.map((l) => l.action)).toEqual(['grant', 'revoke']);
    });
  });

  describe('groupRolesByUserId', () => {
    it('groups role rows by userId, preserving each user\'s role list', () => {
      const result = groupRolesByUserId([
        { userId: 'a', role: 'mapper' }, { userId: 'a', role: 'admin' }, { userId: 'b', role: 'mapper' },
      ]);
      expect(result.get('a')).toEqual(['mapper', 'admin']);
      expect(result.get('b')).toEqual(['mapper']);
      expect(result.get('c')).toBeUndefined();
    });
  });
  ```

- [ ] **Step 2: Run tests to verify they fail**

  Run: `npx vitest run src/lib/roles/service.test.ts`
  Expected: FAIL — `./service` doesn't exist yet.

- [ ] **Step 3: Implement `src/lib/roles/service.ts`**

  ```ts
  import { and, eq } from 'drizzle-orm';
  import { schema, type Db } from '@/db';
  import type { Role, UserRole } from '@/db/schema';
  import { logDecision } from '@/lib/decision-log';
  import { hasAnyRole } from '@/lib/session';

  export const GRANTABLE_ROLES: Role[] = ['member-admin', 'mapper', 'role-admin', 'admin'];
  const ADMIN_ONLY_ROLES: Role[] = ['admin', 'role-admin'];

  export class NotAuthorizedError extends Error {
    constructor() { super('Only an admin can change this role'); this.name = 'NotAuthorizedError'; }
  }

  export async function setUserRole(
    db: Db,
    input: { actor: { id: string; roles: Role[] }; targetUserId: string; role: Role; grant: boolean },
  ): Promise<void> {
    if (ADMIN_ONLY_ROLES.includes(input.role) && !hasAnyRole(input.actor, ['admin'])) {
      throw new NotAuthorizedError();
    }
    if (input.grant) {
      await db.insert(schema.userRole)
        .values({ userId: input.targetUserId, role: input.role, grantedByUserId: input.actor.id })
        .onConflictDoNothing();
    } else {
      await db.delete(schema.userRole).where(and(eq(schema.userRole.userId, input.targetUserId), eq(schema.userRole.role, input.role)));
    }
    await logDecision(db, {
      entity: 'user_role', entityId: input.targetUserId, actorUserId: input.actor.id,
      action: input.grant ? 'grant' : 'revoke', diff: { role: input.role },
    });
  }

  export function listUserRoles(db: Db): Promise<UserRole[]> {
    return db.select().from(schema.userRole);
  }

  export function groupRolesByUserId(rows: { userId: string; role: Role }[]): Map<string, Role[]> {
    const map = new Map<string, Role[]>();
    for (const row of rows) {
      const existing = map.get(row.userId);
      if (existing) existing.push(row.role);
      else map.set(row.userId, [row.role]);
    }
    return map;
  }
  ```

- [ ] **Step 4: Run tests to verify they pass**

  Run: `npx vitest run src/lib/roles/service.test.ts`
  Expected: PASS.

- [ ] **Step 5: Implement `src/app/roles/actions.ts`** (no test — thin wrapper, matches `src/app/members/actions.ts`'s untested convention)

  ```ts
  'use server';

  import { revalidatePath } from 'next/cache';
  import { redirect } from 'next/navigation';
  import { getDb } from '@/db';
  import type { Role } from '@/db/schema';
  import { requireRoleAdmin } from '@/lib/session';
  import { NotAuthorizedError, setUserRole } from '@/lib/roles/service';

  export async function setUserRoleAction(formData: FormData) {
    const actor = await requireRoleAdmin();
    const targetUserId = String(formData.get('userId'));
    const role = String(formData.get('role')) as Role;
    const grant = formData.get('grant') === 'true';
    try {
      await setUserRole(await getDb(), { actor, targetUserId, role, grant });
    } catch (e) {
      if (e instanceof NotAuthorizedError) redirect(`/roles?error=${encodeURIComponent(e.message)}`);
      throw e;
    }
    revalidatePath('/roles');
    redirect('/roles');
  }
  ```

- [ ] **Step 6: Implement `src/app/roles/page.tsx`** (no test — matches `src/app/areas/page.tsx`'s untested convention)

  List every member (`listMembers`) with one Grant/Revoke button pair per `GRANTABLE_ROLES` entry, using `groupRolesByUserId(await listUserRoles(db))` to know each user's current roles. For `admin`/`role-admin` columns, render plain text (no form) when the viewing `admin` is omitted — i.e. show the button pair only when `hasAnyRole(actor, ['admin'])`, same restriction `setUserRole` enforces server-side. Follow the existing table + per-row `<form>` + hidden-input pattern from `src/app/boxes/[id]/page.tsx`'s revoke button (`<form action={...}><input type="hidden" .../>...<Button type="submit">...</Button></form>`), with one form per (user, role, action) triplet. Gate the whole page on `requireRoleAdmin()`. Show `?error=` (from `setUserRoleAction`'s redirect) in an `Alert`, matching `src/app/members/[id]/page.tsx`'s error-banner pattern.

- [ ] **Step 7: Build and test**

  Run: `npm run build && npm test`
  Expected: both pass.

- [ ] **Step 8: Manually verify `/roles` in the browser**

  `npm run dev`, log in as an `ADMIN_EMAILS` address (OTP printed to the console), visit `/roles`, grant `mapper` to another member, confirm the button flips to "Revoke" and the member gains the "Areas" nav link on their own next load; confirm the `admin`/`role-admin` columns show no buttons for a `role-admin`-only account.

- [ ] **Step 9: Commit**

  ```bash
  git add src/lib/roles/service.ts src/lib/roles/service.test.ts src/app/roles/actions.ts src/app/roles/page.tsx
  git commit -m "feat: add /roles page for granting and revoking roles"
  ```

---

### Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

  Run: `npm run lint && npm test && npm run build`
  Expected: all three pass clean (no new warnings beyond the two pre-existing `<img>` lint warnings noted in prior work on this codebase).

- [ ] **Step 2: Grep for any remaining `.role` reference to a singular role**

  Run: `grep -rn "\.role ===" src --include=*.ts --include=*.tsx`
  Expected: no matches outside `projectMember.role`/`getEventRole`'s unrelated `'lead' | 'cocreator' | 'override'` type (confirm by reading each hit).

- [ ] **Step 3: Commit (if Steps 1-2 required any fixes)**

  ```bash
  git add -A
  git commit -m "fix: address final-review findings on role management"
  ```
