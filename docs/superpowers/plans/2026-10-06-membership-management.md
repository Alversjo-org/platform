# Membership Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe-backed membership payments, a `member-admin` role with a member directory (including imported, never-logged-in members), configurable renewal-ask emails via Resend, and self-service profile fields, replacing the box-fleet-only homepage with a membership dashboard.

**Architecture:** Extends the existing `user` table (it already anticipated `isActiveMember`/`membershipExpiresAt`/`phoneNumber`) rather than adding a parallel members table. Stripe talks to the app via a server-redirect Checkout flow plus a webhook that is the only writer of subscription state; a member-admin can also hand-edit the same fields for cash/manual cases. The current admin-only `/users` page is retired in favor of `/members`, scoped to the new `member-admin` role (of which `admin` is a superset).

**Tech Stack:** Next.js 16 App Router, Drizzle ORM (PGlite dev / Postgres prod), BetterAuth 1.7 (email OTP), `stripe` (Node SDK), Resend, shadcn/ui on `@base-ui/react`, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-06-membership-management-design.md`

## Global Constraints

- `role` is `'member' | 'member-admin' | 'admin'`; every member-admin check accepts either `'member-admin'` or `'admin'` (admin is a superset, never the other way round).
- Box-fleet access (`/boxes`, `canAccessBox`, `listBoxesFor`) stays gated on `role === 'admin'` exactly — `member-admin` grants no box access.
- No separate "members" table: imported, never-logged-in members are plain `user` rows (`emailVerified=false`, no `account`/`session` row).
- One membership, three payment paths: yearly recurring (default), monthly recurring, one-time yearly. No tiers.
- Renewal-ask emails are sent manually, per member, from `/members/[id]` — nothing scheduled/automatic.
- Contact tracking is `lastContactedAt` + `contactNotes` only — no history log table.
- CSV import (`name,email,membershipExpiresAt`) never overwrites an existing member; matches by email case-insensitively.
- `STRIPE_API_KEY` is already set in Fly secrets — do not introduce a different name for it. New secrets this plan adds: `STRIPE_WEBHOOK_SECRET`. New non-secret env: `STRIPE_PRICE_YEARLY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ONE_TIME`.
- `/users`, `/users/[id]` and `src/app/users/actions.ts` are deleted — `/members` replaces them entirely.
- Follow existing conventions: one `.test.ts` beside the module it tests; PGlite `pglite://memory` for anything hitting the DB; Fly/Resend/Stripe faked in tests (no real network calls); server actions are `'use server'` functions in an `actions.ts` beside the page that uses them; UI is composed only from existing shadcn/`@base-ui/react` components (add a `Textarea` the same way, not a different library). Pages and server actions are not unit-tested in this codebase today (only service/lib layers are) — this plan keeps that pattern and verifies UI tasks by running the dev server.
- After any `src/db/schema.ts` change, run `npm run db:generate` and commit the generated SQL under `drizzle/`.

## Review Focus

- An admin leaves `isActiveMember=true` with `membershipExpiresAt` in the past (stale manual edit) — the member must still read as expired, not active. → `status.test.ts` (Task 3).
- A member whose membership just expired POSTs the profile-update form directly, bypassing the UI that hides it — the update must be rejected server-side, not just hidden client-side. → `members/service.test.ts`, `MembershipExpiredError` (Task 3).
- CSV import matches an existing member's email case-insensitively (`Viktor@Example.org` vs. stored `viktor@example.org`) and skips it rather than creating a duplicate. → `import.test.ts` (Task 7).
- A Stripe webhook event carries a `client_reference_id` or `customer` id with no matching user (stale/test event, or the row was since deleted) — must log and return, never throw. → `webhook.test.ts` (Task 11).
- `member-admin` must not gain box-fleet access merely by holding that role — box access stays strictly `role === 'admin'`. → new assertion in `session.test.ts` using `canAccessBox` (Task 2).

---

### Task 1: Schema & migration

**Files:**
- Modify: `src/db/schema.ts`
- Modify: `src/db/index.test.ts`
- Generate: `drizzle/0003_<name>.sql` (via `npm run db:generate`, name picked by drizzle-kit)

**Interfaces:**
- Produces: `Role = 'member' | 'member-admin' | 'admin'`; `User` gains `nickname: string | null`, `discordHandle: string | null`, `stripeCustomerId: string | null`, `stripeSubscriptionId: string | null`, `lastContactedAt: Date | null`, `contactNotes: string | null`; new `schema.renewalMessageSetting` table and `RenewalMessageSetting` type.

- [ ] **Step 1: Update the schema**

Replace the top of `src/db/schema.ts` through the `user` table definition with:

```ts
import { boolean, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

export type Role = 'member' | 'member-admin' | 'admin';
export type BoxProfile = 'admin' | 'contributor';

// BetterAuth core tables. Field names (TS keys) must match BetterAuth's model
// fields; column names are ours.
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  nickname: text('nickname'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  role: text('role', { enum: ['member', 'member-admin', 'admin'] }).$type<Role>().notNull().default('member'),
  phoneNumber: text('phone_number'),
  discordHandle: text('discord_handle'),
  isActiveMember: boolean('is_active_member').notNull().default(false),
  membershipExpiresAt: timestamp('membership_expires_at'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  lastContactedAt: timestamp('last_contacted_at'),
  contactNotes: text('contact_notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});
```

Leave `session`, `account`, `verification`, `boxes`, `boxAccess` untouched. At the bottom of the file, after the `boxAccess` table and before the type exports, add:

```ts
export const renewalMessageSetting = pgTable('renewal_message_setting', {
  id: text('id').primaryKey().default('default'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => user.id),
});
```

And add to the type exports at the very bottom:

```ts
export type RenewalMessageSetting = typeof renewalMessageSetting.$inferSelect;
```

- [ ] **Step 2: Generate the migration**

Run: `npm run db:generate`
Expected: a new file appears under `drizzle/`, e.g. `drizzle/0003_<adjective>_<name>.sql`, containing `ALTER TABLE "user" ADD COLUMN ...` for each new column and a `CREATE TABLE "renewal_message_setting" (...)` with its foreign key to `user`.

- [ ] **Step 3: Extend the schema smoke test**

In `src/db/index.test.ts`, change the first test to also assert the new columns default correctly, and add a test for the new table:

```ts
  it('opens an in-memory PGlite database with migrations applied', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'a@example.org' });
    const rows = await db.select().from(schema.user);
    expect(rows).toHaveLength(1);
    expect(rows[0].role).toBe('member');
    expect(rows[0]).toMatchObject({
      nickname: null, discordHandle: null, stripeCustomerId: null, stripeSubscriptionId: null,
      lastContactedAt: null, contactNotes: null,
    });
  });

  it('accepts a renewal message setting row', async () => {
    const db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'admin1', email: 'admin@example.org', role: 'admin' });
    await db.insert(schema.renewalMessageSetting).values({ id: 'default', subject: 'Renew', body: 'Hi {name}', updatedByUserId: 'admin1' });
    const [row] = await db.select().from(schema.renewalMessageSetting);
    expect(row).toMatchObject({ subject: 'Renew', body: 'Hi {name}' });
  });
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/db/index.test.ts`
Expected: PASS (both existing and new assertions).

- [ ] **Step 5: Verify migrations are committed and consistent**

Run: `npm run db:check`
Expected: exits 0 (no diff between the committed migration and a fresh `generate`).

- [ ] **Step 6: Commit**

```bash
git add src/db/schema.ts src/db/index.test.ts drizzle/
git commit -m "Add member-admin role, profile/Stripe/contact columns, and renewal message table"
```

---

### Task 2: Session & role model

**Files:**
- Modify: `src/lib/session.ts`
- Create: `src/lib/session.test.ts`
- Modify: `src/app/api/internal/box-session/route.ts`

**Interfaces:**
- Consumes: `Role` from Task 1.
- Produces: `roleFromRaw(raw: string | undefined): Role`, `isMemberAdmin(user: { role: Role }): boolean`, `requireMemberAdmin(): Promise<SessionUser>`. `requireAdmin` now redirects to `/` instead of `/boxes` (the homepage changes in Task 13).

- [ ] **Step 1: Write the failing test**

Create `src/lib/session.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import { canAccessBox } from '@/lib/boxes/access';
import { isMemberAdmin, roleFromRaw } from './session';

describe('roleFromRaw', () => {
  it('maps admin and member-admin explicitly, defaulting everything else to member', () => {
    expect(roleFromRaw('admin')).toBe('admin');
    expect(roleFromRaw('member-admin')).toBe('member-admin');
    expect(roleFromRaw('member')).toBe('member');
    expect(roleFromRaw(undefined)).toBe('member');
    expect(roleFromRaw('bogus')).toBe('member');
  });
});

describe('isMemberAdmin', () => {
  it('is true for admin and member-admin, false for member', () => {
    expect(isMemberAdmin({ role: 'admin' })).toBe(true);
    expect(isMemberAdmin({ role: 'member-admin' })).toBe(true);
    expect(isMemberAdmin({ role: 'member' })).toBe(false);
  });
});

describe('box access is unaffected by member-admin', () => {
  let db: Db;

  it('member-admin has no box access, same as a plain member', async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'ma', email: 'ma@example.org', role: 'member-admin' },
      { id: 'owner', email: 'owner@example.org', role: 'member' },
    ]);
    await db.insert(schema.boxes).values({ id: 'b1', name: 'b', profile: 'contributor', jwtSecret: 's', ownerUserId: 'owner' });
    expect(await canAccessBox(db, { id: 'ma', role: 'member-admin' }, 'b1')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/session.test.ts`
Expected: FAIL — `roleFromRaw` and `isMemberAdmin` are not exported yet.

- [ ] **Step 3: Implement**

Replace `src/lib/session.ts` with:

```ts
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Role } from '@/db/schema';
import { getAuth } from '@/lib/auth';

export type SessionUser = { id: string; email: string; role: Role };

export function roleFromRaw(raw: string | undefined): Role {
  if (raw === 'admin') return 'admin';
  if (raw === 'member-admin') return 'member-admin';
  return 'member';
}

export function isMemberAdmin(user: { role: Role }): boolean {
  return user.role === 'admin' || user.role === 'member-admin';
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = await getAuth();
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const role = roleFromRaw((s.user as { role?: string }).role);
  return { id: s.user.id, email: s.user.email, role };
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect('/login');
  return u;
}

export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  // A member who reaches an admin page is not an error to report, just someone in the
  // wrong place: send them to their own homepage.
  if (u.role !== 'admin') redirect('/');
  return u;
}

export async function requireMemberAdmin(): Promise<SessionUser> {
  const u = await requireUser();
  if (!isMemberAdmin(u)) redirect('/');
  return u;
}
```

In `src/app/api/internal/box-session/route.ts`, replace the inline role cast with the shared helper:

```ts
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { getAuth } from '@/lib/auth';
import { canAccessBox } from '@/lib/boxes/access';
import type { BoxSessionResult } from '@/lib/boxes/box-session';
import { mintCloudCliToken } from '@/lib/boxes/cloudcli-token';
import { roleFromRaw } from '@/lib/session';

/** Called only by server.ts over localhost. Resolves a box host + cookie into a proxy decision. */
export async function POST(request: Request): Promise<Response> {
  if (!process.env.INTERNAL_SECRET || request.headers.get('x-internal-secret') !== process.env.INTERNAL_SECRET) {
    return Response.json({ status: 'forbidden' } satisfies BoxSessionResult, { status: 403 });
  }
  const { host, cookie } = (await request.json()) as { host: string; cookie?: string };
  const auth = await getAuth();
  const session = await auth.api.getSession({ headers: new Headers({ cookie: cookie ?? '' }) });
  if (!session) return Response.json({ status: 'unauthenticated' } satisfies BoxSessionResult);

  const db = await getDb();
  const boxId = host.split('.')[0];
  if (!/^[0-9a-f]{12}$/.test(boxId)) return Response.json({ status: 'not_found' } satisfies BoxSessionResult);
  const [box] = await db.select().from(schema.boxes).where(eq(schema.boxes.id, boxId));
  if (!box) return Response.json({ status: 'not_found' } satisfies BoxSessionResult);

  const role = roleFromRaw((session.user as { role?: string }).role);
  if (!(await canAccessBox(db, { id: session.user.id, role }, boxId))) {
    return Response.json({ status: 'forbidden' } satisfies BoxSessionResult);
  }
  if (!box.flyMachineId) return Response.json({ status: 'not_found' } satisfies BoxSessionResult);
  return Response.json({
    status: 'ok', boxId, machineId: box.flyMachineId, token: mintCloudCliToken(box.jwtSecret), canStart: role === 'admin',
  } satisfies BoxSessionResult);
}
```

In `src/lib/auth.ts`, widen the `role` additionalField's type list so BetterAuth's own typing matches the schema (the value is still only ever auto-assigned `'admin'` or `'member'`; `'member-admin'` is only ever set by a member-admin editing the row directly):

```ts
      additionalFields: {
        role: { type: ['member', 'member-admin', 'admin'], required: false, defaultValue: 'member', input: false },
      },
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/session.test.ts src/app/api/internal/box-session/route.test.ts src/lib/auth.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts src/lib/session.test.ts src/app/api/internal/box-session/route.ts src/lib/auth.ts
git commit -m "Add member-admin to the role model; share role resolution between session and box-session route"
```

---

### Task 3: Member status & member service

**Files:**
- Create: `src/lib/members/status.ts`
- Create: `src/lib/members/status.test.ts`
- Create: `src/lib/members/service.ts`
- Create: `src/lib/members/service.test.ts`

**Interfaces:**
- Consumes: `User` from `@/db/schema` (Task 1).
- Produces: `isActiveNow(member): boolean`, `needsPayment(member): boolean`; `listMembers(db): Promise<User[]>`, `updateMember(db, input): Promise<User>` (member-admin's full edit), `updateOwnProfile(db, input): Promise<User>` (self-service, throws `MembershipExpiredError` if not currently active), `touchLastContacted(db, id): Promise<void>`; error classes `UserNotFoundError`, `InvalidPhoneError`, `MembershipExpiredError`.

- [ ] **Step 1: Write the failing test for status**

Create `src/lib/members/status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isActiveNow, needsPayment } from './status';

const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe('isActiveNow', () => {
  it('is false when isActiveMember is true but the expiry date has passed', () => {
    expect(isActiveNow({ isActiveMember: true, membershipExpiresAt: past })).toBe(false);
  });

  it('is true when active and the expiry date is in the future', () => {
    expect(isActiveNow({ isActiveMember: true, membershipExpiresAt: future })).toBe(true);
  });

  it('is false with no expiry date at all', () => {
    expect(isActiveNow({ isActiveMember: true, membershipExpiresAt: null })).toBe(false);
  });
});

describe('needsPayment', () => {
  it('is true for an expired member even with a stripeSubscriptionId on file', () => {
    expect(needsPayment({ isActiveMember: true, membershipExpiresAt: past, stripeSubscriptionId: 'sub_1' })).toBe(true);
  });

  it('is true for an active member with no recurring subscription (manual grant or one-time payment)', () => {
    expect(needsPayment({ isActiveMember: true, membershipExpiresAt: future, stripeSubscriptionId: null })).toBe(true);
  });

  it('is false for an active member on a live subscription', () => {
    expect(needsPayment({ isActiveMember: true, membershipExpiresAt: future, stripeSubscriptionId: 'sub_1' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/members/status.test.ts`
Expected: FAIL — module `./status` does not exist.

- [ ] **Step 3: Implement status.ts**

Create `src/lib/members/status.ts`:

```ts
import type { User } from '@/db/schema';

/** True only when the member flag is set AND the expiry date is still in the future. */
export function isActiveNow(member: Pick<User, 'isActiveMember' | 'membershipExpiresAt'>): boolean {
  return member.isActiveMember && member.membershipExpiresAt !== null && member.membershipExpiresAt > new Date();
}

/** Payment buttons show whenever not an active member, or active but with no live recurring subscription. */
export function needsPayment(member: Pick<User, 'isActiveMember' | 'membershipExpiresAt' | 'stripeSubscriptionId'>): boolean {
  return !isActiveNow(member) || !member.stripeSubscriptionId;
}
```

- [ ] **Step 4: Run status test again**

Run: `npx vitest run src/lib/members/status.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the member service**

Create `src/lib/members/service.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import {
  InvalidPhoneError, listMembers, MembershipExpiredError, touchLastContacted, updateMember, updateOwnProfile, UserNotFoundError,
} from './service';

describe('member service', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values([
      { id: 'viktor', email: 'viktor@example.org', name: 'Viktor' },
      { id: 'admin', email: 'admin@example.org', name: 'Admin', role: 'admin' },
    ]);
  });

  it('updateMember sets every member-admin-editable field, including membership status and notes', async () => {
    const expiresAt = new Date('2027-01-01T00:00:00Z');
    const updated = await updateMember(db, {
      id: 'viktor', name: 'Viktor Andersson', nickname: 'Vik', phoneNumber: '+46701234567', discordHandle: 'vik#1234',
      isActiveMember: true, membershipExpiresAt: expiresAt, contactNotes: 'Paid at the door',
    });
    expect(updated).toMatchObject({
      name: 'Viktor Andersson', nickname: 'Vik', phoneNumber: '+46701234567', discordHandle: 'vik#1234',
      isActiveMember: true, contactNotes: 'Paid at the door',
    });
    expect(updated.membershipExpiresAt).toEqual(expiresAt);
  });

  it('updateMember rejects a phone number that is not E.164', async () => {
    await expect(
      updateMember(db, {
        id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: '0701234567', discordHandle: null,
        isActiveMember: false, membershipExpiresAt: null, contactNotes: null,
      }),
    ).rejects.toBeInstanceOf(InvalidPhoneError);
  });

  it('updateMember throws for an unknown id', async () => {
    await expect(
      updateMember(db, {
        id: 'nobody', name: 'X', nickname: null, phoneNumber: null, discordHandle: null,
        isActiveMember: false, membershipExpiresAt: null, contactNotes: null,
      }),
    ).rejects.toBeInstanceOf(UserNotFoundError);
  });

  it('listMembers lists everyone, ordered by creation', async () => {
    const members = await listMembers(db);
    expect(members.map((m) => m.id)).toEqual(['viktor', 'admin']);
  });

  it('updateOwnProfile lets an active member set name, nickname, phone and Discord handle', async () => {
    const future = new Date(Date.now() + 86_400_000);
    await updateMember(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null,
      isActiveMember: true, membershipExpiresAt: future, contactNotes: null,
    });
    const updated = await updateOwnProfile(db, { id: 'viktor', name: 'Vik', nickname: 'V', phoneNumber: '+46701234567', discordHandle: 'vik#1' });
    expect(updated).toMatchObject({ name: 'Vik', nickname: 'V', phoneNumber: '+46701234567', discordHandle: 'vik#1' });
  });

  it('updateOwnProfile refuses to edit a profile that is not currently active, even if someone posts the form directly', async () => {
    // viktor is never made active in this test: isActiveMember defaults to false.
    await expect(
      updateOwnProfile(db, { id: 'viktor', name: 'Vik', nickname: null, phoneNumber: null, discordHandle: null }),
    ).rejects.toBeInstanceOf(MembershipExpiredError);
  });

  it('touchLastContacted stamps the current time', async () => {
    await touchLastContacted(db, 'viktor');
    const [row] = await listMembers(db);
    expect(row.lastContactedAt).toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/lib/members/service.test.ts`
Expected: FAIL — module `./service` does not exist.

- [ ] **Step 7: Implement service.ts**

Create `src/lib/members/service.ts`:

```ts
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';
import type { User } from '@/db/schema';
import { isActiveNow } from './status';

export class UserNotFoundError extends Error { constructor(id: string) { super(`No user ${id}`); this.name = 'UserNotFoundError'; } }
export class InvalidPhoneError extends Error { constructor(phone: string) { super(`Not a valid phone number: ${phone}`); this.name = 'InvalidPhoneError'; } }
export class MembershipExpiredError extends Error { constructor() { super('Membership is not active'); this.name = 'MembershipExpiredError'; } }

// E.164: a leading '+', then 1-15 digits, first digit non-zero.
const E164_RE = /^\+[1-9]\d{1,14}$/;

function checkPhone(phoneNumber: string | null): void {
  if (phoneNumber !== null && !E164_RE.test(phoneNumber)) throw new InvalidPhoneError(phoneNumber);
}

export function listMembers(db: Db): Promise<User[]> {
  return db.select().from(schema.user).orderBy(schema.user.createdAt);
}

/** Member-admin edit: the full row, including membership status and contact tracking. */
export async function updateMember(
  db: Db,
  input: {
    id: string; name: string; nickname: string | null; phoneNumber: string | null; discordHandle: string | null;
    isActiveMember: boolean; membershipExpiresAt: Date | null; contactNotes: string | null;
  },
): Promise<User> {
  checkPhone(input.phoneNumber);
  const [row] = await db
    .update(schema.user)
    .set({
      name: input.name, nickname: input.nickname, phoneNumber: input.phoneNumber, discordHandle: input.discordHandle,
      isActiveMember: input.isActiveMember, membershipExpiresAt: input.membershipExpiresAt, contactNotes: input.contactNotes,
    })
    .where(eq(schema.user.id, input.id))
    .returning();
  if (!row) throw new UserNotFoundError(input.id);
  return row;
}

/** Self-service edit: an active member can set their own name/nickname/phone/Discord, nothing membership-related. */
export async function updateOwnProfile(
  db: Db,
  input: { id: string; name: string; nickname: string | null; phoneNumber: string | null; discordHandle: string | null },
): Promise<User> {
  checkPhone(input.phoneNumber);
  const [current] = await db.select().from(schema.user).where(eq(schema.user.id, input.id));
  if (!current) throw new UserNotFoundError(input.id);
  if (!isActiveNow(current)) throw new MembershipExpiredError();
  const [row] = await db
    .update(schema.user)
    .set({ name: input.name, nickname: input.nickname, phoneNumber: input.phoneNumber, discordHandle: input.discordHandle })
    .where(eq(schema.user.id, input.id))
    .returning();
  if (!row) throw new UserNotFoundError(input.id);
  return row;
}

export async function touchLastContacted(db: Db, id: string): Promise<void> {
  await db.update(schema.user).set({ lastContactedAt: new Date() }).where(eq(schema.user.id, id));
}
```

- [ ] **Step 8: Run the tests**

Run: `npx vitest run src/lib/members/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/members/status.ts src/lib/members/status.test.ts src/lib/members/service.ts src/lib/members/service.test.ts
git commit -m "Add member status helpers and a member service with admin and self-service edits"
```

---

### Task 4: Renewal message settings service

**Files:**
- Create: `src/lib/members/renewal-message.ts`
- Create: `src/lib/members/renewal-message.test.ts`

**Interfaces:**
- Consumes: `schema.renewalMessageSetting` (Task 1).
- Produces: `DEFAULT_RENEWAL_SUBJECT`, `DEFAULT_RENEWAL_BODY`, `getRenewalMessage(db): Promise<{subject, body}>`, `updateRenewalMessage(db, input): Promise<void>`, `renderMessage(template, {name, expiresAt}): string`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/members/renewal-message.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import {
  DEFAULT_RENEWAL_BODY, DEFAULT_RENEWAL_SUBJECT, getRenewalMessage, renderMessage, updateRenewalMessage,
} from './renewal-message';

describe('renewal message settings', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'admin', email: 'admin@example.org', role: 'admin' });
  });

  it('falls back to the built-in default when nothing is configured', async () => {
    expect(await getRenewalMessage(db)).toEqual({ subject: DEFAULT_RENEWAL_SUBJECT, body: DEFAULT_RENEWAL_BODY });
  });

  it('stores and returns a custom message', async () => {
    await updateRenewalMessage(db, { subject: 'Renew now', body: 'Hi {name}', updatedByUserId: 'admin' });
    expect(await getRenewalMessage(db)).toEqual({ subject: 'Renew now', body: 'Hi {name}' });
  });

  it('overwrites the stored message on a second update rather than duplicating it', async () => {
    await updateRenewalMessage(db, { subject: 'A', body: 'A', updatedByUserId: 'admin' });
    await updateRenewalMessage(db, { subject: 'B', body: 'B', updatedByUserId: 'admin' });
    expect(await getRenewalMessage(db)).toEqual({ subject: 'B', body: 'B' });
    expect(await db.select().from(schema.renewalMessageSetting)).toHaveLength(1);
  });
});

describe('renderMessage', () => {
  it('substitutes the name and a formatted expiry date', () => {
    expect(renderMessage('Hi {name}, you expire {expiresAt}', { name: 'Viktor', expiresAt: new Date('2027-01-15') }))
      .toBe('Hi Viktor, you expire 2027-01-15');
  });

  it('falls back to placeholder text when the name or expiry is missing', () => {
    expect(renderMessage('Hi {name}, {expiresAt}', { name: '', expiresAt: null })).toBe('Hi there, an unknown date');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/members/renewal-message.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/members/renewal-message.ts`:

```ts
import { eq } from 'drizzle-orm';
import { schema, type Db } from '@/db';

export const DEFAULT_RENEWAL_SUBJECT = 'Time to renew your Alversjö membership';
export const DEFAULT_RENEWAL_BODY =
  'Hi {name},\n\nYour Alversjö membership expires on {expiresAt}. Renew at ' +
  'https://members.alversjo.land to keep your access.\n\nThanks,\nAlversjö';

export async function getRenewalMessage(db: Db): Promise<{ subject: string; body: string }> {
  const [row] = await db.select().from(schema.renewalMessageSetting).where(eq(schema.renewalMessageSetting.id, 'default'));
  if (!row) return { subject: DEFAULT_RENEWAL_SUBJECT, body: DEFAULT_RENEWAL_BODY };
  return { subject: row.subject, body: row.body };
}

export async function updateRenewalMessage(db: Db, input: { subject: string; body: string; updatedByUserId: string }): Promise<void> {
  await db
    .insert(schema.renewalMessageSetting)
    .values({ id: 'default', subject: input.subject, body: input.body, updatedByUserId: input.updatedByUserId })
    .onConflictDoUpdate({
      target: schema.renewalMessageSetting.id,
      set: { subject: input.subject, body: input.body, updatedAt: new Date(), updatedByUserId: input.updatedByUserId },
    });
}

/** Substitutes {name} and {expiresAt} in a subject or body string. */
export function renderMessage(template: string, vars: { name: string; expiresAt: Date | null }): string {
  const expiresAt = vars.expiresAt ? vars.expiresAt.toISOString().slice(0, 10) : 'an unknown date';
  return template.replaceAll('{name}', vars.name || 'there').replaceAll('{expiresAt}', expiresAt);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/members/renewal-message.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/members/renewal-message.ts src/lib/members/renewal-message.test.ts
git commit -m "Add configurable renewal message settings with a built-in default"
```

---

### Task 5: Resend renewal email helper

**Files:**
- Modify: `src/lib/email.ts`
- Create: `src/lib/email.test.ts`

**Interfaces:**
- Produces: `sendRenewalEmail({ to, subject, body }): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/email.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendRenewalEmail } from './email';

describe('sendRenewalEmail', () => {
  const prevKey = process.env.RESEND_API_KEY;

  beforeEach(() => { delete process.env.RESEND_API_KEY; });
  afterEach(() => { if (prevKey === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = prevKey; });

  it('prints to the console instead of sending when RESEND_API_KEY is unset', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await sendRenewalEmail({ to: 'a@example.org', subject: 'Renew', body: 'Hi' });
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('to=a@example.org subject="Renew"'));
    logSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/email.test.ts`
Expected: FAIL — `sendRenewalEmail` is not exported yet.

- [ ] **Step 3: Implement**

Add to `src/lib/email.ts` (keep `sendOtpEmail` as-is):

```ts
export type RenewalMail = { to: string; subject: string; body: string };

/** Sends a renewal-ask email. Without RESEND_API_KEY the message is printed instead (dev boxes). */
export async function sendRenewalEmail({ to, subject, body }: RenewalMail): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log(`[email] to=${to} subject="${subject}"`);
    return;
  }
  const from = process.env.EMAIL_FROM ?? 'Alversjö <no-reply@notifications.alversjo.land>';
  const { error } = await new Resend(key).emails.send({ from, to: [to], subject, text: body });
  if (error) throw new Error(`Resend: ${error.message}`);
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/email.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/email.ts src/lib/email.test.ts
git commit -m "Add sendRenewalEmail, mirroring the existing OTP-email dev fallback"
```

---

### Task 6: Member directory pages

**Files:**
- Create: `src/components/ui/textarea.tsx`
- Create: `src/app/members/page.tsx`
- Create: `src/app/members/[id]/page.tsx`
- Create: `src/app/members/actions.ts`
- Modify: `src/components/app-shell.tsx`
- Delete: `src/app/users/page.tsx`, `src/app/users/[id]/page.tsx`, `src/app/users/actions.ts`

**Interfaces:**
- Consumes: `requireMemberAdmin`, `isMemberAdmin` (Task 2); `listMembers`, `updateMember`, `touchLastContacted`, `InvalidPhoneError`, `UserNotFoundError` (Task 3); `getRenewalMessage`, `renderMessage` (Task 4); `sendRenewalEmail` (Task 5).
- Produces: `updateMemberAction(formData)`, `sendRenewalAskAction(formData)` — consumed by Task 8's settings page link and manual testing only, no later task imports these directly.

- [ ] **Step 1: Add the Textarea component**

Create `src/components/ui/textarea.tsx`, matching the existing `input.tsx` style:

```tsx
import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
```

- [ ] **Step 2: Update the app shell nav**

Replace `src/components/app-shell.tsx`:

```tsx
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { isMemberAdmin, type SessionUser } from '@/lib/session';

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-lg font-semibold">Alversjö</Link>
          <Link href="/boxes" className="text-sm text-muted-foreground hover:text-foreground">Boxes</Link>
          {isMemberAdmin(user) && <Link href="/members" className="text-sm text-muted-foreground hover:text-foreground">Members</Link>}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>{user.email}</span>
          {user.role !== 'member' && <Badge>{user.role}</Badge>}
        </div>
      </header>
      <Separator className="my-4" />
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 3: Add the member directory list page**

Create `src/app/members/page.tsx`:

```tsx
import Link from 'next/link';
import { getDb } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listMembers } from '@/lib/members/service';
import { requireMemberAdmin } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function MembersPage() {
  const admin = await requireMemberAdmin();
  const members = await listMembers(await getDb());
  return (
    <AppShell user={admin}>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Members</h1>
        <div className="flex gap-4">
          <Link href="/members/import" className="text-sm underline">Import CSV</Link>
          <Link href="/members/settings" className="text-sm underline">Renewal message</Link>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Phone</TableHead>
            <TableHead>Discord</TableHead><TableHead>Membership</TableHead><TableHead>Last contacted</TableHead><TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell><Link href={`/members/${m.id}`} className="underline">{m.name || m.nickname || '—'}</Link></TableCell>
              <TableCell>{m.email}</TableCell>
              <TableCell>{m.phoneNumber ?? '—'}</TableCell>
              <TableCell>{m.discordHandle ?? '—'}</TableCell>
              <TableCell>
                <Badge variant={m.isActiveMember ? 'default' : 'secondary'}>{m.isActiveMember ? 'active' : 'inactive'}</Badge>
                {m.membershipExpiresAt && <span className="ml-2 text-muted-foreground text-sm">until {m.membershipExpiresAt.toISOString().slice(0, 10)}</span>}
              </TableCell>
              <TableCell>{m.lastContactedAt ? m.lastContactedAt.toISOString().slice(0, 10) : '—'}</TableCell>
              <TableCell className="text-right"><Link href={`/members/${m.id}`} className="underline">Edit</Link></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </AppShell>
  );
}
```

- [ ] **Step 4: Add the member detail/edit + send-ask page**

Create `src/app/members/[id]/page.tsx`:

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
import { Textarea } from '@/components/ui/textarea';
import { getRenewalMessage, renderMessage } from '@/lib/members/renewal-message';
import { requireMemberAdmin } from '@/lib/session';
import { sendRenewalAskAction, updateMemberAction } from '../actions';

export const dynamic = 'force-dynamic';

export default async function MemberPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;
  const admin = await requireMemberAdmin();
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, id));
  if (!member) notFound();
  const defaultMessage = await getRenewalMessage(db);
  const prefilled = {
    subject: renderMessage(defaultMessage.subject, { name: member.name, expiresAt: member.membershipExpiresAt }),
    body: renderMessage(defaultMessage.body, { name: member.name, expiresAt: member.membershipExpiresAt }),
  };

  return (
    <AppShell user={admin}>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <h1 className="mb-4 text-xl font-semibold">{member.email}</h1>
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Details</CardTitle></CardHeader>
          <CardContent>
            <form action={updateMemberAction} className="space-y-4">
              <input type="hidden" name="id" value={member.id} />
              <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={member.name} /></div>
              <div className="space-y-2"><Label htmlFor="nickname">Nickname</Label><Input id="nickname" name="nickname" defaultValue={member.nickname ?? ''} /></div>
              <div className="space-y-2"><Label htmlFor="phoneNumber">Phone number</Label><Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={member.phoneNumber ?? ''} /></div>
              <div className="space-y-2"><Label htmlFor="discordHandle">Discord handle</Label><Input id="discordHandle" name="discordHandle" defaultValue={member.discordHandle ?? ''} /></div>
              <div className="flex items-center gap-2"><Checkbox id="isActiveMember" name="isActiveMember" defaultChecked={member.isActiveMember} /><Label htmlFor="isActiveMember">Active member</Label></div>
              <div className="space-y-2">
                <Label htmlFor="membershipExpiresAt">Membership expires</Label>
                <Input id="membershipExpiresAt" name="membershipExpiresAt" type="date" defaultValue={member.membershipExpiresAt ? member.membershipExpiresAt.toISOString().slice(0, 10) : ''} />
              </div>
              <div className="space-y-2"><Label htmlFor="contactNotes">Notes</Label><Textarea id="contactNotes" name="contactNotes" defaultValue={member.contactNotes ?? ''} /></div>
              <Button type="submit">Save</Button>
            </form>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Send renewal ask</CardTitle></CardHeader>
          <CardContent>
            <form action={sendRenewalAskAction} className="space-y-4">
              <input type="hidden" name="id" value={member.id} />
              <div className="space-y-2"><Label htmlFor="subject">Subject</Label><Input id="subject" name="subject" defaultValue={prefilled.subject} /></div>
              <div className="space-y-2"><Label htmlFor="body">Message</Label><Textarea id="body" name="body" rows={8} defaultValue={prefilled.body} /></div>
              <p className="text-sm text-muted-foreground">
                {member.lastContactedAt ? `Last contacted ${member.lastContactedAt.toISOString().slice(0, 10)}` : 'Never contacted'}
              </p>
              <Button type="submit">Send</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
```

- [ ] **Step 5: Add the server actions**

Create `src/app/members/actions.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import { sendRenewalEmail } from '@/lib/email';
import { InvalidPhoneError, touchLastContacted, updateMember, UserNotFoundError } from '@/lib/members/service';
import { requireMemberAdmin } from '@/lib/session';

function knownMessage(e: unknown): string | undefined {
  if (e instanceof UserNotFoundError || e instanceof InvalidPhoneError) return e.message;
  return undefined;
}

export async function updateMemberAction(formData: FormData) {
  await requireMemberAdmin();
  const id = String(formData.get('id'));
  const expiresRaw = String(formData.get('membershipExpiresAt') ?? '').trim();
  const phoneRaw = String(formData.get('phoneNumber') ?? '').trim();

  let errorRedirect: string | undefined;
  try {
    await updateMember(await getDb(), {
      id,
      name: String(formData.get('name') ?? '').trim(),
      nickname: String(formData.get('nickname') ?? '').trim() || null,
      phoneNumber: phoneRaw === '' ? null : phoneRaw,
      discordHandle: String(formData.get('discordHandle') ?? '').trim() || null,
      isActiveMember: formData.get('isActiveMember') !== null,
      membershipExpiresAt: expiresRaw === '' ? null : new Date(expiresRaw),
      contactNotes: String(formData.get('contactNotes') ?? '').trim() || null,
    });
  } catch (e) {
    const message = knownMessage(e);
    if (message === undefined) throw e;
    errorRedirect = `/members/${id}?error=${encodeURIComponent(message)}`;
  }
  if (errorRedirect) redirect(errorRedirect);
  revalidatePath('/members');
  revalidatePath(`/members/${id}`);
  redirect('/members');
}

export async function sendRenewalAskAction(formData: FormData) {
  await requireMemberAdmin();
  const id = String(formData.get('id'));
  const subject = String(formData.get('subject') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, id));
  if (!member) throw new UserNotFoundError(id);
  await sendRenewalEmail({ to: member.email, subject, body });
  await touchLastContacted(db, id);
  revalidatePath(`/members/${id}`);
  revalidatePath('/members');
  redirect(`/members/${id}`);
}
```

- [ ] **Step 6: Delete the retired `/users` pages**

```bash
git rm src/app/users/page.tsx "src/app/users/[id]/page.tsx" src/app/users/actions.ts
```

- [ ] **Step 7: Run the full test suite and build**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS, no type errors (no remaining imports of the deleted `src/lib/users/service` module — it was never created, only the old `src/app/users/*` files are deleted).

- [ ] **Step 8: Manual check**

Run: `npm run dev`, log in as the `ADMIN_EMAILS` address, visit `/members` — the directory loads with the seeded admin row; click into it, edit a field, save, confirm it persists; use the "Send renewal ask" form and confirm the console prints `[email] to=... subject=...` (no `RESEND_API_KEY` set in dev).

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/textarea.tsx src/components/app-shell.tsx src/app/members/ src/app/users
git commit -m "Replace /users with a member-admin directory: edit, notes, and manual renewal-ask sends"
```

---

### Task 7: CSV import service

**Files:**
- Create: `src/lib/members/import.ts`
- Create: `src/lib/members/import.test.ts`

**Interfaces:**
- Produces: `ImportRowResult = { email: string; status: 'created' | 'skipped' | 'error'; message?: string }`, `importMembers(db, csvText: string): Promise<ImportRowResult[]>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/members/import.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';
import { importMembers } from './import';

describe('importMembers', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'existing', email: 'existing@example.org', name: 'Existing' });
  });

  it('creates new members from CSV rows, deriving isActiveMember from the expiry date', async () => {
    const results = await importMembers(
      db,
      'name,email,membershipExpiresAt\nViktor,viktor@example.org,2099-01-01\nNoExpiry,noexpiry@example.org,',
    );
    expect(results).toEqual([
      { email: 'viktor@example.org', status: 'created' },
      { email: 'noexpiry@example.org', status: 'created' },
    ]);
    const [viktor] = await db.select().from(schema.user).where(eq(schema.user.email, 'viktor@example.org'));
    expect(viktor).toMatchObject({ name: 'Viktor', isActiveMember: true });
    const [noExpiry] = await db.select().from(schema.user).where(eq(schema.user.email, 'noexpiry@example.org'));
    expect(noExpiry).toMatchObject({ isActiveMember: false, membershipExpiresAt: null });
  });

  it('skips a row matching an existing member by email case-insensitively, without overwriting it', async () => {
    const results = await importMembers(db, 'name,email,membershipExpiresAt\nNew Name,Existing@Example.org,2099-01-01');
    expect(results).toEqual([{ email: 'existing@example.org', status: 'skipped', message: 'Already a member' }]);
    const [row] = await db.select().from(schema.user).where(eq(schema.user.email, 'existing@example.org'));
    expect(row.name).toBe('Existing');
  });

  it('reports a bad row without failing the rest of the batch', async () => {
    const results = await importMembers(db, 'name,email,membershipExpiresAt\nBad,not-an-email,\nGood,good@example.org,');
    expect(results[0]).toMatchObject({ status: 'error' });
    expect(results[1]).toMatchObject({ status: 'created' });
  });

  it('reports an invalid date without failing the row before it', async () => {
    const results = await importMembers(db, 'name,email,membershipExpiresAt\nGood,good@example.org,\nBad,bad@example.org,not-a-date');
    expect(results[0]).toMatchObject({ status: 'created' });
    expect(results[1]).toMatchObject({ status: 'error' });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/members/import.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/members/import.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { schema, type Db } from '@/db';

export type ImportRowResult = { email: string; status: 'created' | 'skipped' | 'error'; message?: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseCsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

/** CSV columns: name,email,membershipExpiresAt (membershipExpiresAt optional, ISO date, blank = never a member). */
export async function importMembers(db: Db, csvText: string): Promise<ImportRowResult[]> {
  const rows = parseCsv(csvText);
  const dataRows = rows[0]?.[1]?.toLowerCase() === 'email' ? rows.slice(1) : rows; // tolerate an optional header row
  const results: ImportRowResult[] = [];

  for (const [name, email, expiresRaw] of dataRows) {
    if (!email || !EMAIL_RE.test(email)) {
      results.push({ email: email ?? '', status: 'error', message: 'Missing or invalid email' });
      continue;
    }
    const lowerEmail = email.toLowerCase();
    const [existing] = await db.select({ id: schema.user.id }).from(schema.user).where(sql`lower(${schema.user.email}) = ${lowerEmail}`);
    if (existing) {
      results.push({ email: lowerEmail, status: 'skipped', message: 'Already a member' });
      continue;
    }
    let membershipExpiresAt: Date | null = null;
    if (expiresRaw) {
      membershipExpiresAt = new Date(expiresRaw);
      if (Number.isNaN(membershipExpiresAt.getTime())) {
        results.push({ email: lowerEmail, status: 'error', message: `Invalid date: ${expiresRaw}` });
        continue;
      }
    }
    await db.insert(schema.user).values({
      id: randomUUID(),
      email,
      name: name ?? '',
      membershipExpiresAt,
      isActiveMember: membershipExpiresAt !== null && membershipExpiresAt > new Date(),
    });
    results.push({ email: lowerEmail, status: 'created' });
  }
  return results;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/members/import.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/members/import.ts src/lib/members/import.test.ts
git commit -m "Add CSV import for members from external sources"
```

---

### Task 8: CSV import & renewal message settings UI

**Files:**
- Create: `src/app/members/import/page.tsx`
- Create: `src/app/members/import/actions.ts`
- Create: `src/app/members/settings/page.tsx`
- Create: `src/app/members/settings/actions.ts`

**Interfaces:**
- Consumes: `importMembers` (Task 7); `getRenewalMessage`, `updateRenewalMessage` (Task 4); `requireMemberAdmin` (Task 2); `Textarea` (Task 6).

- [ ] **Step 1: Add the import page**

Create `src/app/members/import/page.tsx`:

```tsx
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { requireMemberAdmin } from '@/lib/session';
import { importMembersAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ImportMembersPage({ searchParams }: { searchParams: Promise<{ results?: string }> }) {
  const admin = await requireMemberAdmin();
  const { results } = await searchParams;
  const parsed = results ? (JSON.parse(results) as { email: string; status: string; message?: string }[]) : null;

  return (
    <AppShell user={admin}>
      <h1 className="mb-4 text-xl font-semibold">Import members</h1>
      <Card className="max-w-lg">
        <CardHeader><CardTitle>Paste CSV (name,email,membershipExpiresAt)</CardTitle></CardHeader>
        <CardContent>
          <form action={importMembersAction} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="csv">CSV</Label>
              <Textarea id="csv" name="csv" rows={10} placeholder={'name,email,membershipExpiresAt\nViktor,viktor@example.org,2027-01-01'} />
            </div>
            <Button type="submit">Import</Button>
          </form>
        </CardContent>
      </Card>
      {parsed && (
        <Card className="mt-4 max-w-lg">
          <CardHeader><CardTitle>Results</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {parsed.map((r, i) => (
                <li key={i}>{r.email} — {r.status}{r.message ? `: ${r.message}` : ''}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
```

- [ ] **Step 2: Add the import action**

Create `src/app/members/import/actions.ts`:

```ts
'use server';

import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { importMembers } from '@/lib/members/import';
import { requireMemberAdmin } from '@/lib/session';

export async function importMembersAction(formData: FormData) {
  await requireMemberAdmin();
  const csv = String(formData.get('csv') ?? '');
  const results = await importMembers(await getDb(), csv);
  redirect(`/members/import?results=${encodeURIComponent(JSON.stringify(results))}`);
}
```

- [ ] **Step 3: Add the renewal message settings page**

Create `src/app/members/settings/page.tsx`:

```tsx
import { AppShell } from '@/components/app-shell';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { getDb } from '@/db';
import { getRenewalMessage } from '@/lib/members/renewal-message';
import { requireMemberAdmin } from '@/lib/session';
import { updateRenewalMessageAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function RenewalMessageSettingsPage() {
  const admin = await requireMemberAdmin();
  const message = await getRenewalMessage(await getDb());
  return (
    <AppShell user={admin}>
      <h1 className="mb-4 text-xl font-semibold">Renewal message</h1>
      <Card className="max-w-lg">
        <CardHeader><CardTitle>Default renewal ask</CardTitle></CardHeader>
        <CardContent>
          <form action={updateRenewalMessageAction} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="subject">Subject</Label><Input id="subject" name="subject" defaultValue={message.subject} /></div>
            <div className="space-y-2"><Label htmlFor="body">Body</Label><Textarea id="body" name="body" rows={8} defaultValue={message.body} /></div>
            <p className="text-sm text-muted-foreground">Use {'{name}'} and {'{expiresAt}'} as placeholders.</p>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 4: Add the settings action**

Create `src/app/members/settings/actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { getDb } from '@/db';
import { updateRenewalMessage } from '@/lib/members/renewal-message';
import { requireMemberAdmin } from '@/lib/session';

export async function updateRenewalMessageAction(formData: FormData) {
  const admin = await requireMemberAdmin();
  await updateRenewalMessage(await getDb(), {
    subject: String(formData.get('subject') ?? '').trim(),
    body: String(formData.get('body') ?? '').trim(),
    updatedByUserId: admin.id,
  });
  revalidatePath('/members/settings');
  redirect('/members/settings');
}
```

- [ ] **Step 5: Run the full test suite and type-check**

Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual check**

Run: `npm run dev`. On `/members/import`, paste a two-row CSV and submit — confirm the results list shows `created` for both. On `/members/settings`, change the body text, save, reload — confirm it persisted. Back on `/members/[id]` for a member, confirm the "Send renewal ask" box is now pre-filled with the updated message.

- [ ] **Step 7: Commit**

```bash
git add src/app/members/import src/app/members/settings
git commit -m "Add CSV import and renewal message settings pages"
```

---

### Task 9: Stripe client & checkout session creation

**Files:**
- Create: `src/lib/stripe/client.ts`
- Create: `src/lib/stripe/checkout.ts`
- Create: `src/lib/stripe/checkout.test.ts`
- Modify: `package.json` (new dependency)
- Modify: `.env.example`

**Interfaces:**
- Produces: `getStripe(): Stripe`; `MembershipPlan = 'yearly' | 'monthly' | 'one_time'`; `CheckoutClient` (the minimal shape `createCheckoutSession` needs); `createCheckoutSession(stripe: CheckoutClient, input): Promise<string>`.

- [ ] **Step 1: Add the dependency**

Run: `npm install stripe`
Expected: `package.json` and `package-lock.json` gain a `stripe` entry.

- [ ] **Step 2: Add the Stripe client**

Create `src/lib/stripe/client.ts`:

```ts
import Stripe from 'stripe';

let stripeClient: Stripe | undefined;

/** Process-wide Stripe client, built from STRIPE_API_KEY (already in Fly secrets) on first use. */
export function getStripe(): Stripe {
  stripeClient ??= new Stripe(requireApiKey());
  return stripeClient;
}

function requireApiKey(): string {
  const key = process.env.STRIPE_API_KEY;
  if (!key) throw new Error('STRIPE_API_KEY is not set');
  return key;
}
```

- [ ] **Step 3: Write the failing test for checkout**

Create `src/lib/stripe/checkout.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { createCheckoutSession, type CheckoutClient } from './checkout';

describe('createCheckoutSession', () => {
  beforeEach(() => {
    process.env.STRIPE_PRICE_YEARLY = 'price_yearly';
    process.env.STRIPE_PRICE_MONTHLY = 'price_monthly';
    process.env.STRIPE_PRICE_ONE_TIME = 'price_one_time';
  });

  function fakeStripe(returnUrl: string | null = 'https://checkout.stripe.com/session123') {
    const calls: unknown[] = [];
    const stripe: CheckoutClient = {
      checkout: { sessions: { create: async (params) => { calls.push(params); return { url: returnUrl }; } } },
    };
    return { stripe, calls };
  }

  it('creates a subscription session for the yearly plan, keyed to the user', async () => {
    const { stripe, calls } = fakeStripe();
    const url = await createCheckoutSession(stripe, {
      plan: 'yearly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://members.alversjo.land',
    });
    expect(url).toBe('https://checkout.stripe.com/session123');
    expect(calls[0]).toMatchObject({
      mode: 'subscription', client_reference_id: 'u1', customer_email: 'a@example.org',
      line_items: [{ price: 'price_yearly', quantity: 1 }],
      success_url: 'https://members.alversjo.land/?checkout=success',
    });
  });

  it('creates a payment-mode session for the one-time plan', async () => {
    const { stripe, calls } = fakeStripe();
    await createCheckoutSession(stripe, {
      plan: 'one_time', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://x',
    });
    expect(calls[0]).toMatchObject({ mode: 'payment', line_items: [{ price: 'price_one_time', quantity: 1 }] });
  });

  it('uses the existing Stripe customer id instead of customer_email when present', async () => {
    const { stripe, calls } = fakeStripe();
    await createCheckoutSession(stripe, {
      plan: 'monthly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: 'cus_123' }, platformUrl: 'https://x',
    });
    expect(calls[0]).toMatchObject({ customer: 'cus_123', customer_email: undefined, line_items: [{ price: 'price_monthly', quantity: 1 }] });
  });

  it('throws if Stripe returns no checkout URL', async () => {
    const { stripe } = fakeStripe(null);
    await expect(createCheckoutSession(stripe, {
      plan: 'yearly', user: { id: 'u1', email: 'a@example.org', stripeCustomerId: null }, platformUrl: 'https://x',
    })).rejects.toThrow('did not return a checkout URL');
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run src/lib/stripe/checkout.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 5: Implement**

Create `src/lib/stripe/checkout.ts`:

```ts
import type Stripe from 'stripe';

export type MembershipPlan = 'yearly' | 'monthly' | 'one_time';

/** The minimal slice of the Stripe client createCheckoutSession needs — a real Stripe instance satisfies this structurally. */
export interface CheckoutClient {
  checkout: {
    sessions: {
      create(params: Stripe.Checkout.SessionCreateParams): Promise<{ url: string | null }>;
    };
  };
}

function priceFor(plan: MembershipPlan): string {
  const envKey = plan === 'yearly' ? 'STRIPE_PRICE_YEARLY' : plan === 'monthly' ? 'STRIPE_PRICE_MONTHLY' : 'STRIPE_PRICE_ONE_TIME';
  const price = process.env[envKey];
  if (!price) throw new Error(`${envKey} is not set`);
  return price;
}

export async function createCheckoutSession(
  stripe: CheckoutClient,
  input: { plan: MembershipPlan; user: { id: string; email: string; stripeCustomerId: string | null }; platformUrl: string },
): Promise<string> {
  const session = await stripe.checkout.sessions.create({
    mode: input.plan === 'one_time' ? 'payment' : 'subscription',
    customer: input.user.stripeCustomerId ?? undefined,
    customer_email: input.user.stripeCustomerId ? undefined : input.user.email,
    client_reference_id: input.user.id,
    line_items: [{ price: priceFor(input.plan), quantity: 1 }],
    success_url: `${input.platformUrl}/?checkout=success`,
    cancel_url: `${input.platformUrl}/?checkout=cancelled`,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return session.url;
}
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/stripe/checkout.test.ts`
Expected: PASS. If TypeScript complains about the `CheckoutClient`/`Stripe.Checkout.Session` shape not lining up with the installed `stripe` version, adjust `CheckoutClient`'s `create` return type to match (`Stripe.Response<Stripe.Checkout.Session>` is a superset of `{ url: string | null }` and should satisfy it structurally).

- [ ] **Step 7: Document the new env**

Add to `.env.example`, near the existing `RESEND_API_KEY` block:

```
# Stripe: STRIPE_API_KEY is already in Fly secrets. Price IDs are the one membership, sold three ways.
STRIPE_API_KEY=
STRIPE_PRICE_YEARLY=
STRIPE_PRICE_MONTHLY=
STRIPE_PRICE_ONE_TIME=
```

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/lib/stripe/client.ts src/lib/stripe/checkout.ts src/lib/stripe/checkout.test.ts .env.example
git commit -m "Add Stripe client and Checkout session creation for the three membership plans"
```

---

### Task 10: Stripe webhook handler

**Files:**
- Create: `src/lib/stripe/webhook.ts`
- Create: `src/lib/stripe/webhook.test.ts`

**Interfaces:**
- Consumes: `Db`, `schema` (`@/db`).
- Produces: `handleStripeEvent(db: Db, event: Stripe.Event): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/stripe/webhook.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import type Stripe from 'stripe';
import { eq } from 'drizzle-orm';
import { createDb, schema, type Db } from '@/db';
import { handleStripeEvent } from './webhook';

function event<T>(type: string, object: T): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event;
}

describe('handleStripeEvent', () => {
  let db: Db;

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    await db.insert(schema.user).values({ id: 'u1', email: 'a@example.org' });
  });

  it('activates membership and stores the subscription id on a subscription checkout', async () => {
    await handleStripeEvent(db, event('checkout.session.completed', {
      mode: 'subscription', client_reference_id: 'u1', customer: 'cus_1', subscription: 'sub_1',
    }));
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u).toMatchObject({ isActiveMember: true, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
  });

  it('extends membershipExpiresAt by one year from now on a one-time payment', async () => {
    await handleStripeEvent(db, event('checkout.session.completed', { mode: 'payment', client_reference_id: 'u1', customer: 'cus_1' }));
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u.isActiveMember).toBe(true);
    expect(u.membershipExpiresAt!.getUTCFullYear()).toBe(new Date().getUTCFullYear() + 1);
  });

  it('extends membershipExpiresAt from the current expiry, not from now, when renewing early', async () => {
    const future = new Date(); future.setUTCMonth(future.getUTCMonth() + 6);
    await db.update(schema.user).set({ membershipExpiresAt: future, isActiveMember: true }).where(eq(schema.user.id, 'u1'));
    await handleStripeEvent(db, event('checkout.session.completed', { mode: 'payment', client_reference_id: 'u1', customer: 'cus_1' }));
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u.membershipExpiresAt!.getUTCFullYear()).toBe(future.getUTCFullYear() + 1);
    expect(u.membershipExpiresAt!.getUTCMonth()).toBe(future.getUTCMonth());
  });

  it('syncs membershipExpiresAt on subscription.updated', async () => {
    await db.update(schema.user).set({ stripeCustomerId: 'cus_1' }).where(eq(schema.user.id, 'u1'));
    const periodEnd = Math.floor(new Date('2027-06-01').getTime() / 1000);
    await handleStripeEvent(db, event('customer.subscription.updated', { customer: 'cus_1', items: { data: [{ current_period_end: periodEnd }] } }));
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u.membershipExpiresAt).toEqual(new Date(periodEnd * 1000));
  });

  it('clears stripeSubscriptionId on subscription.deleted', async () => {
    await db.update(schema.user).set({ stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' }).where(eq(schema.user.id, 'u1'));
    await handleStripeEvent(db, event('customer.subscription.deleted', { customer: 'cus_1' }));
    const [u] = await db.select().from(schema.user).where(eq(schema.user.id, 'u1'));
    expect(u.stripeSubscriptionId).toBeNull();
  });

  it('does not throw for a checkout session whose client_reference_id matches no user', async () => {
    await expect(
      handleStripeEvent(db, event('checkout.session.completed', { mode: 'payment', client_reference_id: 'nobody', customer: 'cus_x' })),
    ).resolves.toBeUndefined();
  });

  it('does not throw for a subscription event whose customer matches no user', async () => {
    await expect(
      handleStripeEvent(db, event('customer.subscription.updated', { customer: 'cus_nobody', items: { data: [{ current_period_end: 0 }] } })),
    ).resolves.toBeUndefined();
  });

  it('ignores event types it does not handle', async () => {
    await expect(handleStripeEvent(db, event('payment_intent.succeeded', {}))).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/stripe/webhook.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/stripe/webhook.ts`:

```ts
import { eq } from 'drizzle-orm';
import type Stripe from 'stripe';
import { schema, type Db } from '@/db';
import type { User } from '@/db/schema';

function addYears(date: Date, years: number): Date {
  const d = new Date(date);
  d.setUTCFullYear(d.getUTCFullYear() + years);
  return d;
}

function customerIdOf(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id;
}

async function findByClientReferenceId(db: Db, id: string | null): Promise<User | undefined> {
  if (!id) return undefined;
  const [row] = await db.select().from(schema.user).where(eq(schema.user.id, id));
  return row;
}

async function findByStripeCustomerId(db: Db, customerId: string | null): Promise<User | undefined> {
  if (!customerId) return undefined;
  const [row] = await db.select().from(schema.user).where(eq(schema.user.stripeCustomerId, customerId));
  return row;
}

async function handleCheckoutCompleted(db: Db, session: Stripe.Checkout.Session): Promise<void> {
  const user = await findByClientReferenceId(db, session.client_reference_id);
  if (!user) { console.error(`Stripe webhook: no user for client_reference_id ${session.client_reference_id}`); return; }
  const customerId = customerIdOf(session.customer) ?? user.stripeCustomerId;

  if (session.mode === 'subscription') {
    const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id ?? null;
    // current_period_end isn't on the checkout session itself; the subscription.updated event
    // that follows moments later fills in the real expiry. Marking active now avoids a window
    // where a slow webhook ordering would otherwise lock the member out.
    await db.update(schema.user)
      .set({ stripeCustomerId: customerId, stripeSubscriptionId: subscriptionId, isActiveMember: true })
      .where(eq(schema.user.id, user.id));
    return;
  }

  const base = user.membershipExpiresAt && user.membershipExpiresAt > new Date() ? user.membershipExpiresAt : new Date();
  await db.update(schema.user)
    .set({ stripeCustomerId: customerId, isActiveMember: true, membershipExpiresAt: addYears(base, 1) })
    .where(eq(schema.user.id, user.id));
}

async function handleSubscriptionUpdated(db: Db, subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(subscription.customer);
  const user = await findByStripeCustomerId(db, customerId);
  if (!user) { console.error(`Stripe webhook: no user for customer ${customerId}`); return; }
  // Stripe moved current_period_end from the subscription itself to each subscription item.
  const periodEndSec = subscription.items.data[0]?.current_period_end;
  if (periodEndSec === undefined) { console.error(`Stripe webhook: subscription ${subscription.id} has no current_period_end`); return; }
  await db.update(schema.user)
    .set({ membershipExpiresAt: new Date(periodEndSec * 1000), isActiveMember: true })
    .where(eq(schema.user.id, user.id));
}

async function handleSubscriptionDeleted(db: Db, subscription: Stripe.Subscription): Promise<void> {
  const customerId = customerIdOf(subscription.customer);
  const user = await findByStripeCustomerId(db, customerId);
  if (!user) { console.error(`Stripe webhook: no user for customer ${customerId}`); return; }
  await db.update(schema.user).set({ stripeSubscriptionId: null }).where(eq(schema.user.id, user.id));
}

export async function handleStripeEvent(db: Db, event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(db, event.data.object as Stripe.Checkout.Session);
    case 'customer.subscription.updated':
      return handleSubscriptionUpdated(db, event.data.object as Stripe.Subscription);
    case 'customer.subscription.deleted':
      return handleSubscriptionDeleted(db, event.data.object as Stripe.Subscription);
    default:
      return;
  }
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/stripe/webhook.test.ts`
Expected: PASS. If `npx tsc --noEmit` (Task 13's final check) flags `subscription.items` as missing on the installed `stripe` version's `Stripe.Subscription` type, fall back to `subscription.current_period_end` directly and drop the per-item lookup.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stripe/webhook.ts src/lib/stripe/webhook.test.ts
git commit -m "Add Stripe webhook handling for checkout completion and subscription lifecycle"
```

---

### Task 11: Stripe webhook route

**Files:**
- Create: `src/app/api/webhooks/stripe/route.ts`
- Create: `src/app/api/webhooks/stripe/route.test.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `getStripe` (Task 9), `handleStripeEvent` (Task 10), `getDb` (`@/db`).

- [ ] **Step 1: Write the failing test**

Create `src/app/api/webhooks/stripe/route.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import Stripe from 'stripe';
import { createDb, type Db } from '@/db';

let db: Db;
vi.mock('@/db', async (orig) => ({ ...(await orig<typeof import('@/db')>()), getDb: async () => db }));

import { POST } from './route';

describe('POST /api/webhooks/stripe', () => {
  const secret = 'whsec_test_secret';

  beforeEach(async () => {
    db = await createDb('pglite://memory');
    process.env.STRIPE_API_KEY = 'sk_test_dummy';
    process.env.STRIPE_WEBHOOK_SECRET = secret;
  });

  function signedRequest(payloadObj: unknown): Request {
    const payload = JSON.stringify(payloadObj);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    return new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST', body: payload, headers: { 'stripe-signature': header },
    });
  }

  it('rejects a request with a bad signature', async () => {
    const req = new Request('http://localhost/api/webhooks/stripe', {
      method: 'POST', body: '{}', headers: { 'stripe-signature': 'bad' },
    });
    expect((await POST(req)).status).toBe(400);
  });

  it('rejects a request with no signature header at all', async () => {
    const req = new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' });
    expect((await POST(req)).status).toBe(400);
  });

  it('accepts a correctly signed event it does not otherwise act on', async () => {
    const req = signedRequest({ id: 'evt_1', type: 'payment_intent.succeeded', data: { object: {} } });
    expect((await POST(req)).status).toBe(200);
  });
});
```

Add `vi` to the Vitest import at the top (`import { beforeEach, describe, expect, it, vi } from 'vitest';`).

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/api/webhooks/stripe/route.test.ts`
Expected: FAIL — module `./route` does not exist.

- [ ] **Step 3: Implement**

Create `src/app/api/webhooks/stripe/route.ts`:

```ts
import { getDb } from '@/db';
import { getStripe } from '@/lib/stripe/client';
import { handleStripeEvent } from '@/lib/stripe/webhook';

export async function POST(request: Request): Promise<Response> {
  const signature = request.headers.get('stripe-signature');
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!signature || !secret) return new Response('missing signature', { status: 400 });

  const body = await request.text();
  let event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    return new Response(`invalid signature: ${(err as Error).message}`, { status: 400 });
  }

  await handleStripeEvent(await getDb(), event);
  return Response.json({ received: true });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/api/webhooks/stripe/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Document the webhook secret**

Add to `.env.example`, next to the Stripe block from Task 9:

```
STRIPE_WEBHOOK_SECRET=
```

Add a line to `README.md`'s "Secrets" paragraph, alongside the existing list (`DATABASE_URL`, `BETTER_AUTH_SECRET`, ...): append `STRIPE_API_KEY`, `STRIPE_WEBHOOK_SECRET` to the secrets list, and a short note that `STRIPE_PRICE_YEARLY`, `STRIPE_PRICE_MONTHLY`, `STRIPE_PRICE_ONE_TIME` are non-secret config alongside `PLATFORM_URL` etc.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/webhooks/stripe .env.example README.md
git commit -m "Add the Stripe webhook route, verifying signatures before touching the database"
```

---

### Task 12: Member homepage

**Files:**
- Modify: `src/app/page.tsx`
- Create: `src/app/actions.ts`
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `requireUser` (Task 2); `needsPayment`, `isActiveNow` (Task 3); `updateOwnProfile`, `MembershipExpiredError`, `InvalidPhoneError` (Task 3); `createCheckoutSession`, `MembershipPlan` (Task 9); `getStripe` (Task 9).

- [ ] **Step 1: Replace the homepage**

Replace `src/app/page.tsx`:

```tsx
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isActiveNow, needsPayment } from '@/lib/members/status';
import { requireUser } from '@/lib/session';
import { startCheckoutAction, updateProfileAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string; checkout?: string }> }) {
  const sessionUser = await requireUser();
  const { error, checkout } = await searchParams;
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, sessionUser.id));
  const active = isActiveNow(member);

  return (
    <AppShell user={sessionUser}>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      {checkout === 'cancelled' && <Alert className="mb-4"><AlertDescription>Checkout was cancelled.</AlertDescription></Alert>}
      <Card className="mb-4 max-w-md">
        <CardHeader><CardTitle>Membership</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p>
            {active
              ? `Member until ${member.membershipExpiresAt!.toISOString().slice(0, 10)}`
              : member.membershipExpiresAt
                ? `Membership expired on ${member.membershipExpiresAt.toISOString().slice(0, 10)}`
                : 'You are not yet a member.'}
          </p>
          {needsPayment(member) && (
            <div className="flex flex-wrap gap-2">
              <form action={startCheckoutAction}>
                <input type="hidden" name="plan" value="yearly" />
                <Button type="submit">Pay yearly</Button>
              </form>
              <form action={startCheckoutAction}>
                <input type="hidden" name="plan" value="monthly" />
                <Button type="submit" variant="outline">Pay monthly</Button>
              </form>
              <form action={startCheckoutAction}>
                <input type="hidden" name="plan" value="one_time" />
                <Button type="submit" variant="outline">Pay one year (one-time)</Button>
              </form>
            </div>
          )}
        </CardContent>
      </Card>
      {active && (
        <Card className="max-w-md">
          <CardHeader><CardTitle>Your profile</CardTitle></CardHeader>
          <CardContent>
            <form action={updateProfileAction} className="space-y-4">
              <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={member.name} /></div>
              <div className="space-y-2"><Label htmlFor="nickname">Nickname</Label><Input id="nickname" name="nickname" defaultValue={member.nickname ?? ''} /></div>
              <div className="space-y-2"><Label htmlFor="phoneNumber">Phone number</Label><Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={member.phoneNumber ?? ''} /></div>
              <div className="space-y-2"><Label htmlFor="discordHandle">Discord handle</Label><Input id="discordHandle" name="discordHandle" defaultValue={member.discordHandle ?? ''} /></div>
              <Button type="submit">Save</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </AppShell>
  );
}
```

- [ ] **Step 2: Add the homepage server actions**

Create `src/app/actions.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import { InvalidPhoneError, MembershipExpiredError, updateOwnProfile } from '@/lib/members/service';
import { requireUser } from '@/lib/session';
import { createCheckoutSession, type MembershipPlan } from '@/lib/stripe/checkout';
import { getStripe } from '@/lib/stripe/client';

export async function updateProfileAction(formData: FormData) {
  const user = await requireUser();
  const phoneRaw = String(formData.get('phoneNumber') ?? '').trim();
  try {
    await updateOwnProfile(await getDb(), {
      id: user.id,
      name: String(formData.get('name') ?? '').trim(),
      nickname: String(formData.get('nickname') ?? '').trim() || null,
      phoneNumber: phoneRaw === '' ? null : phoneRaw,
      discordHandle: String(formData.get('discordHandle') ?? '').trim() || null,
    });
  } catch (e) {
    if (e instanceof InvalidPhoneError || e instanceof MembershipExpiredError) {
      redirect(`/?error=${encodeURIComponent(e.message)}`);
    }
    throw e;
  }
  redirect('/');
}

export async function startCheckoutAction(formData: FormData) {
  const sessionUser = await requireUser();
  const plan = String(formData.get('plan')) as MembershipPlan;
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, sessionUser.id));
  const platformUrl = process.env.PLATFORM_URL ?? 'http://localhost:3000';
  const url = await createCheckoutSession(getStripe(), { plan, user: member, platformUrl });
  redirect(url);
}
```

- [ ] **Step 3: Point the login redirect at the new homepage**

In `src/app/login/page.tsx`, change both occurrences of `/boxes` to `/`:

```ts
    router.push('/');
```

(There is one occurrence, in `verify()`.)

- [ ] **Step 4: Run the full test suite, lint, type-check and build**

Run: `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`
Expected: all PASS.

- [ ] **Step 5: Manual check**

Run: `npm run dev`. Log in as a brand-new email — land on `/`, see "You are not yet a member" and three payment buttons, no profile form. Click "Pay yearly" — without real `STRIPE_API_KEY`/price IDs set in dev this will throw; set dummy `STRIPE_API_KEY`/price env vars pointing at a Stripe test-mode account to exercise the redirect to Stripe's hosted Checkout end-to-end, or stop at confirming the button posts to `startCheckoutAction` and surfaces the "STRIPE_API_KEY is not set" error cleanly if unset. Separately, as the `ADMIN_EMAILS` admin (who is seeded active via the directory in Task 6's manual check), confirm the profile form appears and saving it round-trips.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/actions.ts src/app/login/page.tsx
git commit -m "Replace the box-list homepage with the member dashboard: status, payment, profile"
```

---

## After all tasks

Run the whole suite once more (`npx vitest run`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run db:check`) and open a PR per `CLAUDE.md` — never push to `main` directly.
