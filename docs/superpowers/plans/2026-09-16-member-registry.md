# Member registry, access model & payment sync — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a member view/edit their own profile (never someone else's), give every member a registry page listing all members with opt-in phone/email visibility, and introduce a generic `externalPayments` table — fed by an admin CSV importer and an admin-triggered Stripe sync — that automatically drives `isActiveMember`/`membershipExpiresAt`.

**Architecture:** Three layers, built bottom-up: (1) a schema change plus an access-control split on the existing `user` fields, (2) a `src/lib/payments/` domain that owns the `externalPayments` table, the CSV parser, the Stripe REST client (hand-rolled `fetch`, no SDK — mirrors `src/lib/fly.ts`), and the recompute rule, (3) three page surfaces (`/members`, `/users/[id]` self-edit, `/members/import`) wired to that domain through thin server actions, following the existing pattern in `src/app/boxes/`.

**Tech Stack:** Next.js 16 App Router (server components + server actions, no client components), Drizzle ORM / PGlite-or-Postgres, Vitest, shadcn/ui.

**Spec:** `docs/superpowers/specs/2026-09-16-member-registry-design.md`

## Global Constraints

- No third-party API SDKs — external HTTP APIs (Stripe included) get a small hand-rolled `fetch`-based client with an injectable `fetch`, exactly like `src/lib/fly.ts`'s `FlyClient`. This is an existing, explicit convention (platform v0 design §4.1: "Fly Machines REST API called directly with `fetch`, no SDK").
- Any change to `src/db/schema.ts` must be followed by `npm run db:generate`, with the generated SQL under `drizzle/` committed alongside it. `npm run db:check` must pass with no diff.
- Never write a secret into the repo. `STRIPE_API_KEY` is a Fly secret in prod (per this box's owner); add only an empty entry to `.env.example`.
- Membership period rule (spec §5): `membershipExpiresAt = (latest externalPayments.paidAt for that user) + 1 year`; `isActiveMember = membershipExpiresAt > now()`.
- `(source, externalId)` is the idempotency key on `externalPayments` — CSV re-uploads and repeated Stripe syncs must be safe no-ops for rows already recorded.
- Status fields (`isActiveMember`, `membershipExpiresAt`) are never accepted from a non-admin request, even if present in submitted form data — enforce this by using a separate, admin-only server action for status edits, not by trusting a role check alone on a shared action.
- Work on branch `member-registry-design` (already checked out in `/work/platform`). Commit after every task. Local check before each commit: `npx vitest run`, `npm run lint`, `npx tsc --noEmit`. Open a PR with `gh pr create` once all tasks are done; never push to `main`.

---

## Task 1: Schema — visibility flags and `externalPayments` table

**Files:**
- Modify: `src/db/schema.ts`
- Test: `src/db/schema.test.ts` (new)

**Interfaces:**
- Produces: `user.phoneVisible: boolean`, `user.emailVisible: boolean`; `schema.externalPayments` table and `ExternalPayment` type, with columns `id, userId, source, externalId, email, amountCents, currency, paidAt, createdAt` and a unique constraint on `(source, externalId)`.

- [ ] **Step 1: Write the failing test**

Create `src/db/schema.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from './index';

describe('schema: user visibility flags and externalPayments', () => {
  async function withUser(db: Db) {
    const [u] = await db.insert(schema.user).values({ id: 'viktor', email: 'viktor@example.org', name: 'Viktor' }).returning();
    return u;
  }

  it('defaults phoneVisible and emailVisible to false', async () => {
    const db: Db = await createDb('pglite://memory');
    const u = await withUser(db);
    expect(u.phoneVisible).toBe(false);
    expect(u.emailVisible).toBe(false);
  });

  it('inserts an external payment and rejects a duplicate (source, externalId)', async () => {
    const db: Db = await createDb('pglite://memory');
    const u = await withUser(db);
    await db.insert(schema.externalPayments).values({
      id: 'p1', userId: u.id, source: 'stripe', externalId: 'ch_1', email: u.email,
      amountCents: 10000, currency: 'sek', paidAt: new Date('2026-01-01'),
    });
    await expect(
      db.insert(schema.externalPayments).values({
        id: 'p2', userId: u.id, source: 'stripe', externalId: 'ch_1', email: u.email,
        amountCents: 10000, currency: 'sek', paidAt: new Date('2026-01-01'),
      }),
    ).rejects.toThrow();
  });

  it('allows the same externalId across different sources', async () => {
    const db: Db = await createDb('pglite://memory');
    const u = await withUser(db);
    await db.insert(schema.externalPayments).values({ id: 'p1', userId: u.id, source: 'stripe', externalId: 'x', email: u.email, amountCents: null, currency: null, paidAt: new Date() });
    await expect(
      db.insert(schema.externalPayments).values({ id: 'p2', userId: u.id, source: 'Legacy Website', externalId: 'x', email: u.email, amountCents: null, currency: null, paidAt: new Date() }),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/db/schema.test.ts`
Expected: FAIL — `schema.externalPayments` is undefined / `phoneVisible` does not exist on the returned row.

- [ ] **Step 3: Edit the schema**

In `src/db/schema.ts`, change the import line and add the new columns/table:

```typescript
import { boolean, integer, pgTable, primaryKey, text, timestamp, unique } from 'drizzle-orm/pg-core';
```

Add two columns to `user`, right after `membershipExpiresAt`:

```typescript
  membershipExpiresAt: timestamp('membership_expires_at'),
  phoneVisible: boolean('phone_visible').notNull().default(false),
  emailVisible: boolean('email_visible').notNull().default(false),
```

Add a new table after `boxAccess`, before the `export type Box` line:

```typescript
export const externalPayments = pgTable(
  'external_payments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    source: text('source').notNull(), // 'stripe' or a free-text label chosen at CSV import time
    externalId: text('external_id').notNull(), // Stripe charge id, or a deterministic hash of the CSV row
    email: text('email').notNull(), // raw value matched against user.email at import/sync time
    amountCents: integer('amount_cents'),
    currency: text('currency'),
    paidAt: timestamp('paid_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [unique().on(t.source, t.externalId)],
);

export type ExternalPayment = typeof externalPayments.$inferSelect;
```

- [ ] **Step 4: Generate the migration and run tests**

Run: `npm run db:generate` — inspect the new file under `drizzle/` to confirm it adds the two `user` columns and creates `external_payments` with the unique constraint.
Run: `npx vitest run src/db/schema.test.ts`
Expected: PASS

- [ ] **Step 5: Full local check and commit**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all pass.

```bash
git add src/db/schema.ts src/db/schema.test.ts drizzle/
git commit -m "Add phoneVisible/emailVisible to user and an externalPayments table"
git push -u origin member-registry-design
```

---

## Task 2: Access model — self-or-admin editing on user profiles

**Files:**
- Modify: `src/lib/session.ts`
- Modify: `src/lib/users/service.ts`
- Modify: `src/app/users/actions.ts`
- Modify: `src/app/users/[id]/page.tsx`
- Modify: `src/lib/users/service.test.ts`

**Interfaces:**
- Consumes: `schema.user` from Task 1 (phoneVisible/emailVisible columns).
- Produces: `requireSelfOrAdmin(userId): Promise<SessionUser>`; `updateProfile(db, {id, name, phoneNumber, phoneVisible, emailVisible}): Promise<User>`; `updateMembershipStatus(db, {id, isActiveMember, membershipExpiresAt}): Promise<User>`; `findOrCreateUserByEmail(db, email, nameHint?): Promise<User>` — this last one is consumed by Task 6 (CSV import) and Task 9 (Stripe sync).

This task replaces the existing `updateUser` (single function, admin-only) with two functions so that status fields are never reachable from a non-admin action, and any user (not just an admin) can reach their own edit page.

- [ ] **Step 1: Write the failing test**

Replace `src/lib/users/service.test.ts` entirely:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { findOrCreateUserByEmail, InvalidPhoneError, listUsers, updateMembershipStatus, updateProfile, UserNotFoundError } from './service';

describe('user service', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'viktor', email: 'viktor@example.org', name: 'Viktor' },
      { id: 'admin', email: 'admin@example.org', name: 'Admin', role: 'admin' },
    ]);
  });

  describe('updateProfile', () => {
    it('updates name, phone number and visibility flags', async () => {
      const updated = await updateProfile(db, { id: 'viktor', name: 'Viktor Andersson', phoneNumber: '+46701234567', phoneVisible: true, emailVisible: false });
      expect(updated).toMatchObject({ name: 'Viktor Andersson', phoneNumber: '+46701234567', phoneVisible: true, emailVisible: false });
    });

    it('clears phone number when set to null', async () => {
      await updateProfile(db, { id: 'viktor', name: 'Viktor', phoneNumber: '+46701234567', phoneVisible: false, emailVisible: false });
      const updated = await updateProfile(db, { id: 'viktor', name: 'Viktor', phoneNumber: null, phoneVisible: false, emailVisible: false });
      expect(updated.phoneNumber).toBeNull();
    });

    it('rejects a phone number that is not E.164', async () => {
      await expect(
        updateProfile(db, { id: 'viktor', name: 'Viktor', phoneNumber: '0701234567', phoneVisible: false, emailVisible: false }),
      ).rejects.toBeInstanceOf(InvalidPhoneError);
    });

    it('does not touch membership status fields', async () => {
      await updateMembershipStatus(db, { id: 'viktor', isActiveMember: true, membershipExpiresAt: new Date('2027-01-01T00:00:00Z') });
      const updated = await updateProfile(db, { id: 'viktor', name: 'Viktor', phoneNumber: null, phoneVisible: false, emailVisible: false });
      expect(updated.isActiveMember).toBe(true);
    });

    it('throws for an unknown user id', async () => {
      await expect(
        updateProfile(db, { id: 'nobody', name: 'X', phoneNumber: null, phoneVisible: false, emailVisible: false }),
      ).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });

  describe('updateMembershipStatus', () => {
    it('updates isActiveMember and membershipExpiresAt', async () => {
      const expiresAt = new Date('2027-01-01T00:00:00Z');
      const updated = await updateMembershipStatus(db, { id: 'viktor', isActiveMember: true, membershipExpiresAt: expiresAt });
      expect(updated.isActiveMember).toBe(true);
      expect(updated.membershipExpiresAt).toEqual(expiresAt);
    });

    it('clears membershipExpiresAt when set to null', async () => {
      await updateMembershipStatus(db, { id: 'viktor', isActiveMember: true, membershipExpiresAt: new Date() });
      const updated = await updateMembershipStatus(db, { id: 'viktor', isActiveMember: false, membershipExpiresAt: null });
      expect(updated.membershipExpiresAt).toBeNull();
    });

    it('throws for an unknown user id', async () => {
      await expect(updateMembershipStatus(db, { id: 'nobody', isActiveMember: false, membershipExpiresAt: null })).rejects.toBeInstanceOf(UserNotFoundError);
    });
  });

  describe('findOrCreateUserByEmail', () => {
    it('returns the existing user, matching case-insensitively', async () => {
      const found = await findOrCreateUserByEmail(db, 'Viktor@Example.org');
      expect(found.id).toBe('viktor');
    });

    it('creates a new member when no user matches', async () => {
      const created = await findOrCreateUserByEmail(db, 'new@example.org', 'New Person');
      expect(created).toMatchObject({ email: 'new@example.org', name: 'New Person', role: 'member' });
      const again = await findOrCreateUserByEmail(db, 'new@example.org');
      expect(again.id).toBe(created.id);
    });

    it('creates a user with an empty name when no hint is given', async () => {
      const created = await findOrCreateUserByEmail(db, 'noname@example.org');
      expect(created.name).toBe('');
    });
  });

  it('lists users ordered by creation', async () => {
    const users = await listUsers(db);
    expect(users.map((u) => u.id)).toEqual(['viktor', 'admin']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/users/service.test.ts`
Expected: FAIL — `updateProfile`, `updateMembershipStatus`, `findOrCreateUserByEmail` are not exported yet.

- [ ] **Step 3: Rewrite the service**

Replace `src/lib/users/service.ts` entirely:

```typescript
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { User } from '@/db/schema';

export class UserNotFoundError extends Error { constructor(id: string) { super(`No user ${id}`); this.name = 'UserNotFoundError'; } }
export class InvalidPhoneError extends Error { constructor(phone: string) { super(`Not a valid phone number: ${phone}`); this.name = 'InvalidPhoneError'; } }

// E.164: a leading '+', then 1-15 digits, first digit non-zero.
const E164_RE = /^\+[1-9]\d{1,14}$/;

export function listUsers(db: Db): Promise<User[]> {
  return db.select().from(schema.user).orderBy(schema.user.createdAt);
}

/** Fields a member can edit about themselves, and that an admin can edit about anyone. */
export async function updateProfile(
  db: Db,
  input: { id: string; name: string; phoneNumber: string | null; phoneVisible: boolean; emailVisible: boolean },
): Promise<User> {
  if (input.phoneNumber !== null && !E164_RE.test(input.phoneNumber)) throw new InvalidPhoneError(input.phoneNumber);
  const [row] = await db
    .update(schema.user)
    .set({ name: input.name, phoneNumber: input.phoneNumber, phoneVisible: input.phoneVisible, emailVisible: input.emailVisible })
    .where(eq(schema.user.id, input.id))
    .returning();
  if (!row) throw new UserNotFoundError(input.id);
  return row;
}

/**
 * Membership status. Never editable by a member about themselves — admin-only, and
 * otherwise system-computed by recomputeMembershipStatus (src/lib/payments/recompute.ts)
 * whenever a payment record changes.
 */
export async function updateMembershipStatus(
  db: Db,
  input: { id: string; isActiveMember: boolean; membershipExpiresAt: Date | null },
): Promise<User> {
  const [row] = await db
    .update(schema.user)
    .set({ isActiveMember: input.isActiveMember, membershipExpiresAt: input.membershipExpiresAt })
    .where(eq(schema.user.id, input.id))
    .returning();
  if (!row) throw new UserNotFoundError(input.id);
  return row;
}

/** Used by CSV import and Stripe sync to attach a payment record to a user, creating one if none matches. */
export async function findOrCreateUserByEmail(db: Db, email: string, nameHint?: string | null): Promise<User> {
  const normalized = email.trim().toLowerCase();
  const [existing] = await db.select().from(schema.user).where(sql`lower(${schema.user.email}) = ${normalized}`);
  if (existing) return existing;
  const [created] = await db
    .insert(schema.user)
    .values({ id: randomUUID(), email: normalized, name: nameHint?.trim() || '' })
    .returning();
  return created;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/users/service.test.ts`
Expected: PASS

- [ ] **Step 5: Add `requireSelfOrAdmin`**

In `src/lib/session.ts`, add after `requireAdmin`:

```typescript
export async function requireSelfOrAdmin(userId: string): Promise<SessionUser> {
  const u = await requireUser();
  // Same shape as requireAdmin: wrong place, not an error to report.
  if (u.id !== userId && u.role !== 'admin') redirect('/members');
  return u;
}
```

- [ ] **Step 6: Update the actions**

Replace `src/app/users/actions.ts` entirely:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { InvalidPhoneError, updateMembershipStatus, updateProfile, UserNotFoundError } from '@/lib/users/service';
import { requireAdmin, requireSelfOrAdmin } from '@/lib/session';

function knownMessage(e: unknown): string | undefined {
  if (e instanceof UserNotFoundError || e instanceof InvalidPhoneError) return e.message;
  return undefined;
}

export async function updateProfileAction(formData: FormData) {
  const id = String(formData.get('id'));
  await requireSelfOrAdmin(id);
  const name = String(formData.get('name') ?? '').trim();
  const phoneRaw = String(formData.get('phoneNumber') ?? '').trim();

  let errorRedirect: string | undefined;
  try {
    await updateProfile(await getDb(), {
      id,
      name,
      phoneNumber: phoneRaw === '' ? null : phoneRaw,
      phoneVisible: formData.get('phoneVisible') !== null,
      emailVisible: formData.get('emailVisible') !== null,
    });
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    errorRedirect = `/users/${id}?error=${encodeURIComponent(message)}`;
  }
  if (errorRedirect) redirect(errorRedirect);
  revalidatePath('/members');
  revalidatePath(`/users/${id}`);
  revalidatePath('/users');
  redirect(`/users/${id}`);
}

// Admin-only, and deliberately a separate action from updateProfileAction: a member
// submitting the profile form must never be able to move isActiveMember/membershipExpiresAt,
// even by tampering with form fields, because this action ignores anything a non-admin sends.
export async function updateMembershipStatusAction(formData: FormData) {
  await requireAdmin();
  const id = String(formData.get('id'));
  const expiresRaw = String(formData.get('membershipExpiresAt') ?? '').trim();

  let errorRedirect: string | undefined;
  try {
    await updateMembershipStatus(await getDb(), {
      id,
      isActiveMember: formData.get('isActiveMember') !== null,
      membershipExpiresAt: expiresRaw === '' ? null : new Date(expiresRaw),
    });
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    errorRedirect = `/users/${id}?error=${encodeURIComponent(message)}`;
  }
  if (errorRedirect) redirect(errorRedirect);
  revalidatePath('/members');
  revalidatePath(`/users/${id}`);
  revalidatePath('/users');
  redirect(`/users/${id}`);
}
```

- [ ] **Step 7: Update the edit page**

Replace `src/app/users/[id]/page.tsx` entirely:

```tsx
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { getDb, schema } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireSelfOrAdmin } from '@/lib/session';
import { updateMembershipStatusAction, updateProfileAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function UserPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const viewer = await requireSelfOrAdmin(id);
  const db = await getDb();
  const [user] = await db.select().from(schema.user).where(eq(schema.user.id, id));
  if (!user) notFound();
  const isAdmin = viewer.role === 'admin';

  return (
    <AppShell user={viewer}>
      {error && (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <h1 className="mb-4 text-xl font-semibold">{user.email}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Profile</CardTitle></CardHeader>
          <CardContent>
            <form action={updateProfileAction} className="space-y-4">
              <input type="hidden" name="id" value={user.id} />
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" defaultValue={user.name} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phoneNumber">Phone number</Label>
                <Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={user.phoneNumber ?? ''} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="phoneVisible" name="phoneVisible" defaultChecked={user.phoneVisible} />
                <Label htmlFor="phoneVisible">Show phone number in member registry</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="emailVisible" name="emailVisible" defaultChecked={user.emailVisible} />
                <Label htmlFor="emailVisible">Show email in member registry</Label>
              </div>
              <Button type="submit">Save</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Membership status</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {isAdmin ? (
              <form action={updateMembershipStatusAction} className="space-y-4">
                <input type="hidden" name="id" value={user.id} />
                <div className="flex items-center gap-2">
                  <Checkbox id="isActiveMember" name="isActiveMember" defaultChecked={user.isActiveMember} />
                  <Label htmlFor="isActiveMember">Active member</Label>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="membershipExpiresAt">Membership expires</Label>
                  <Input
                    id="membershipExpiresAt"
                    name="membershipExpiresAt"
                    type="date"
                    defaultValue={user.membershipExpiresAt ? user.membershipExpiresAt.toISOString().slice(0, 10) : ''}
                  />
                </div>
                <Button type="submit">Save status</Button>
              </form>
            ) : (
              <p className="text-sm">
                {user.isActiveMember ? 'Active' : 'Inactive'}
                {user.membershipExpiresAt && ` until ${user.membershipExpiresAt.toISOString().slice(0, 10)}`}
                <span className="block text-muted-foreground">Set automatically from payments; contact an admin to change.</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 8: Full local check and commit**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all pass. (`/members` doesn't exist until Task 3 — `requireSelfOrAdmin`'s redirect target and the nav link are fine as dead links until then; nothing imports a missing module.)

```bash
git add src/lib/session.ts src/lib/users/service.ts src/lib/users/service.test.ts src/app/users/actions.ts "src/app/users/[id]/page.tsx"
git commit -m "Split user updates into self-or-admin profile edits and admin-only status edits"
git push
```

---

## Task 3: Member registry — logic

**Files:**
- Create: `src/lib/members/registry.ts`
- Test: `src/lib/members/registry.test.ts`

**Interfaces:**
- Consumes: `schema.user` (Task 1).
- Produces: `RegistryEntry` type; `toRegistryEntry(viewerId, user): RegistryEntry`; `listRegistry(db, viewerId): Promise<RegistryEntry[]>` — consumed by Task 4 (`/members` page).

- [ ] **Step 1: Write the failing test**

Create `src/lib/members/registry.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { listRegistry, toRegistryEntry } from './registry';

describe('toRegistryEntry', () => {
  const base = {
    id: 'u1', email: 'u1@example.org', name: 'U1', emailVerified: false, image: null,
    role: 'member' as const, phoneNumber: '+46700000000', isActiveMember: true,
    membershipExpiresAt: null, phoneVisible: false, emailVisible: false,
    createdAt: new Date(), updatedAt: new Date(),
  };

  it('hides phone and email from other members by default', () => {
    const entry = toRegistryEntry('someone-else', base);
    expect(entry).toMatchObject({ id: 'u1', name: 'U1', isActiveMember: true, phone: null, email: null });
  });

  it('shows phone and email to the member themselves regardless of visibility flags', () => {
    const entry = toRegistryEntry('u1', base);
    expect(entry.phone).toBe('+46700000000');
    expect(entry.email).toBe('u1@example.org');
  });

  it('shows phone and email to other members when the flags are set', () => {
    const entry = toRegistryEntry('someone-else', { ...base, phoneVisible: true, emailVisible: true });
    expect(entry.phone).toBe('+46700000000');
    expect(entry.email).toBe('u1@example.org');
  });
});

describe('listRegistry', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'alice', email: 'alice@example.org', name: 'Alice', phoneNumber: '+46701111111', isActiveMember: true, phoneVisible: true },
      { id: 'bob', email: 'bob@example.org', name: 'Bob', phoneNumber: '+46702222222', isActiveMember: false, phoneVisible: false },
    ]);
  });

  it('applies per-viewer visibility across all members', async () => {
    const asAlice = await listRegistry(db, 'alice');
    const bobEntry = asAlice.find((e) => e.id === 'bob')!;
    expect(bobEntry.phone).toBeNull(); // bob hasn't opted in, alice isn't bob

    const asBob = await listRegistry(db, 'bob');
    const aliceEntry = asBob.find((e) => e.id === 'alice')!;
    expect(aliceEntry.phone).toBe('+46701111111'); // alice opted in

    const bobSelf = asBob.find((e) => e.id === 'bob')!;
    expect(bobSelf.phone).toBe('+46702222222'); // bob viewing himself
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/members/registry.test.ts`
Expected: FAIL — module `./registry` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/members/registry.ts`:

```typescript
import { schema, type Db } from '@/db';
import type { User } from '@/db/schema';

export interface RegistryEntry {
  id: string;
  name: string;
  isActiveMember: boolean;
  phone: string | null;
  email: string | null;
}

/** Phone/email are private by default; visible to everyone only once the member opts in, always visible to the member themselves. */
export function toRegistryEntry(viewerId: string, u: User): RegistryEntry {
  const isSelf = u.id === viewerId;
  return {
    id: u.id,
    name: u.name || u.email,
    isActiveMember: u.isActiveMember,
    phone: u.phoneVisible || isSelf ? u.phoneNumber : null,
    email: u.emailVisible || isSelf ? u.email : null,
  };
}

export async function listRegistry(db: Db, viewerId: string): Promise<RegistryEntry[]> {
  const users = await db.select().from(schema.user).orderBy(schema.user.name);
  return users.map((u) => toRegistryEntry(viewerId, u));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/members/registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/members/registry.ts src/lib/members/registry.test.ts
git commit -m "Add member registry visibility logic"
git push
```

---

## Task 4: Member registry — page and landing spot

**Files:**
- Create: `src/app/members/page.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/app/page.tsx`

**Interfaces:**
- Consumes: `listRegistry` (Task 3), `requireUser` (existing, `src/lib/session.ts`).

This task has no new unit test (it's page wiring, same as every other `page.tsx` in this codebase); it's verified by the build/lint/typecheck check and the manual walkthrough in Step 4.

- [ ] **Step 1: Add the page**

Create `src/app/members/page.tsx`:

```tsx
import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getDb } from '@/db';
import { listRegistry } from '@/lib/members/registry';
import { requireUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const user = await requireUser();
  const entries = await listRegistry(await getDb(), user.id);
  return (
    <AppShell user={user}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        {user.role === 'admin' && <Link href="/members/import" className="text-sm underline">Import members</Link>}
      </div>
      <Table>
        <TableHeader>
          <TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead>Phone</TableHead><TableHead>Email</TableHead></TableRow>
        </TableHeader>
        <TableBody>
          {entries.map((m) => (
            <TableRow key={m.id}>
              <TableCell>{m.id === user.id ? <Link href={`/users/${m.id}`} className="underline">{m.name}</Link> : m.name}</TableCell>
              <TableCell><Badge variant={m.isActiveMember ? 'default' : 'secondary'}>{m.isActiveMember ? 'active' : 'inactive'}</Badge></TableCell>
              <TableCell>{m.phone ?? '—'}</TableCell>
              <TableCell>{m.email ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AppShell>
  );
}
```

(The self-row links to `/users/[id]` — the member's own edit page from Task 2. Other rows are plain text; nobody else's profile is reachable from here, matching the access model.)

- [ ] **Step 2: Add nav link and make it the landing page**

In `src/components/app-shell.tsx`, add a `Members` link visible to everyone, next to the existing admin-only `Users` link:

```tsx
        <div className="flex items-center gap-4">
          <Link href="/boxes" className="text-lg font-semibold">Alversjö</Link>
          <Link href="/members" className="text-sm text-muted-foreground hover:text-foreground">Members</Link>
          {user.role === 'admin' && <Link href="/users" className="text-sm text-muted-foreground hover:text-foreground">Users</Link>}
        </div>
```

In `src/app/page.tsx`, change the redirect target:

```tsx
import { redirect } from 'next/navigation';

export default function Home() {
  redirect('/members');
}
```

- [ ] **Step 3: Full local check**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 4: Manual walkthrough**

Run: `npm install && npm run dev` (per this box's README), log in as two different emails (one in `ADMIN_EMAILS`, one not).
- Confirm `/` redirects to `/members` and both users land there after login.
- Confirm a non-admin sees no "Import members" link and cannot reach `/users` (redirected to `/boxes`) or another user's `/users/[id]` (redirected to `/members`).
- Confirm a member can reach their own `/users/[id]` from their row on `/members`, toggle phone/email visibility, save, and see the change reflected on `/members` for the other logged-in user.

- [ ] **Step 5: Commit**

```bash
git add src/app/members/page.tsx src/components/app-shell.tsx src/app/page.tsx
git commit -m "Add member registry page as the platform landing page"
git push
```

---

## Task 5: Payments repo — idempotent insert and latest-payment lookup

**Files:**
- Create: `src/lib/payments/repo.ts`
- Test: `src/lib/payments/repo.test.ts`

**Interfaces:**
- Consumes: `schema.externalPayments` (Task 1).
- Produces: `InsertPaymentInput` type; `insertPaymentIdempotent(db, input): Promise<boolean>`; `latestPaymentDate(db, userId): Promise<Date | null>` — both consumed by Task 6 (CSV import), Task 7 (recompute), and Task 9 (Stripe sync).

- [ ] **Step 1: Write the failing test**

Create `src/lib/payments/repo.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { insertPaymentIdempotent, latestPaymentDate } from './repo';

describe('payments repo', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'viktor', email: 'viktor@example.org', name: 'Viktor' });
  });

  describe('insertPaymentIdempotent', () => {
    it('returns true for a new (source, externalId) and false for a repeat', async () => {
      const input = { userId: 'viktor', source: 'stripe', externalId: 'ch_1', email: 'viktor@example.org', amountCents: 1000, currency: 'sek', paidAt: new Date('2026-01-01') };
      expect(await insertPaymentIdempotent(db, input)).toBe(true);
      expect(await insertPaymentIdempotent(db, input)).toBe(false);
    });
  });

  describe('latestPaymentDate', () => {
    it('returns null when the user has no payments', async () => {
      expect(await latestPaymentDate(db, 'viktor')).toBeNull();
    });

    it('returns the most recent paidAt across multiple payments', async () => {
      await insertPaymentIdempotent(db, { userId: 'viktor', source: 'stripe', externalId: 'ch_1', email: 'viktor@example.org', amountCents: null, currency: null, paidAt: new Date('2025-01-01') });
      await insertPaymentIdempotent(db, { userId: 'viktor', source: 'stripe', externalId: 'ch_2', email: 'viktor@example.org', amountCents: null, currency: null, paidAt: new Date('2026-06-01') });
      await insertPaymentIdempotent(db, { userId: 'viktor', source: 'stripe', externalId: 'ch_3', email: 'viktor@example.org', amountCents: null, currency: null, paidAt: new Date('2025-06-01') });
      expect(await latestPaymentDate(db, 'viktor')).toEqual(new Date('2026-06-01'));
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/repo.test.ts`
Expected: FAIL — module `./repo` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/payments/repo.ts`:

```typescript
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';

export interface InsertPaymentInput {
  userId: string;
  source: string;
  externalId: string;
  email: string;
  amountCents: number | null;
  currency: string | null;
  paidAt: Date;
}

/** Returns true if a new row was inserted, false if (source, externalId) already existed. */
export async function insertPaymentIdempotent(db: Db, input: InsertPaymentInput): Promise<boolean> {
  const rows = await db
    .insert(schema.externalPayments)
    .values({ id: randomUUID(), ...input })
    .onConflictDoNothing()
    .returning({ id: schema.externalPayments.id });
  return rows.length > 0;
}

export async function latestPaymentDate(db: Db, userId: string): Promise<Date | null> {
  const [row] = await db
    .select({ paidAt: schema.externalPayments.paidAt })
    .from(schema.externalPayments)
    .where(eq(schema.externalPayments.userId, userId))
    .orderBy(desc(schema.externalPayments.paidAt))
    .limit(1);
  return row?.paidAt ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/repo.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/repo.ts src/lib/payments/repo.test.ts
git commit -m "Add idempotent external-payment insert and latest-payment lookup"
git push
```

---

## Task 6: Membership status recompute rule

**Files:**
- Create: `src/lib/payments/recompute.ts`
- Test: `src/lib/payments/recompute.test.ts`

**Interfaces:**
- Consumes: `latestPaymentDate` (Task 5).
- Produces: `recomputeMembershipStatus(db, userId): Promise<void>` — consumed by Task 8 (CSV import commit) and Task 10 (Stripe sync).

- [ ] **Step 1: Write the failing test**

Create `src/lib/payments/recompute.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';
import { insertPaymentIdempotent } from './repo';
import { recomputeMembershipStatus } from './recompute';

async function getUser(db: Db, id: string) {
  const [u] = await db.select().from(schema.user).where(eq(schema.user.id, id));
  return u;
}

describe('recomputeMembershipStatus', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'viktor', email: 'viktor@example.org', name: 'Viktor' });
  });

  it('sets inactive with no expiry when there are no payments', async () => {
    await recomputeMembershipStatus(db, 'viktor');
    const u = await getUser(db, 'viktor');
    expect(u.isActiveMember).toBe(false);
    expect(u.membershipExpiresAt).toBeNull();
  });

  it('sets active with expiry one year after the most recent payment, when that is in the future', async () => {
    const paidAt = new Date();
    paidAt.setMonth(paidAt.getMonth() - 1); // paid a month ago, so expiry (paidAt + 1yr) is ~11 months out
    await insertPaymentIdempotent(db, { userId: 'viktor', source: 'stripe', externalId: 'ch_1', email: 'viktor@example.org', amountCents: null, currency: null, paidAt });
    await recomputeMembershipStatus(db, 'viktor');
    const u = await getUser(db, 'viktor');
    expect(u.isActiveMember).toBe(true);
    expect(u.membershipExpiresAt).toEqual(new Date(paidAt.getTime() + 365 * 24 * 60 * 60 * 1000));
  });

  it('sets inactive when the most recent payment is more than a year old', async () => {
    const paidAt = new Date();
    paidAt.setFullYear(paidAt.getFullYear() - 2);
    await insertPaymentIdempotent(db, { userId: 'viktor', source: 'stripe', externalId: 'ch_1', email: 'viktor@example.org', amountCents: null, currency: null, paidAt });
    await recomputeMembershipStatus(db, 'viktor');
    const u = await getUser(db, 'viktor');
    expect(u.isActiveMember).toBe(false);
    expect(u.membershipExpiresAt).not.toBeNull();
  });

  it('uses the most recent of several payments', async () => {
    const old = new Date(); old.setFullYear(old.getFullYear() - 3);
    const recent = new Date(); recent.setDate(recent.getDate() - 10);
    await insertPaymentIdempotent(db, { userId: 'viktor', source: 'a', externalId: '1', email: 'viktor@example.org', amountCents: null, currency: null, paidAt: old });
    await insertPaymentIdempotent(db, { userId: 'viktor', source: 'a', externalId: '2', email: 'viktor@example.org', amountCents: null, currency: null, paidAt: recent });
    await recomputeMembershipStatus(db, 'viktor');
    const u = await getUser(db, 'viktor');
    expect(u.isActiveMember).toBe(true);
    expect(u.membershipExpiresAt).toEqual(new Date(recent.getTime() + 365 * 24 * 60 * 60 * 1000));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/recompute.test.ts`
Expected: FAIL — module `./recompute` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/payments/recompute.ts`:

```typescript
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import { latestPaymentDate } from './repo';

const MEMBERSHIP_PERIOD_MS = 365 * 24 * 60 * 60 * 1000; // spec §5: one year from the payment date

export async function recomputeMembershipStatus(db: Db, userId: string): Promise<void> {
  const latest = await latestPaymentDate(db, userId);
  const membershipExpiresAt = latest ? new Date(latest.getTime() + MEMBERSHIP_PERIOD_MS) : null;
  const isActiveMember = membershipExpiresAt !== null && membershipExpiresAt.getTime() > Date.now();
  await db.update(schema.user).set({ isActiveMember, membershipExpiresAt }).where(eq(schema.user.id, userId));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/recompute.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/recompute.ts src/lib/payments/recompute.test.ts
git commit -m "Add membership status recompute rule (1 year from latest payment)"
git push
```

---

## Task 7: CSV parsing

**Files:**
- Create: `src/lib/payments/csv.ts`
- Test: `src/lib/payments/csv.test.ts`

**Interfaces:**
- Produces: `CsvRow`, `CsvRowError` types; `parseCsvLine(line): string[]`; `parseMemberCsv(text): { rows: CsvRow[]; errors: CsvRowError[] }` — consumed by Task 8 (import service) and Task 11 (import UI).

Pure functions, no DB — no PGlite needed for this task's tests.

- [ ] **Step 1: Write the failing test**

Create `src/lib/payments/csv.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { parseCsvLine, parseMemberCsv } from './csv';

describe('parseCsvLine', () => {
  it('splits plain comma-separated fields and trims whitespace', () => {
    expect(parseCsvLine('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  it('keeps a comma inside a quoted field', () => {
    expect(parseCsvLine('"Andersson, Erik",erik@example.org')).toEqual(['Andersson, Erik', 'erik@example.org']);
  });

  it('unescapes doubled quotes inside a quoted field', () => {
    expect(parseCsvLine('"Say ""hi""",x')).toEqual(['Say "hi"', 'x']);
  });
});

describe('parseMemberCsv', () => {
  it('parses email, name, amount and paid_at in any header order', () => {
    const text = 'name,email,paid_at,amount\nErik,erik@example.org,2026-01-15,150.50\n';
    const { rows, errors } = parseMemberCsv(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ email: 'erik@example.org', name: 'Erik', amountCents: 15050, paidAt: new Date('2026-01-15') }]);
  });

  it('allows amount and name to be omitted', () => {
    const text = 'email,paid_at\nerik@example.org,2026-01-15\n';
    const { rows, errors } = parseMemberCsv(text);
    expect(errors).toEqual([]);
    expect(rows).toEqual([{ email: 'erik@example.org', name: null, amountCents: null, paidAt: new Date('2026-01-15') }]);
  });

  it('lowercases email and reports the file line number for a bad row, continuing past it', () => {
    const text = 'email,paid_at\nErik@Example.org,2026-01-15\nnot-an-email,2026-01-15\nviktor@example.org,2026-02-01\n';
    const { rows, errors } = parseMemberCsv(text);
    expect(rows.map((r) => r.email)).toEqual(['erik@example.org', 'viktor@example.org']);
    expect(errors).toEqual([{ line: 3, message: 'Invalid email: "not-an-email"' }]);
  });

  it('reports an invalid paid_at date', () => {
    const text = 'email,paid_at\nerik@example.org,not-a-date\n';
    const { rows, errors } = parseMemberCsv(text);
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 2, message: 'Invalid paid_at date: "not-a-date"' }]);
  });

  it('reports an invalid amount', () => {
    const text = 'email,paid_at,amount\nerik@example.org,2026-01-15,not-a-number\n';
    const { rows, errors } = parseMemberCsv(text);
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 2, message: 'Invalid amount: "not-a-number"' }]);
  });

  it('rejects a file missing a required column', () => {
    const text = 'email,name\nerik@example.org,Erik\n';
    const { rows, errors } = parseMemberCsv(text);
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 1, message: 'Missing required column(s): paid_at' }]);
  });

  it('rejects an empty file', () => {
    const { rows, errors } = parseMemberCsv('');
    expect(rows).toEqual([]);
    expect(errors).toEqual([{ line: 0, message: 'File is empty' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/csv.test.ts`
Expected: FAIL — module `./csv` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/payments/csv.ts`:

```typescript
export interface CsvRow {
  email: string;
  name: string | null;
  amountCents: number | null;
  paidAt: Date;
}

export interface CsvRowError {
  line: number;
  message: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const REQUIRED_COLUMNS = ['email', 'paid_at'];

/** Splits one CSV line into trimmed fields, honoring double-quoted fields with "" as an escaped quote. */
export function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      fields.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  fields.push(field);
  return fields.map((f) => f.trim());
}

/** Columns: email (required), name (optional), amount (optional), paid_at (required). Any header order. */
export function parseMemberCsv(text: string): { rows: CsvRow[]; errors: CsvRowError[] } {
  const lines = text.split(/\r\n|\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { rows: [], errors: [{ line: 0, message: 'File is empty' }] };

  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const missing = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missing.length > 0) {
    return { rows: [], errors: [{ line: 1, message: `Missing required column(s): ${missing.join(', ')}` }] };
  }
  const index = (name: string) => header.indexOf(name);
  const emailIdx = index('email');
  const paidAtIdx = index('paid_at');
  const nameIdx = index('name');
  const amountIdx = index('amount');

  const rows: CsvRow[] = [];
  const errors: CsvRowError[] = [];
  for (let i = 1; i < lines.length; i++) {
    const lineNumber = i + 1;
    const fields = parseCsvLine(lines[i]);

    const email = (fields[emailIdx] ?? '').toLowerCase();
    if (!EMAIL_RE.test(email)) { errors.push({ line: lineNumber, message: `Invalid email: "${email}"` }); continue; }

    const paidAtRaw = fields[paidAtIdx] ?? '';
    const paidAt = new Date(paidAtRaw);
    if (Number.isNaN(paidAt.getTime())) { errors.push({ line: lineNumber, message: `Invalid paid_at date: "${paidAtRaw}"` }); continue; }

    const name = nameIdx >= 0 ? (fields[nameIdx] || null) : null;

    let amountCents: number | null = null;
    if (amountIdx >= 0 && fields[amountIdx]) {
      const amount = Number(fields[amountIdx]);
      if (Number.isNaN(amount)) { errors.push({ line: lineNumber, message: `Invalid amount: "${fields[amountIdx]}"` }); continue; }
      amountCents = Math.round(amount * 100);
    }

    rows.push({ email, name, amountCents, paidAt });
  }
  return { rows, errors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/csv.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/csv.ts src/lib/payments/csv.test.ts
git commit -m "Add member CSV parser"
git push
```

---

## Task 8: CSV import service

**Files:**
- Create: `src/lib/payments/import.ts`
- Test: `src/lib/payments/import.test.ts`

**Interfaces:**
- Consumes: `CsvRow` (Task 7), `findOrCreateUserByEmail` (Task 2), `insertPaymentIdempotent` (Task 5), `recomputeMembershipStatus` (Task 6).
- Produces: `ImportPreview`, `ImportResult` types; `previewImport(db, rows): Promise<ImportPreview>`; `commitImport(db, {source, rows}): Promise<ImportResult>` — consumed by Task 11 (import UI actions).

- [ ] **Step 1: Write the failing test**

Create `src/lib/payments/import.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';
import type { CsvRow } from './csv';
import { commitImport, previewImport } from './import';

describe('previewImport', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'viktor', email: 'viktor@example.org', name: 'Viktor' });
  });

  it('counts new vs matched emails', async () => {
    const rows: CsvRow[] = [
      { email: 'viktor@example.org', name: null, amountCents: null, paidAt: new Date('2026-01-01') },
      { email: 'new1@example.org', name: 'New One', amountCents: null, paidAt: new Date('2026-01-01') },
      { email: 'new2@example.org', name: 'New Two', amountCents: null, paidAt: new Date('2026-01-01') },
    ];
    const preview = await previewImport(db, rows);
    expect(preview).toEqual({ newUserCount: 2, matchedUserCount: 1, paymentCount: 3 });
  });
});

describe('commitImport', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'viktor', email: 'viktor@example.org', name: 'Viktor' });
  });

  it('creates users for unmatched emails, reuses existing ones, and computes membership status', async () => {
    const paidAt = new Date();
    const rows: CsvRow[] = [
      { email: 'viktor@example.org', name: null, amountCents: 10000, paidAt },
      { email: 'new@example.org', name: 'New Person', amountCents: 5000, paidAt },
    ];
    const result = await commitImport(db, { source: 'Legacy Website', rows });
    expect(result.touchedUserIds).toHaveLength(2);

    const [viktor] = await db.select().from(schema.user).where(eq(schema.user.id, 'viktor'));
    expect(viktor.isActiveMember).toBe(true);

    const [created] = await db.select().from(schema.user).where(eq(schema.user.email, 'new@example.org'));
    expect(created).toMatchObject({ name: 'New Person', isActiveMember: true });

    const payments = await db.select().from(schema.externalPayments);
    expect(payments).toHaveLength(2);
    expect(payments.every((p) => p.source === 'Legacy Website')).toBe(true);
  });

  it('is idempotent: importing the same rows twice does not duplicate payments', async () => {
    const rows: CsvRow[] = [{ email: 'new@example.org', name: 'New Person', amountCents: 5000, paidAt: new Date('2026-01-01') }];
    await commitImport(db, { source: 'Swish', rows });
    await commitImport(db, { source: 'Swish', rows });
    const payments = await db.select().from(schema.externalPayments);
    expect(payments).toHaveLength(1);
  });

  it('treats the same email from two different sources as two separate payments', async () => {
    const rows: CsvRow[] = [{ email: 'new@example.org', name: 'New Person', amountCents: 5000, paidAt: new Date('2026-01-01') }];
    await commitImport(db, { source: 'Swish', rows });
    await commitImport(db, { source: 'Legacy Website', rows });
    const payments = await db.select().from(schema.externalPayments);
    expect(payments).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/import.test.ts`
Expected: FAIL — module `./import` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/payments/import.ts`:

```typescript
import { createHash } from 'node:crypto';
import { schema, type Db } from '@/db';
import { findOrCreateUserByEmail } from '@/lib/users/service';
import type { CsvRow } from './csv';
import { recomputeMembershipStatus } from './recompute';
import { insertPaymentIdempotent } from './repo';

export interface ImportPreview {
  newUserCount: number;
  matchedUserCount: number;
  paymentCount: number;
}

/** Read-only: how many rows would create a new user vs match an existing one. Small member lists — fetching all users once is simpler than per-row queries. */
export async function previewImport(db: Db, rows: CsvRow[]): Promise<ImportPreview> {
  const existingEmails = new Set((await db.select({ email: schema.user.email }).from(schema.user)).map((u) => u.email.toLowerCase()));
  const rowEmails = new Set(rows.map((r) => r.email));
  const newUserCount = [...rowEmails].filter((e) => !existingEmails.has(e)).length;
  return { newUserCount, matchedUserCount: rowEmails.size - newUserCount, paymentCount: rows.length };
}

export interface ImportResult {
  touchedUserIds: string[];
}

export async function commitImport(db: Db, input: { source: string; rows: CsvRow[] }): Promise<ImportResult> {
  const touched = new Set<string>();
  for (const row of input.rows) {
    const user = await findOrCreateUserByEmail(db, row.email, row.name);
    const externalId = createHash('sha256').update(`${input.source}|${row.email}|${row.paidAt.toISOString()}|${row.amountCents ?? ''}`).digest('hex');
    await insertPaymentIdempotent(db, {
      userId: user.id, source: input.source, externalId, email: row.email,
      amountCents: row.amountCents, currency: null, paidAt: row.paidAt,
    });
    touched.add(user.id);
  }
  for (const userId of touched) await recomputeMembershipStatus(db, userId);
  return { touchedUserIds: [...touched] };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/import.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/import.ts src/lib/payments/import.test.ts
git commit -m "Add CSV import service: preview and idempotent commit"
git push
```

---

## Task 9: Preview token encode/decode

**Files:**
- Create: `src/lib/payments/preview-token.ts`
- Test: `src/lib/payments/preview-token.test.ts`

**Interfaces:**
- Produces: `encodePreview(data): string`; `decodePreview<T>(token): T` — consumed by Task 11 (import UI), which carries the parsed-and-validated CSV rows from the "preview" redirect to the page render without a database round trip.

- [ ] **Step 1: Write the failing test**

Create `src/lib/payments/preview-token.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { decodePreview, encodePreview } from './preview-token';

describe('preview token', () => {
  it('round-trips an object through encode/decode', () => {
    const data = { source: 'Swish', rows: [{ email: 'a@example.org', amountCents: 100 }], errors: [] };
    const token = encodePreview(data);
    expect(decodePreview(token)).toEqual(data);
  });

  it('produces a URL-safe token (no +, / or = characters)', () => {
    const token = encodePreview({ text: '???large amount of data +/= to force base64 padding and special chars???' });
    expect(token).not.toMatch(/[+/=]/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/preview-token.test.ts`
Expected: FAIL — module `./preview-token` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/payments/preview-token.ts`:

```typescript
/** Carries the parsed CSV preview from the "preview" redirect to the confirm form, entirely client-round-trip — no server-side pending-import state. */
export function encodePreview(data: unknown): string {
  return Buffer.from(JSON.stringify(data)).toString('base64url');
}

export function decodePreview<T>(token: string): T {
  return JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as T;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/preview-token.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/preview-token.ts src/lib/payments/preview-token.test.ts
git commit -m "Add base64url preview-token encode/decode for the CSV import flow"
git push
```

---

## Task 10: CSV import UI

**Files:**
- Create: `src/app/members/import/page.tsx`
- Create: `src/app/members/import/actions.ts`

**Interfaces:**
- Consumes: `parseMemberCsv` (Task 7), `previewImport`/`commitImport` (Task 8), `encodePreview`/`decodePreview` (Task 9), `requireAdmin` (existing).

No new unit test — same as Task 4, this is page/action wiring over an already-tested service layer, verified by the check in Step 3 and the manual walkthrough in Step 4. (The Stripe card on this page is added in Task 13; this task only wires the CSV path so it can be checked independently first.)

- [ ] **Step 1: Add the actions**

Create `src/app/members/import/actions.ts`:

```typescript
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { parseMemberCsv } from '@/lib/payments/csv';
import { commitImport, previewImport } from '@/lib/payments/import';
import { encodePreview } from '@/lib/payments/preview-token';
import { requireAdmin } from '@/lib/session';
import type { PreviewPayload } from './preview';

export async function previewCsvImportAction(formData: FormData) {
  await requireAdmin();
  const source = String(formData.get('source') ?? '').trim();
  const file = formData.get('file');
  if (!source || !(file instanceof File) || file.size === 0) {
    redirect(`/members/import?error=${encodeURIComponent('Source and a CSV file are required')}`);
  }
  const text = await (file as File).text();
  const { rows, errors } = parseMemberCsv(text);
  if (rows.length === 0) {
    redirect(`/members/import?error=${encodeURIComponent(errors[0]?.message ?? 'No valid rows found in file')}`);
  }
  const { newUserCount, matchedUserCount } = await previewImport(await getDb(), rows);
  const payload: PreviewPayload = {
    source,
    rows: rows.map((r) => ({ ...r, paidAt: r.paidAt.toISOString() })),
    errors,
    newUserCount,
    matchedUserCount,
  };
  redirect(`/members/import?preview=${encodePreview(payload)}`);
}

export async function commitCsvImportAction(formData: FormData) {
  await requireAdmin();
  const source = String(formData.get('source') ?? '');
  const parsed = JSON.parse(String(formData.get('rows') ?? '[]')) as PreviewPayload['rows'];
  const rows = parsed.map((r) => ({ ...r, paidAt: new Date(r.paidAt) }));
  const { touchedUserIds } = await commitImport(await getDb(), { source, rows });
  revalidatePath('/members');
  redirect(`/members/import?success=${touchedUserIds.length}`);
}
```

Create `src/app/members/import/preview.ts` (the shared payload shape, imported by both the action and the page):

```typescript
export interface PreviewPayload {
  source: string;
  rows: { email: string; name: string | null; amountCents: number | null; paidAt: string }[];
  errors: { line: number; message: string }[];
  newUserCount: number;
  matchedUserCount: number;
}
```

- [ ] **Step 2: Add the page**

Create `src/app/members/import/page.tsx`:

```tsx
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { decodePreview } from '@/lib/payments/preview-token';
import { requireAdmin } from '@/lib/session';
import { commitCsvImportAction, previewCsvImportAction } from './actions';
import type { PreviewPayload } from './preview';

export const dynamic = 'force-dynamic';

export default async function ImportMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; preview?: string; success?: string }>;
}) {
  const admin = await requireAdmin();
  const { error, preview, success } = await searchParams;
  const payload = preview ? decodePreview<PreviewPayload>(preview) : undefined;

  return (
    <AppShell user={admin}>
      <h1 className="mb-4 text-xl font-semibold">Import members</h1>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {success && <Alert className="mb-4"><AlertDescription>Imported payments for {success} member(s).</AlertDescription></Alert>}

      {payload ? (
        <Card className="max-w-2xl">
          <CardHeader>
            <CardTitle>Preview: {payload.source}</CardTitle>
            <CardDescription>
              {payload.newUserCount} new member(s), {payload.matchedUserCount} matched to existing accounts, {payload.rows.length} payment row(s).
              {payload.errors.length > 0 && ` ${payload.errors.length} row(s) skipped due to errors.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {payload.errors.length > 0 && (
              <Table>
                <TableHeader><TableRow><TableHead>Line</TableHead><TableHead>Error</TableHead></TableRow></TableHeader>
                <TableBody>
                  {payload.errors.map((e) => (
                    <TableRow key={e.line}><TableCell>{e.line}</TableCell><TableCell>{e.message}</TableCell></TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
            <form action={commitCsvImportAction}>
              <input type="hidden" name="source" value={payload.source} />
              <input type="hidden" name="rows" value={JSON.stringify(payload.rows)} />
              <Button type="submit">Confirm import</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Upload CSV</CardTitle>
            <CardDescription>Columns: email (required), name, amount, paid_at (required).</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={previewCsvImportAction} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="source">Source</Label>
                <Input id="source" name="source" required placeholder="Legacy Website" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="file">CSV file</Label>
                <Input id="file" name="file" type="file" accept=".csv,text/csv" required />
              </div>
              <Button type="submit">Preview</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
```

- [ ] **Step 3: Full local check**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 4: Manual walkthrough**

Run: `npm run dev`, log in as an admin.
- Go to `/members/import`, upload a small CSV (e.g. `email,name,amount,paid_at\nnew@example.org,New Person,100,2026-01-01\n`), confirm the preview shows 1 new member / 0 matched, click "Confirm import".
- Confirm the new member now appears on `/members` as active (paid within the last year relative to today).
- Re-upload the same file; confirm the preview still shows sensible counts and confirming again does not create a duplicate payment (spot-check via a second import of an existing member — status stays consistent, no error).

- [ ] **Step 5: Commit**

```bash
git add src/app/members/import/
git commit -m "Add admin CSV import UI for members"
git push
```

---

## Task 11: Stripe client

**Files:**
- Create: `src/lib/payments/stripe.ts`
- Test: `src/lib/payments/stripe.test.ts`

**Interfaces:**
- Produces: `StripeCharge` type; `StripeError`; `StripeClient` with `listSuccessfulCharges(startingAfter?): Promise<{ charges: StripeCharge[]; nextCursor?: string }>` — consumed by Task 12 (sync service) and Task 13 (deps wiring).

Mirrors `src/lib/fly.ts`'s `FlyClient`: a small hand-rolled `fetch` wrapper with an injectable `fetch` for testing, no SDK.

- [ ] **Step 1: Write the failing test**

Create `src/lib/payments/stripe.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { StripeClient, StripeError } from './stripe';

type Call = { url: string; auth: string | null };

function fakeFetch(responder: (call: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const call: Call = { url: String(input), auth: new Headers(init?.headers).get('authorization') };
    calls.push(call);
    const r = responder(call);
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchImpl };
}

const client = (f: typeof fetch) => new StripeClient({ apiKey: 'sk_test_123', fetch: f });

describe('StripeClient', () => {
  it('lists successful charges with bearer auth and default paging', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      status: 200,
      json: { data: [{ id: 'ch_1', amount: 1000, currency: 'sek', status: 'succeeded', created: 1750000000, billing_details: { email: 'a@example.org' } }], has_more: false },
    }));
    const { charges, nextCursor } = await client(fetchImpl).listSuccessfulCharges();
    expect(calls[0]).toMatchObject({ url: 'https://api.stripe.com/v1/charges?limit=100', auth: 'Bearer sk_test_123' });
    expect(charges).toHaveLength(1);
    expect(nextCursor).toBeUndefined();
  });

  it('filters out non-succeeded charges', async () => {
    const { fetchImpl } = fakeFetch(() => ({
      status: 200,
      json: { data: [{ id: 'ch_1', amount: 1000, currency: 'sek', status: 'failed', created: 1, billing_details: {} }], has_more: false },
    }));
    const { charges } = await client(fetchImpl).listSuccessfulCharges();
    expect(charges).toEqual([]);
  });

  it('returns a nextCursor and passes starting_after through when has_more is true', async () => {
    const { calls, fetchImpl } = fakeFetch(() => ({
      status: 200,
      json: { data: [{ id: 'ch_2', amount: 500, currency: 'sek', status: 'succeeded', created: 2, billing_details: { email: 'b@example.org' } }], has_more: true },
    }));
    const { nextCursor } = await client(fetchImpl).listSuccessfulCharges('ch_1');
    expect(calls[0].url).toBe('https://api.stripe.com/v1/charges?limit=100&starting_after=ch_1');
    expect(nextCursor).toBe('ch_2');
  });

  it('throws StripeError on a non-2xx response', async () => {
    const { fetchImpl } = fakeFetch(() => ({ status: 401, json: { error: { message: 'Invalid API key' } } }));
    await expect(client(fetchImpl).listSuccessfulCharges()).rejects.toBeInstanceOf(StripeError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/stripe.test.ts`
Expected: FAIL — module `./stripe` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/payments/stripe.ts`:

```typescript
export interface StripeCharge {
  id: string;
  amount: number;
  currency: string;
  status: string;
  created: number; // unix seconds
  billing_details?: { email?: string | null };
  receipt_email?: string | null;
}

interface ChargeListResponse {
  data: StripeCharge[];
  has_more: boolean;
}

export class StripeError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'StripeError';
  }
}

export class StripeClient {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly opts: { apiKey: string; fetch?: typeof fetch; baseUrl?: string }) {
    this.fetchImpl = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? 'https://api.stripe.com/v1';
  }

  async listSuccessfulCharges(startingAfter?: string): Promise<{ charges: StripeCharge[]; nextCursor?: string }> {
    const params = new URLSearchParams({ limit: '100' });
    if (startingAfter) params.set('starting_after', startingAfter);
    const res = await this.fetchImpl(`${this.baseUrl}/charges?${params}`, { headers: { authorization: `Bearer ${this.opts.apiKey}` } });
    const text = await res.text();
    if (!res.ok) throw new StripeError(res.status, `Stripe GET /charges → ${res.status}: ${text}`);
    const body = JSON.parse(text) as ChargeListResponse;
    const charges = body.data.filter((c) => c.status === 'succeeded');
    return { charges, nextCursor: body.has_more ? body.data[body.data.length - 1]?.id : undefined };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/stripe.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/stripe.ts src/lib/payments/stripe.test.ts
git commit -m "Add hand-rolled Stripe REST client (charges, no SDK)"
git push
```

---

## Task 12: Stripe sync service

**Files:**
- Create: `src/lib/payments/stripe-sync.ts`
- Test: `src/lib/payments/stripe-sync.test.ts`

**Interfaces:**
- Consumes: `StripeClient`/`StripeCharge` (Task 11), `findOrCreateUserByEmail` (Task 2), `insertPaymentIdempotent` (Task 5), `recomputeMembershipStatus` (Task 6).
- Produces: `StripeSyncSummary` type; `StripeSyncError`; `syncStripePayments(db, stripe): Promise<StripeSyncSummary>` — consumed by Task 13 (UI wiring).

- [ ] **Step 1: Write the failing test**

Create `src/lib/payments/stripe-sync.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';
import type { StripeClient } from './stripe';
import { StripeSyncError, syncStripePayments } from './stripe-sync';

function fakeStripe(pages: { charges: { id: string; amount: number; currency: string; status: string; created: number; billing_details?: { email?: string | null } }[]; nextCursor?: string }[]): Pick<StripeClient, 'listSuccessfulCharges'> {
  let call = 0;
  return {
    async listSuccessfulCharges() {
      const page = pages[call++];
      if (!page) throw new Error('no more pages configured');
      return { charges: page.charges.filter((c) => c.status === 'succeeded'), nextCursor: page.nextCursor };
    },
  };
}

describe('syncStripePayments', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
  });

  it('creates a user and payment for a succeeded charge with an email', async () => {
    const stripe = fakeStripe([{ charges: [{ id: 'ch_1', amount: 1000, currency: 'sek', status: 'succeeded', created: Math.floor(Date.now() / 1000), billing_details: { email: 'new@example.org' } }] }]);
    const summary = await syncStripePayments(db, stripe);
    expect(summary).toEqual({ synced: 1, skipped: 0, skippedNoEmail: 0 });
    const [user] = await db.select().from(schema.user).where(eq(schema.user.email, 'new@example.org'));
    expect(user.isActiveMember).toBe(true);
  });

  it('skips a charge with no billing email', async () => {
    const stripe = fakeStripe([{ charges: [{ id: 'ch_1', amount: 1000, currency: 'sek', status: 'succeeded', created: 1, billing_details: {} }] }]);
    const summary = await syncStripePayments(db, stripe);
    expect(summary).toEqual({ synced: 0, skipped: 0, skippedNoEmail: 1 });
  });

  it('is idempotent across two runs on the same charges', async () => {
    const charges = [{ id: 'ch_1', amount: 1000, currency: 'sek', status: 'succeeded', created: 1, billing_details: { email: 'a@example.org' } }];
    await syncStripePayments(db, fakeStripe([{ charges }]));
    const second = await syncStripePayments(db, fakeStripe([{ charges }]));
    expect(second).toEqual({ synced: 0, skipped: 1, skippedNoEmail: 0 });
    const payments = await db.select().from(schema.externalPayments);
    expect(payments).toHaveLength(1);
  });

  it('follows the nextCursor across pages', async () => {
    const stripe = fakeStripe([
      { charges: [{ id: 'ch_1', amount: 100, currency: 'sek', status: 'succeeded', created: 1, billing_details: { email: 'a@example.org' } }], nextCursor: 'ch_1' },
      { charges: [{ id: 'ch_2', amount: 200, currency: 'sek', status: 'succeeded', created: 2, billing_details: { email: 'b@example.org' } }] },
    ]);
    const summary = await syncStripePayments(db, stripe);
    expect(summary.synced).toBe(2);
  });

  it('keeps rows written before a mid-sync failure and reports partial progress via StripeSyncError', async () => {
    const stripe: Pick<StripeClient, 'listSuccessfulCharges'> = {
      async listSuccessfulCharges(startingAfter) {
        if (!startingAfter) return { charges: [{ id: 'ch_1', amount: 100, currency: 'sek', status: 'succeeded', created: 1, billing_details: { email: 'a@example.org' } }], nextCursor: 'ch_1' };
        throw new Error('network blip');
      },
    };
    await expect(syncStripePayments(db, stripe)).rejects.toBeInstanceOf(StripeSyncError);
    const payments = await db.select().from(schema.externalPayments);
    expect(payments).toHaveLength(1); // the first page's charge is still committed
    const [user] = await db.select().from(schema.user).where(eq(schema.user.email, 'a@example.org'));
    expect(user.isActiveMember).toBe(true); // recompute still ran for what was synced before the failure
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/payments/stripe-sync.test.ts`
Expected: FAIL — module `./stripe-sync` does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/payments/stripe-sync.ts`:

```typescript
import { findOrCreateUserByEmail } from '@/lib/users/service';
import type { Db } from '@/db';
import { recomputeMembershipStatus } from './recompute';
import { insertPaymentIdempotent } from './repo';
import type { StripeCharge, StripeClient } from './stripe';

export interface StripeSyncSummary {
  synced: number;
  skipped: number;
  skippedNoEmail: number;
}

export class StripeSyncError extends Error {
  constructor(message: string, public partial: StripeSyncSummary) {
    super(message);
    this.name = 'StripeSyncError';
  }
}

function chargeEmail(c: StripeCharge): string | null {
  return c.billing_details?.email ?? c.receipt_email ?? null;
}

export async function syncStripePayments(db: Db, stripe: Pick<StripeClient, 'listSuccessfulCharges'>): Promise<StripeSyncSummary> {
  const summary: StripeSyncSummary = { synced: 0, skipped: 0, skippedNoEmail: 0 };
  const touched = new Set<string>();
  let cursor: string | undefined;
  try {
    for (;;) {
      const { charges, nextCursor } = await stripe.listSuccessfulCharges(cursor);
      for (const charge of charges) {
        const email = chargeEmail(charge);
        if (!email) { summary.skippedNoEmail++; continue; }
        const normalized = email.trim().toLowerCase();
        const user = await findOrCreateUserByEmail(db, normalized);
        const inserted = await insertPaymentIdempotent(db, {
          userId: user.id, source: 'stripe', externalId: charge.id, email: normalized,
          amountCents: charge.amount, currency: charge.currency, paidAt: new Date(charge.created * 1000),
        });
        if (inserted) { summary.synced++; touched.add(user.id); } else { summary.skipped++; }
      }
      if (!nextCursor) break;
      cursor = nextCursor;
    }
  } catch (e) {
    throw new StripeSyncError(e instanceof Error ? e.message : 'Stripe sync failed', summary);
  } finally {
    // Runs on both the normal path and the thrown path: whatever was written before a
    // failure still gets its membership status recomputed, matching the "retries are safe,
    // progress isn't lost" guarantee from the spec.
    for (const userId of touched) await recomputeMembershipStatus(db, userId);
  }
  return summary;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/payments/stripe-sync.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/payments/stripe-sync.ts src/lib/payments/stripe-sync.test.ts
git commit -m "Add Stripe charge sync with idempotent upsert and partial-failure reporting"
git push
```

---

## Task 13: Stripe sync wiring

**Files:**
- Create: `src/lib/payments/deps.ts`
- Modify: `src/app/members/import/actions.ts`
- Modify: `src/app/members/import/page.tsx`
- Modify: `.env.example`

**Interfaces:**
- Consumes: `StripeClient` (Task 11), `syncStripePayments`/`StripeSyncError` (Task 12).

No new unit test — thin env-reading glue plus a form/action, same category as Task 4 and Task 10.

- [ ] **Step 1: Add the deps factory**

Create `src/lib/payments/deps.ts`:

```typescript
import { StripeClient } from './stripe';

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

export function stripeClient(): StripeClient {
  return new StripeClient({ apiKey: env('STRIPE_API_KEY') });
}
```

- [ ] **Step 2: Add the sync action**

In `src/app/members/import/actions.ts`, add the import and the new action:

```typescript
import { stripeClient } from '@/lib/payments/deps';
import { StripeSyncError, syncStripePayments, type StripeSyncSummary } from '@/lib/payments/stripe-sync';
```

```typescript
export async function syncStripeAction() {
  await requireAdmin();
  let errorMessage: string | undefined;
  let summary: StripeSyncSummary | undefined;
  try {
    summary = await syncStripePayments(await getDb(), stripeClient());
  } catch (e) {
    if (e instanceof StripeSyncError) errorMessage = `${e.message} (${e.partial.synced} synced before the error)`;
    else throw e;
  }
  if (errorMessage) redirect(`/members/import?error=${encodeURIComponent(errorMessage)}`);
  revalidatePath('/members');
  redirect(`/members/import?stripeSynced=${summary!.synced}&stripeSkipped=${summary!.skipped}`);
}
```

- [ ] **Step 3: Add the Stripe card to the page**

In `src/app/members/import/page.tsx`:
- Import `syncStripeAction` alongside the existing action imports.
- Widen the `searchParams` type: `{ error?: string; preview?: string; success?: string; stripeSynced?: string; stripeSkipped?: string }`.
- Destructure `stripeSynced, stripeSkipped` from `searchParams` alongside the existing fields.
- After the existing `{success && ...}` alert block, add:

```tsx
{stripeSynced && <Alert className="mb-4"><AlertDescription>Stripe sync: {stripeSynced} new payment(s), {stripeSkipped} already known.</AlertDescription></Alert>}
```

- After the closing `</Card>` of the CSV upload/preview card (i.e. as a sibling, still inside the `AppShell`), add:

```tsx
<Card className="mt-6 max-w-md">
  <CardHeader>
    <CardTitle>Stripe</CardTitle>
    <CardDescription>Pulls successful charges into the payment records used to compute membership status.</CardDescription>
  </CardHeader>
  <CardContent>
    <form action={syncStripeAction}>
      <Button type="submit" variant="outline">Sync from Stripe</Button>
    </form>
  </CardContent>
</Card>
```

- [ ] **Step 4: Document the env var**

In `.env.example`, add near the other API keys (after `RESEND_API_KEY`/`EMAIL_FROM`):

```
# Stripe: reads successful charges to compute membership status. Fly secret in prod.
STRIPE_API_KEY=
```

- [ ] **Step 5: Full local check**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/lib/payments/deps.ts src/app/members/import/actions.ts src/app/members/import/page.tsx .env.example
git commit -m "Wire Stripe sync into the member import page"
git push
```

---

## Task 14: Open the pull request

- [ ] **Step 1: Final full check**

Run: `npx vitest run && npm run lint && npm run build && npx tsc --noEmit`
Expected: all pass (this repeats the README's full local check, including `build`, which the per-task steps above didn't run every time).

- [ ] **Step 2: Open the PR**

```bash
gh pr create --title "Member registry, self/admin access model, CSV + Stripe payment sync" --body "$(cat <<'EOF'
## Summary
- Members can view/edit their own profile; only admins can edit anyone else's or override membership status.
- New /members registry, visible to all logged-in members, with per-member opt-in phone/email visibility. It's now the platform's landing page.
- New externalPayments table (spec §2), fed by an admin CSV importer (two external sources, preview-before-commit) and an admin-triggered Stripe sync (hand-rolled REST client, no SDK).
- isActiveMember/membershipExpiresAt are now computed automatically from the latest payment (1 year from paidAt); admins can still override.

Spec: docs/superpowers/specs/2026-09-16-member-registry-design.md

## Test plan
- [x] npx vitest run
- [x] npm run lint
- [x] npm run build
- [x] npx tsc --noEmit
- [x] Manual walkthrough: login, self-edit visibility, registry cross-visibility, CSV import (new user, confirm, re-upload no-dupe)
- [ ] Manual Stripe sync against a real STRIPE_API_KEY (needs the Fly secret; not available on this box)
EOF
)"
```
