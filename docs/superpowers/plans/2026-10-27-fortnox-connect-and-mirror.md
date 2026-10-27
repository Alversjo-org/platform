# Fortnox connect and read-only mirror Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a treasurer connect Alversjö's Fortnox account once, and keep a read-only mirror of its accounts, cost centres, Fortnox projects, financial years, vouchers and voucher rows up to date automatically, surviving the service account's rotating 45-day refresh token indefinitely without further human action.

**Architecture:** A `FortnoxClient` interface (OAuth + the handful of read endpoints needed) is dependency-injected into two service modules — `connection-service.ts` (token lifecycle: refresh-with-locking, connect/disconnect) and `sync-service.ts` (upserting Fortnox data into the `fx_*` mirror tables) — the same shape this codebase already uses for Stripe (`syncMembersFromStripe(db, stripe)`), so both are unit-tested against a fake client with no real network calls. A treasurer-only page drives the one-time OAuth consent and a manual "run first import" action; a nightly cron route (mirroring the existing `stripe-sync` route) re-reads recent vouchers.

**Tech Stack:** Next.js 16 App Router, Drizzle on Postgres/PGlite, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-27-budget-tracking-fortnox-sync-design.md` §2, §4.1, §5 (this plan covers those sections only — project groups, budgets and classification are a separate later plan per that doc's own scope split).

## Global Constraints

- Amounts are whole öre as integers, `_sek`-suffixed, never floats (existing platform-wide convention).
- Fortnox: 300 requests/minute per client+tenant, enforced as 25 per 5 seconds; back off on HTTP 429. Every outgoing Fortnox call goes through the one rate-limited client — no ad hoc `fetch`.
- OAuth service-account flow (`account_type=service`): 1-hour access token, 45-day single-use refresh token that **rotates on every refresh** (old one invalidated the instant a new one is issued).
- Access/refresh tokens and their expiry live in the database (`fortnoxConnection`), never in a Fly secret — only `FORTNOX_CLIENT_ID`/`FORTNOX_CLIENT_SECRET` (the app's own, unchanging credentials) go in Fly secrets, loaded via `process.env`.
- Read, don't write, by default: the only Fortnox writes in this slice are the OAuth token exchange and refresh calls themselves.
- Removed/struck voucher rows (Fortnox "Ändra") are kept with `removed = true`, never deleted, and excluded from any total.
- Sync is nightly-only this slice — no WebSocket worker (decided in the spec; `fx_sync_state.lastWebsocketOffset` exists so adding one later is additive).
- `drizzle-kit generate` output is committed under `drizzle/` in the same commit as the `src/db/schema.ts` change (CI's `db:check` gate fails a PR where they diverge).

## Review Focus

- Two callers (a treasurer loading the connection page, and the nightly cron route) needing a token refresh at the same moment must not race on the single-use refresh token and corrupt or kill the connection. → Task 5.
- Fortnox responding HTTP 429 partway through a sync must back off and retry, not abort and lose the partial import. → Task 4.
- The OAuth callback arriving with no `code` (the admin cancelled consent, or Fortnox sent `?error=`) must show a clear retry path, not throw. → Task 8.
- A previously-synced voucher edited in Fortnox via **Ändra** (a row struck, a new one appended) must update the existing row's `removed` flag and add the new row on re-sync, not duplicate or silently keep stale data. → Task 6.
- Re-running the first import (e.g. after a partial failure) must be idempotent — safe to run twice without duplicate rows or doubled totals. → Task 6.

---

## File structure

- `src/db/schema.ts` — modify: add `'treasurer'` to `Role`, `fortnoxConnection`, `fxFinancialYear`, `fxAccount`, `fxCostCentre`, `fxProject`, `fxVoucher`, `fxVoucherRow`, `fxSyncState`.
- `src/lib/session.ts`, `src/lib/roles/labels.ts` — modify: wire up the `treasurer` role.
- `src/lib/fortnox/rate-limiter.ts` — create: the 25-per-5-seconds token bucket, clock-injectable.
- `src/lib/fortnox/client.ts` — create: `FortnoxClient` interface + `createFortnoxClient()`, the real implementation (OAuth + the read endpoints), using the rate limiter and backing off on 429.
- `src/lib/fortnox/connection-service.ts` — create: token lifecycle (`getValidAccessToken`, `startConnect`, `completeConnect`, `disconnect`) against `fortnoxConnection`.
- `src/lib/fortnox/sync-service.ts` — create: `syncReferenceData`, `syncVouchersForYear`, `runFirstImport` against the `fx_*` tables.
- `src/app/api/cron/fortnox-sync/route.ts` — create: nightly re-read, mirrors `src/app/api/cron/stripe-sync/route.ts`.
- `src/app/api/fortnox/callback/route.ts` — create: OAuth redirect target.
- `src/app/fortnox/page.tsx`, `src/app/fortnox/actions.ts` — create: treasurer-only connection status page, connect/reconnect, run-first-import.
- `.env.example` — modify: add `FORTNOX_CLIENT_ID`, `FORTNOX_CLIENT_SECRET`, `FORTNOX_REDIRECT_URI`.

---

### Task 1: Schema — `treasurer` role, Fortnox connection, `fx_*` mirror tables

**Files:**
- Modify: `src/db/schema.ts`
- Create: `drizzle/<generated>.sql` (via `drizzle-kit generate`)

**Interfaces:**
- Produces: `fortnoxConnection`, `fxFinancialYear`, `fxAccount`, `fxCostCentre`, `fxProject`, `fxVoucher`, `fxVoucherRow`, `fxSyncState` tables and their inferred row types (`typeof schema.fortnoxConnection.$inferSelect`, etc. via Drizzle), consumed by every later task. `Role` gains `'treasurer'`.

- [ ] **Step 1: Add the schema additions**

```ts
export type Role = 'admin' | 'member-admin' | 'mapper' | 'role-admin' | 'treasurer';

export type FortnoxConnectionStatus = 'connected' | 'needs_reauth' | 'disconnected';

export const fortnoxConnection = pgTable('fortnox_connection', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['connected', 'needs_reauth', 'disconnected'] }).$type<FortnoxConnectionStatus>().notNull().default('disconnected'),
  accessToken: text('access_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshToken: text('refresh_token'),
  scope: text('scope'),
  connectedByUserId: text('connected_by_user_id').references(() => user.id),
  connectedAt: timestamp('connected_at'),
  lastRefreshedAt: timestamp('last_refreshed_at'),
  lastRefreshError: text('last_refresh_error'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const fxFinancialYear = pgTable('fx_financial_year', {
  id: text('id').primaryKey(),
  fortnoxId: integer('fortnox_id').notNull().unique(),
  fromDate: text('from_date').notNull(), // ISO date (YYYY-MM-DD), stored as text like Fortnox returns it
  toDate: text('to_date').notNull(),
  lockedUntilDate: text('locked_until_date'),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
});

export const fxAccount = pgTable('fx_account', {
  id: text('id').primaryKey(),
  year: integer('year').notNull(),
  number: integer('number').notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => [index('fx_account_year_number_idx').on(t.year, t.number)]);

export const fxCostCentre = pgTable('fx_cost_centre', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
});

export const fxProject = pgTable('fx_project', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
});

export const fxVoucher = pgTable('fx_voucher', {
  id: text('id').primaryKey(),
  year: integer('year').notNull(),
  series: text('series').notNull(),
  number: integer('number').notNull(),
  date: text('date').notNull(),
  description: text('description').notNull().default(''),
  referenceType: text('reference_type'),
  referenceNumber: text('reference_number'),
  comments: text('comments'),
  hasAttachment: boolean('has_attachment').notNull().default(false),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => [index('fx_voucher_key_idx').on(t.year, t.series, t.number)]);

export const fxVoucherRow = pgTable('fx_voucher_row', {
  id: text('id').primaryKey(),
  voucherId: text('voucher_id').notNull().references(() => fxVoucher.id, { onDelete: 'cascade' }),
  rowIndex: integer('row_index').notNull(),
  account: integer('account').notNull(),
  debitSek: integer('debit_sek').notNull().default(0),
  creditSek: integer('credit_sek').notNull().default(0),
  costCentreCode: text('cost_centre_code').references(() => fxCostCentre.code),
  fxProjectCode: text('fx_project_code').references(() => fxProject.code),
  transactionInfo: text('transaction_info'),
  removed: boolean('removed').notNull().default(false),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => [index('fx_voucher_row_voucher_idx').on(t.voucherId, t.rowIndex)]);

export const fxSyncState = pgTable('fx_sync_state', {
  topic: text('topic').primaryKey(),
  lastWebsocketOffset: text('last_websocket_offset'),
  lastFullSyncAt: timestamp('last_full_sync_at'),
});
```

`fx_voucher`/`fx_voucher_row`'s natural Fortnox key is kept as a plain index (used for lookups), not a DB-enforced unique constraint — uniqueness is enforced in application code at upsert time (Task 6 reads-then-writes inside a transaction), matching how `syncMembersFromStripe` upserts by `stripeCustomerId` today without a DB constraint doing the deduplication.

- [ ] **Step 2: Generate the migration**

Run: `npx drizzle-kit generate`

- [ ] **Step 3: Verify schema and migration agree**

Run: `npm run db:check`
Expected: passes with no diff.

- [ ] **Step 4: Commit**

```bash
git add src/db/schema.ts drizzle/
git commit -m "feat: add fortnox_connection and fx_* mirror tables, treasurer role"
```

---

### Task 2: `treasurer` role wiring

**Files:**
- Modify: `src/lib/session.ts`, `src/lib/roles/labels.ts`
- Test: `src/lib/session.test.ts`

**Interfaces:**
- Consumes: `Role` from Task 1.
- Produces: `TREASURER_ROLES: Role[]`, `requireTreasurer(): Promise<SessionUser>`, `isTreasurer(user: { roles: Role[] }): boolean` — later tasks' route/action code gates on `requireTreasurer()`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('isTreasurer', () => {
  it('is true for admin and treasurer, false for mapper or no roles', () => {
    expect(isTreasurer({ roles: ['admin'] })).toBe(true);
    expect(isTreasurer({ roles: ['treasurer'] })).toBe(true);
    expect(isTreasurer({ roles: ['mapper'] })).toBe(false);
    expect(isTreasurer({ roles: [] })).toBe(false);
  });
});
```

Add `TREASURER_ROLES` to the existing `'each wrapper admits exactly the roles it is supposed to'` test (`expect(TREASURER_ROLES).toEqual(['admin', 'treasurer'])`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/session.test.ts`
Expected: FAIL — `isTreasurer`/`TREASURER_ROLES` not defined.

- [ ] **Step 3: Implement**

In `src/lib/session.ts`: `export const TREASURER_ROLES: Role[] = ['admin', 'treasurer'];`, `export function isTreasurer(user: { roles: Role[] }): boolean { return hasAnyRole(user, TREASURER_ROLES); }`, `export const requireTreasurer = () => requireAnyRole(TREASURER_ROLES);`.

In `src/lib/roles/labels.ts`: add `'treasurer'` to `GRANTABLE_ROLES`, and `treasurer: 'Treasurer'` to `ROLE_LABELS`. (Not added to `ADMIN_ONLY_ROLES` — a `role-admin` can grant it, same as `mapper`.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/session.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts src/lib/session.test.ts src/lib/roles/labels.ts
git commit -m "feat: add treasurer role"
```

---

### Task 3: Rate limiter

**Files:**
- Create: `src/lib/fortnox/rate-limiter.ts`
- Test: `src/lib/fortnox/rate-limiter.test.ts`

**Interfaces:**
- Produces: `createRateLimiter(opts?: { maxCalls?: number; windowMs?: number; now?: () => number }): { acquire(): Promise<void> }` — Task 4 calls `await limiter.acquire()` before every Fortnox HTTP call.

- [ ] **Step 1: Write the failing tests**

```ts
it('allows calls up to the limit without delay', async () => {
  const limiter = createRateLimiter({ maxCalls: 25, windowMs: 5000 });
  const start = Date.now();
  for (let i = 0; i < 25; i++) await limiter.acquire();
  expect(Date.now() - start).toBeLessThan(50);
});

it('delays the 26th call until the window has room', async () => {
  vi.useFakeTimers();
  const limiter = createRateLimiter({ maxCalls: 2, windowMs: 1000 });
  await limiter.acquire();
  await limiter.acquire();
  const third = limiter.acquire();
  let resolved = false;
  third.then(() => { resolved = true; });
  await vi.advanceTimersByTimeAsync(999);
  expect(resolved).toBe(false);
  await vi.advanceTimersByTimeAsync(2);
  expect(resolved).toBe(true);
  vi.useRealTimers();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/fortnox/rate-limiter.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createRateLimiter`**

A sliding-window token bucket: track call timestamps in the last `windowMs`; if at `maxCalls`, `await` until the oldest timestamp falls out of the window before resolving. Defaults: `maxCalls: 25`, `windowMs: 5000` (the spec's "25 per 5 seconds").

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/fortnox/rate-limiter.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fortnox/rate-limiter.ts src/lib/fortnox/rate-limiter.test.ts
git commit -m "feat: add fortnox rate limiter"
```

---

### Task 4: Fortnox API client

**Files:**
- Create: `src/lib/fortnox/client.ts`
- Test: `src/lib/fortnox/client.test.ts`

**Interfaces:**
- Consumes: `createRateLimiter` from Task 3.
- Produces (consumed by Tasks 5, 6, 8):

```ts
export type FortnoxTokens = { accessToken: string; refreshToken: string; expiresAt: Date; scope: string };
export type FxFinancialYearData = { fortnoxId: number; fromDate: string; toDate: string; lockedUntilDate: string | null };
export type FxAccountData = { year: number; number: number; name: string; active: boolean };
export type FxCostCentreData = { code: string; name: string; active: boolean };
export type FxProjectData = { code: string; name: string; active: boolean };
export type FxVoucherRowData = { rowIndex: number; account: number; debitSek: number; creditSek: number; costCentreCode: string | null; fxProjectCode: string | null; transactionInfo: string | null; removed: boolean };
export type FxVoucherData = { year: number; series: string; number: number; date: string; description: string; referenceType: string | null; referenceNumber: string | null; comments: string | null; hasAttachment: boolean; rows: FxVoucherRowData[] };

export interface FortnoxClient {
  getAuthorizationUrl(state: string): string;
  exchangeCode(code: string): Promise<FortnoxTokens>;
  refreshTokens(refreshToken: string): Promise<FortnoxTokens>;
  getFinancialYears(accessToken: string): Promise<FxFinancialYearData[]>;
  getAccounts(accessToken: string, year: number): Promise<FxAccountData[]>;
  getCostCentres(accessToken: string): Promise<FxCostCentreData[]>;
  getFxProjects(accessToken: string): Promise<FxProjectData[]>;
  listVoucherKeys(accessToken: string, financialYear: number): Promise<{ series: string; number: number }[]>;
  getVoucher(accessToken: string, financialYear: number, series: string, number: number): Promise<FxVoucherData>;
}

export function createFortnoxClient(fetchImpl?: typeof fetch): FortnoxClient;
```

`createFortnoxClient` reads `FORTNOX_CLIENT_ID`, `FORTNOX_CLIENT_SECRET`, `FORTNOX_REDIRECT_URI` from `process.env` (throws if unset, same pattern as `requireApiKey()` in `src/lib/stripe/client.ts`). `fetchImpl` defaults to the global `fetch` and exists so tests can inject a fake — same reason `syncMembersFromStripe` takes an injected `SyncClient` instead of the real Stripe SDK.

- [ ] **Step 1: Write the failing tests**

```ts
it('builds the authorization URL with the service-account scopes', () => {
  process.env.FORTNOX_CLIENT_ID = 'cid';
  process.env.FORTNOX_REDIRECT_URI = 'https://platform.alversjo.land/api/fortnox/callback';
  const client = createFortnoxClient();
  const url = new URL(client.getAuthorizationUrl('state123'));
  expect(url.searchParams.get('client_id')).toBe('cid');
  expect(url.searchParams.get('account_type')).toBe('service');
  expect(url.searchParams.get('state')).toBe('state123');
  expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(
    ['archive', 'bookkeeping', 'companyinformation', 'connectfile', 'costcenter', 'inbox', 'payment', 'project', 'settings', 'supplier', 'supplierinvoice'].sort(),
  );
});

it('retries once on HTTP 429 and succeeds', async () => {
  let calls = 0;
  const fakeFetch = (async (_url: string) => {
    calls++;
    if (calls === 1) return new Response('', { status: 429, headers: { 'Retry-After': '0' } });
    return new Response(JSON.stringify({ FinancialYears: [] }), { status: 200 });
  }) as typeof fetch;
  const client = createFortnoxClient(fakeFetch);
  await client.getFinancialYears('token');
  expect(calls).toBe(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/fortnox/client.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `createFortnoxClient`**

Authorization URL: `https://apps.fortnox.se/oauth-v1/auth` with `client_id`, `redirect_uri`, `response_type=code`, `account_type=service`, `state`, and `scope` = the space-joined list `bookkeeping project costcenter supplierinvoice supplier payment settings inbox archive connectfile companyinformation`. Token exchange/refresh: `POST https://apps.fortnox.se/oauth-v1/token` per Fortnox's documented grant types (`authorization_code` / `refresh_token`), returning `{accessToken, refreshToken, expiresAt: new Date(Date.now() + expires_in * 1000), scope}`. Every other method calls `limiter.acquire()` (one shared `createRateLimiter()` instance per client) then `fetchImpl` against `https://api.fortnox.se/3/...` with `Authorization: Bearer <accessToken>`; on a 429 response, wait the `Retry-After` header (seconds) or 1s if absent, then retry once more before throwing. `listVoucherKeys`/`getVoucher` page through Fortnox's voucher endpoints per the spec's reference doc (`/vouchers?financialyear=`, `/vouchers/{series}/{number}?financialyear=`); pagination is internal to the client, callers always get a complete array.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/fortnox/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fortnox/client.ts src/lib/fortnox/client.test.ts
git commit -m "feat: add fortnox api client"
```

---

### Task 5: Connection service (token lifecycle, refresh locking)

**Files:**
- Create: `src/lib/fortnox/connection-service.ts`
- Test: `src/lib/fortnox/connection-service.test.ts`

**Interfaces:**
- Consumes: `FortnoxClient`, `FortnoxTokens` (Task 4); `schema.fortnoxConnection` (Task 1).
- Produces (consumed by Tasks 6, 7, 8):

```ts
export function startConnect(client: FortnoxClient, state: string): string; // returns the authorization URL
export async function completeConnect(db: Db, client: FortnoxClient, input: { code: string; userId: string }): Promise<void>;
export async function disconnect(db: Db): Promise<void>;
export async function getConnection(db: Db): Promise<typeof schema.fortnoxConnection.$inferSelect | null>; // most recent row by connectedAt/updatedAt
export class NeedsReauthError extends Error {}
export async function getValidAccessToken(db: Db, client: FortnoxClient): Promise<string>; // throws NeedsReauthError if status is needs_reauth or disconnected
```

- [ ] **Step 1: Write the failing tests**

```ts
function fakeClient(overrides: Partial<FortnoxClient> = {}): FortnoxClient {
  return {
    getAuthorizationUrl: (state) => `https://apps.fortnox.se/oauth-v1/auth?state=${state}`,
    exchangeCode: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 3600_000), scope: 'bookkeeping' }),
    refreshTokens: async () => ({ accessToken: 'at2', refreshToken: 'rt2', expiresAt: new Date(Date.now() + 3600_000), scope: 'bookkeeping' }),
    getFinancialYears: async () => [], getAccounts: async () => [], getCostCentres: async () => [], getFxProjects: async () => [],
    listVoucherKeys: async () => [], getVoucher: async () => { throw new Error('not used'); },
    ...overrides,
  };
}

it('completeConnect stores the exchanged tokens as connected', async () => {
  const db = await createDb('pglite://memory');
  await completeConnect(db, fakeClient(), { code: 'abc', userId: 'u1' });
  const conn = await getConnection(db);
  expect(conn).toMatchObject({ status: 'connected', accessToken: 'at1', refreshToken: 'rt1', connectedByUserId: 'u1' });
});

it('getValidAccessToken returns the stored token when not near expiry', async () => {
  const db = await createDb('pglite://memory');
  const client = fakeClient();
  await completeConnect(db, client, { code: 'abc', userId: 'u1' });
  const refreshSpy = vi.spyOn(client, 'refreshTokens');
  const token = await getValidAccessToken(db, client);
  expect(token).toBe('at1');
  expect(refreshSpy).not.toHaveBeenCalled();
});

it('getValidAccessToken refreshes and persists when near expiry', async () => {
  const db = await createDb('pglite://memory');
  const client = fakeClient({ exchangeCode: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 60_000), scope: 'bookkeeping' }) });
  await completeConnect(db, client, { code: 'abc', userId: 'u1' });
  const token = await getValidAccessToken(db, client);
  expect(token).toBe('at2');
  const conn = await getConnection(db);
  expect(conn).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2' });
});

it('two concurrent near-expiry calls only refresh once', async () => {
  const db = await createDb('pglite://memory');
  let refreshCalls = 0;
  const client = fakeClient({
    exchangeCode: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 60_000), scope: 'bookkeeping' }),
    refreshTokens: async () => { refreshCalls++; return { accessToken: 'at2', refreshToken: 'rt2', expiresAt: new Date(Date.now() + 3600_000), scope: 'bookkeeping' }; },
  });
  await completeConnect(db, client, { code: 'abc', userId: 'u1' });
  const [a, b] = await Promise.all([getValidAccessToken(db, client), getValidAccessToken(db, client)]);
  expect(refreshCalls).toBe(1);
  expect(a).toBe('at2');
  expect(b).toBe('at2');
});

it('a failed refresh marks the connection needs_reauth and keeps the stale tokens', async () => {
  const db = await createDb('pglite://memory');
  const client = fakeClient({
    exchangeCode: async () => ({ accessToken: 'at1', refreshToken: 'rt1', expiresAt: new Date(Date.now() + 60_000), scope: 'bookkeeping' }),
    refreshTokens: async () => { throw new Error('invalid_grant'); },
  });
  await completeConnect(db, client, { code: 'abc', userId: 'u1' });
  await expect(getValidAccessToken(db, client)).rejects.toBeInstanceOf(NeedsReauthError);
  const conn = await getConnection(db);
  expect(conn).toMatchObject({ status: 'needs_reauth', accessToken: 'at1', refreshToken: 'rt1' });
  expect(conn?.lastRefreshError).toMatch(/invalid_grant/);
});

it('disconnect sets status to disconnected', async () => {
  const db = await createDb('pglite://memory');
  await completeConnect(db, fakeClient(), { code: 'abc', userId: 'u1' });
  await disconnect(db);
  expect((await getConnection(db))?.status).toBe('disconnected');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/fortnox/connection-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`completeConnect` inserts a new `fortnoxConnection` row (`randomUUID()` id, `status: 'connected'`, `connectedAt: new Date()`). `getConnection` selects the row ordered by `updatedAt desc` limit 1. `getValidAccessToken` runs inside `db.transaction()`, `SELECT ... FOR UPDATE` on the connection row (same lock technique as `signup-service.ts`'s seat check) so concurrent callers serialize: re-read the row after acquiring the lock, and if `accessTokenExpiresAt` is more than 2 minutes out, return `accessToken` as-is; otherwise call `client.refreshTokens(refreshToken)`, write the new pair + `lastRefreshedAt` before the transaction commits, and return the new access token. On a thrown error from `refreshTokens`, update `status: 'needs_reauth'` and `lastRefreshError: String(error)` (tokens untouched) and throw `NeedsReauthError`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/fortnox/connection-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fortnox/connection-service.ts src/lib/fortnox/connection-service.test.ts
git commit -m "feat: add fortnox connection service with rotation-safe token refresh"
```

---

### Task 6: Sync service (mirror upserts)

**Files:**
- Create: `src/lib/fortnox/sync-service.ts`
- Test: `src/lib/fortnox/sync-service.test.ts`

**Interfaces:**
- Consumes: `FortnoxClient` and its data types (Task 4).
- Produces (consumed by Tasks 7, 8):

```ts
export async function syncReferenceData(db: Db, client: FortnoxClient, accessToken: string, year: number): Promise<void>; // financial years, that year's accounts, cost centres, fx projects
export async function syncVouchersForYear(db: Db, client: FortnoxClient, accessToken: string, year: number): Promise<void>;
export async function runFirstImport(db: Db, client: FortnoxClient, accessToken: string): Promise<void>; // current + previous financial year
```

- [ ] **Step 1: Write the failing tests**

```ts
it('syncReferenceData upserts cost centres and fx projects, idempotently', async () => {
  const db = await createDb('pglite://memory');
  const client = fakeClient({ getCostCentres: async () => [{ code: 'INFRA', name: 'Infrastructure', active: true }] });
  await syncReferenceData(db, client, 'tok', 2027);
  await syncReferenceData(db, client, 'tok', 2027); // repeat
  const rows = await db.select().from(schema.fxCostCentre);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ code: 'INFRA', name: 'Infrastructure' });
});

it('syncVouchersForYear inserts a voucher and its rows', async () => {
  const db = await createDb('pglite://memory');
  const client = fakeClient({
    listVoucherKeys: async () => [{ series: 'A', number: 1 }],
    getVoucher: async () => ({ year: 2027, series: 'A', number: 1, date: '2027-03-01', description: 'Biltema', referenceType: null, referenceNumber: null, comments: null, hasAttachment: false,
      rows: [{ rowIndex: 1, account: 5460, debitSek: 10000, creditSek: 0, costCentreCode: null, fxProjectCode: null, transactionInfo: 'Biltema AB', removed: false }] }),
  });
  await syncVouchersForYear(db, client, 'tok', 2027);
  const [voucher] = await db.select().from(schema.fxVoucher);
  expect(voucher).toMatchObject({ year: 2027, series: 'A', number: 1, description: 'Biltema' });
  const rows = await db.select().from(schema.fxVoucherRow).where(eq(schema.fxVoucherRow.voucherId, voucher.id));
  expect(rows).toMatchObject([{ account: 5460, debitSek: 10000, removed: false }]);
});

it('re-syncing the same voucher after an Ändra edit marks the struck row removed and adds the new one, without duplicating', async () => {
  const db = await createDb('pglite://memory');
  const original = { year: 2027, series: 'A', number: 1, date: '2027-03-01', description: 'Biltema', referenceType: null, referenceNumber: null, comments: null, hasAttachment: false,
    rows: [{ rowIndex: 1, account: 5460, debitSek: 10000, creditSek: 0, costCentreCode: null, fxProjectCode: null, transactionInfo: 'Biltema AB', removed: false }] };
  const edited = { ...original, rows: [
    { ...original.rows[0], removed: true },
    { rowIndex: 2, account: 5460, debitSek: 10000, creditSek: 0, costCentreCode: null, fxProjectCode: null, transactionInfo: 'Biltema AB (corrected)', removed: false },
  ] };
  let voucher = original;
  const client = fakeClient({ listVoucherKeys: async () => [{ series: 'A', number: 1 }], getVoucher: async () => voucher });
  await syncVouchersForYear(db, client, 'tok', 2027);
  voucher = edited;
  await syncVouchersForYear(db, client, 'tok', 2027);
  const [v] = await db.select().from(schema.fxVoucher);
  const rows = await db.select().from(schema.fxVoucherRow).where(eq(schema.fxVoucherRow.voucherId, v.id));
  expect(rows).toHaveLength(2);
  expect(rows.find((r) => r.rowIndex === 1)?.removed).toBe(true);
  expect(rows.find((r) => r.rowIndex === 2)?.transactionInfo).toBe('Biltema AB (corrected)');
});

it('running the first import twice is idempotent', async () => {
  const db = await createDb('pglite://memory');
  const client = fakeClient({
    listVoucherKeys: async () => [{ series: 'A', number: 1 }],
    getVoucher: async () => ({ year: 2027, series: 'A', number: 1, date: '2027-03-01', description: 'X', referenceType: null, referenceNumber: null, comments: null, hasAttachment: false, rows: [] }),
  });
  await runFirstImport(db, client, 'tok');
  await runFirstImport(db, client, 'tok');
  expect(await db.select().from(schema.fxVoucher)).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/fortnox/sync-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`syncReferenceData`: fetch financial years, that year's accounts, cost centres, fx projects from the client; for each, `INSERT ... ON CONFLICT (<natural key column>) DO UPDATE` (cost centre/fx project by `code`, account by the `(year, number)` pair via a `SELECT` then conditional update — there's no DB unique constraint on that pair per Task 1, so read-then-write inside the function). `syncVouchersForYear`: for each `{series, number}` from `listVoucherKeys`, call `getVoucher`; look up an existing `fxVoucher` by `(year, series, number)` (`SELECT`, since no DB unique constraint — see Task 1's note), insert if absent else update its scalar fields; for its rows, upsert each by `(voucherId, rowIndex)` the same way (update if a row with that index exists, insert otherwise) — this is what makes an Ändra edit (existing `rowIndex` now `removed: true`, plus a new higher `rowIndex`) land as one update and one insert, and what makes re-running the whole import a no-op. `runFirstImport`: resolve "current and previous financial year" from `client.getFinancialYears`, call `syncReferenceData` and `syncVouchersForYear` for each, then upsert `fxSyncState` rows (`topic: 'vouchers' | 'projects' | 'cost-centers' | 'financial-years'`) with `lastFullSyncAt: new Date()`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/fortnox/sync-service.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/fortnox/sync-service.ts src/lib/fortnox/sync-service.test.ts
git commit -m "feat: add fortnox sync service"
```

---

### Task 7: Nightly sync cron route

**Files:**
- Create: `src/app/api/cron/fortnox-sync/route.ts`
- Test: `src/app/api/cron/fortnox-sync/route.test.ts`

**Interfaces:**
- Consumes: `getValidAccessToken`, `NeedsReauthError` (Task 5); `syncVouchersForYear` (Task 6); `createFortnoxClient` (Task 4).

- [ ] **Step 1: Write the failing test**

```ts
it('rejects without the correct bearer secret', async () => {
  process.env.CRON_SECRET = 'shh';
  const res = await POST(new Request('http://x', { headers: { authorization: 'Bearer wrong' } }));
  expect(res.status).toBe(401);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/cron/fortnox-sync/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Same guard as `src/app/api/cron/stripe-sync/route.ts` (`CRON_SECRET` bearer check, 401 on mismatch). On success: `getDb()`, `createFortnoxClient()`, `getValidAccessToken(db, client)`, then `syncVouchersForYear` for the current financial year (resolved via `client.getFinancialYears()`, not assumed to be the calendar year) — a full-year re-read every night rather than the spec's narrower "current and previous month" (§5.2), since `syncVouchersForYear` already upserts idempotently and the reference doc puts a full year's worth of vouchers at "a few thousand... minutes inside the rate limit." **My call**: simpler than adding a date-scoped variant of the sync function for a cost ("a few minutes nightly") the spec itself says is acceptable; revisit if voucher volume ever makes a full nightly re-read too slow. If `getValidAccessToken` throws `NeedsReauthError`, return `Response.json({ error: 'needs_reauth' }, { status: 200 })` (a dead connection isn't a cron failure to retry, it's a standing state the `/fortnox` page already surfaces).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/cron/fortnox-sync/route.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/app/api/cron/fortnox-sync/route.ts src/app/api/cron/fortnox-sync/route.test.ts
git commit -m "feat: add nightly fortnox sync cron route"
```

---

### Task 8: Connect flow UI and OAuth callback

**Files:**
- Create: `src/app/fortnox/page.tsx`, `src/app/fortnox/actions.ts`
- Create: `src/app/api/fortnox/callback/route.ts`
- Test: `src/app/api/fortnox/callback/route.test.ts`

**Interfaces:**
- Consumes: `requireTreasurer` (Task 2); `startConnect`, `completeConnect`, `disconnect`, `getConnection` (Task 5); `runFirstImport` (Task 6); `createFortnoxClient` (Task 4).

- [ ] **Step 1: Write the failing tests**

```ts
it('redirects to /fortnox with an error when Fortnox reports a denied consent', async () => {
  const res = await GET(new Request('http://x/api/fortnox/callback?error=access_denied'));
  expect(res.status).toBe(307);
  expect(res.headers.get('location')).toContain('/fortnox?error=access_denied');
});

it('redirects to /fortnox with an error when no code is present and no error either', async () => {
  const res = await GET(new Request('http://x/api/fortnox/callback'));
  expect(res.status).toBe(307);
  expect(res.headers.get('location')).toContain('/fortnox?error=missing_code');
});

it('rejects a state that does not match the stored cookie', async () => {
  const req = new Request('http://x/api/fortnox/callback?code=abc&state=wrong', { headers: { cookie: 'fortnox_oauth_state=right' } });
  const res = await GET(req);
  expect(res.status).toBe(307);
  expect(res.headers.get('location')).toContain('/fortnox?error=state_mismatch');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/fortnox/callback/route.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/app/fortnox/actions.ts`: `connectAction()` calls `requireTreasurer()`, generates `state = randomUUID()`, sets it in a short-lived `fortnox_oauth_state` cookie, and redirects to `startConnect(createFortnoxClient(), state)`. `runFirstImportAction()` calls `requireTreasurer()`, `getValidAccessToken`, then `runFirstImport`, and redirects back to `/fortnox`. `disconnectAction()` calls `requireTreasurer()` then `disconnect(db)`.

`src/app/api/fortnox/callback/route.ts`: `GET` reads `error`/`code`/`state` query params and the `fortnox_oauth_state` cookie. Missing/mismatched state, an `error` param, or a missing `code` each redirect to `/fortnox?error=<reason>` (`state_mismatch` / the Fortnox-provided error / `missing_code`) without calling `completeConnect`. Otherwise call `completeConnect(db, createFortnoxClient(), { code, userId })` (the acting user comes from the session the state cookie was set under — `requireTreasurer()` at the top of the handler) and redirect to `/fortnox`.

`src/app/fortnox/page.tsx`: `requireTreasurer()`, read `getConnection(db)`, render status (`connected` since `connectedAt`, `needs_reauth` with `lastRefreshError`, or `disconnected`), a Connect/Reconnect button (`connectAction`) and, once connected, a "Run first import" button (`runFirstImportAction`) and last `fxSyncState.lastFullSyncAt` per topic.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/api/fortnox/callback/route.test.ts`
Expected: PASS

- [ ] **Step 5: Add the new env vars**

In `.env.example`, alongside the existing `# Stripe:` block:

```
# Fortnox: register the app in Fortnox's developer portal (admin BankID consent required,
# cannot be automated) to get these. Tokens themselves live in the fortnox_connection table,
# not here.
FORTNOX_CLIENT_ID=
FORTNOX_CLIENT_SECRET=
FORTNOX_REDIRECT_URI=
```

- [ ] **Step 6: Commit**

```bash
git add src/app/fortnox/ src/app/api/fortnox/ .env.example
git commit -m "feat: add fortnox connect page and oauth callback"
```

---

## Self-review notes

- **Spec coverage:** §2 (connection, token lifecycle, locking, reauth) → Tasks 1, 5. §2.1 (human registration step) → Task 8's `.env.example` comment, not automated, matching the spec. §4.1 (mirror tables) → Task 1. §5.1 (first import) → Task 6, triggered from Task 8. §5.2 (nightly re-read, no WebSocket worker) → Task 7. §3's `treasurer` role → Task 2. The spec's §6 "Fortnox connection page" view → Task 8. Everything else in the full design doc (§4.2, §4.3, §6's other views, §7's budget/classification tests) belongs to the follow-up plan per the design doc's own scope split and is intentionally not here.
- **Proportion check:** the plan is longer than the relevant spec sections because it spells out exact fake-client shapes and test bodies the spec doesn't (and can't) specify — each test body is there because the Step Granularity rule requires the assertions as code, not because logic is being pre-written; the actual implementation steps stay at signature-plus-approach, not bodies.
