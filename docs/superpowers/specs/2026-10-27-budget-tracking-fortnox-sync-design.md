# Budget tracking and Fortnox sync design

## 1. Summary

Builds steps 4–5 of the internal projects/events/co-budgeting reference note
(Oct 15, 2026 — see
`2026-10-15-projects-events-cobudgeting-reference.md` and
`2026-10-15-fortnox-data-classification-budget-tracking-reference.md`):
project groups, the treasurer-entered annual budget, a read-only Fortnox
mirror, and classification of Fortnox actuals against projects. Steps 1–3
(projects, events, sign-ups, areas) already shipped — see
`2026-10-22-events-module-design.md`. Dreams rounds, allocations, receipts,
outlays and supplier invoices (steps 6–8) are a separate, later slice and
are not touched here.

What ships:

- A Fortnox connection: one-time admin OAuth consent (service account), with
  the resulting access/refresh tokens stored in the database and refreshed
  automatically, not in a static Fly secret — see §2 for why the reference
  note's "no refresh token to rotate" turned out to be wrong.
- A read-only mirror of Fortnox's accounts, cost centres, Fortnox projects,
  financial years, vouchers and voucher rows, kept current by a nightly
  re-read and reconciliation check. Sync is nightly-only this pass (see
  §5.2) — up to a day's lag, not minutes — since that needs no new
  infrastructure; a WebSocket worker for near-real-time sync is deferred
  until daily freshness proves insufficient.
- `project_group`, linking the platform's existing `project` table to a
  Fortnox cost centre.
- `annual_budget` / `budget_amount`: a versioned, treasurer-entered budget
  per project group (and optionally per project) per month.
- `classification` / `classification_rule`: an Unclassified list, rule-based
  suggestions, manual confirm/override/split, full history, and the
  permission rules from the reference note (leads within their projects,
  group members within their group, treasurer everywhere).
- A new `treasurer` role, added to the existing many-to-many roles model
  (`2026-10-25-role-management-design.md`) the same way `mapper` was added.
- Year overview (budget vs. actual vs. not-yet-placed per project group) and
  a per-project actuals view.

Out of scope for this pass: dreams rounds and any `fund`/`round`/
`allocation`/`budget_line` table (the opt-in co-budgeting mechanism stays a
separate later slice — a project with a budget line in this pass just has a
direct, treasurer-entered number, no round required); receipts, outlays,
Wise payouts; supplier invoices (`fx_supplier_invoice` is not created this
pass — nothing reads it yet); pushing classification back to Fortnox as a
reclassification voucher; `forecast`; object storage; taking payment for
anything. "Read, don't write" holds throughout — the only Fortnox writes in
this pass are the OAuth token exchange itself.

## 2. Fortnox connection & token lifecycle

The reference note's auth section says the service-account flow gives "a
token per hour with no refresh token to rotate," and that the secret can
just live in Fly secrets. Checked against Fortnox's current developer docs
and several integrators' writeups, that's incorrect in a way that matters
for the schema:

- Fortnox's service-account flow (`account_type=service` on the
  authorization URL) is still a standard OAuth2 **authorization code**
  grant. One admin does a one-time consent (BankID), Fortnox redirects back
  with a code valid 10 minutes, which is exchanged for an **access token
  (1 hour)** and a **refresh token (45 days)**.
- Refresh tokens are **single-use and rotate on every refresh**: each
  refresh call returns a new refresh token and immediately invalidates the
  old one. There is no way to "just keep using" a refresh token across
  calls.
- If a refresh is ever lost (not persisted before a crash, or raced — see
  below) or the 45-day window lapses, the connection is dead and can only be
  revived by a human repeating the one-time consent. There is no
  unattended recovery path.

**Consequence for the design:** the access token, refresh token and the
access token's expiry cannot live in a Fly secret — Fly secrets are set at
deploy time (`fly secrets set`) and the running app has no way to rewrite
them. They have to live in a database row the app updates on every refresh.
Only the app's own `client_id`/`client_secret` (Fortnox's credentials for
*this app*, which never change) belong in Fly secrets — same posture as
`STRIPE_API_KEY` today.

```ts
export type FortnoxConnectionStatus = 'connected' | 'needs_reauth' | 'disconnected';

export const fortnoxConnection = pgTable('fortnox_connection', {
  id: text('id').primaryKey(),
  status: text('status', { enum: ['connected', 'needs_reauth', 'disconnected'] })
    .$type<FortnoxConnectionStatus>().notNull().default('disconnected'),
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
```

One row is expected to exist (Alversjö has one Fortnox tenant); modelled as
a table rather than a singleton so reconnecting after a `needs_reauth`
writes a fresh row and the old one's history isn't lost — same append-ish
spirit as `decisionLog`, **my call**.

**Refresh-token-safe client.** Every outgoing Fortnox call goes through one
function that, before calling the API:

1. Reads the current row.
2. If `accessTokenExpiresAt` is more than ~2 minutes away, uses it as-is.
3. Otherwise takes a Postgres advisory lock (or `SELECT ... FOR UPDATE` on
   the connection row) before refreshing, so the web process and the
   nightly job can never refresh concurrently and race each other with the
   same (about-to-be-invalidated) refresh token — and so this stays correct
   if a WebSocket worker (§5.2) is ever added as a third caller. This is
   the real-world failure mode other Fortnox integrators report: two
   concurrent refreshes both read the same stored refresh token, only one
   succeeds, and the loser either breaks the connection or overwrites the
   good tokens with an error — a DB-level lock (not an in-process one) is
   required because this can run as more than one OS process.
4. Persists the new access + refresh token pair and `lastRefreshedAt`
   **before** returning, so a crash between refresh and persist can't lose
   a single-use refresh token.
5. On a failed refresh (`invalid_grant`), sets `status = 'needs_reauth'` and
   `lastRefreshError`, and leaves the stale tokens in place for
   forensics rather than clearing them.

A `needs_reauth` connection surfaces as a banner on the treasurer-only
Fortnox page (§5) — reconnecting means redoing the one-time consent flow in
§5.1, there is no automated recovery.

### 2.1 Registering the app (human step, not automated here)

Registering the app in the Fortnox developer portal, and the one-time
admin BankID consent, both have to happen as a human logged into Fortnox's
own portal — there's no credential on this admin box for that. Once a
`client_id`/`client_secret` exist, `fly secrets set` wires them in; the
rest of this section is code, not a manual step.

## 3. Roles & permissions

Adds `treasurer` to the existing `Role` union
(`2026-10-25-role-management-design.md` §3), the same mechanism used for
`mapper` — no change to the `user_role` table shape, no new migration
pattern:

```ts
export type Role = 'admin' | 'member-admin' | 'mapper' | 'role-admin' | 'treasurer';
```

`treasurer` can: connect/reconnect Fortnox, create/edit/approve
`annual_budget`/`budget_amount`, manage `project_group`, and classify any
row (the reference note's "Treasurers, everywhere"). Granted by
`admin`/`role-admin`, same as `mapper`.

Classification permission (reference note, "Who may classify"), **my
call** on what "group member" means since no `project_group_member` table
exists or is needed: a user counts as a member of a project group if they
hold any `project_member` row (any role) on any `project` whose
`projectGroupId` matches. That's derived from existing data, not a new
join table.

- A `project_member` (`lead`/`cocreator`) may classify rows already
  assigned to that project.
- Any user who is a `project_member` on *some* project in a group may
  classify unclassified rows belonging to that group's cost centre, and
  move a row between projects **within** that group.
- `treasurer`/`admin` may classify anything, and alone may move a row
  **across** project groups.
- `project_group` CRUD (name, cost-centre mapping) is `treasurer`-only —
  same flat-admin-list pattern as `area`/`mapper`.

`project_member.role` is **not** extended with `'treasurer'` this pass. The
reference note's events-module spec flagged `treasurer` as a future
`project_member` value for approving a *specific project's* outlays — that
has no function until the outlays slice exists, so adding it now would be
an unused enum value. The global `treasurer` role above is what this slice
actually needs. **My call, flag for confirmation.**

**Viewing is open to every member; editing/classifying is not.** Any
logged-in member can read the Unclassified list, Year Overview, and any
project's budget/actuals (§6) — not just their own group's, matching the
reference note's emphasis on transparency. The restrictions above are for
*writes* only: classifying a row, editing a budget, or managing
`project_group` still follow the lead/group-member/treasurer rules just
described. The two are genuinely separate axes — read access doesn't scale
with the classify-permission derivation above, it's simply "any member."

## 4. Data model

New tables, alongside the existing `project`/`decisionLog`/etc. in
`src/db/schema.ts`.

### 4.1 Fortnox mirror

Fortnox's own "Project" concept (a cost-centre-like code on voucher rows)
is named `fxProject` throughout to avoid colliding with the platform's
`project` table — they are unrelated entities that happen to share a word.

```ts
export const fxFinancialYear = pgTable('fx_financial_year', {
  id: text('id').primaryKey(),
  fortnoxId: integer('fortnox_id').notNull().unique(),
  fromDate: date('from_date').notNull(),
  toDate: date('to_date').notNull(),
  lockedUntilDate: date('locked_until_date'),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
});

export const fxAccount = pgTable('fx_account', {
  id: text('id').primaryKey(),
  year: integer('year').notNull(), // financial-year id this account listing belongs to
  number: integer('number').notNull(),
  name: text('name').notNull(),
  active: boolean('active').notNull(),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => [unique().on(t.year, t.number)]);

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
  date: date('date').notNull(),
  description: text('description').notNull().default(''),
  referenceType: text('reference_type'),
  referenceNumber: text('reference_number'),
  comments: text('comments'),
  hasAttachment: boolean('has_attachment').notNull().default(false),
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => [unique().on(t.year, t.series, t.number)]);

export const fxVoucherRow = pgTable('fx_voucher_row', {
  id: text('id').primaryKey(),
  voucherId: text('voucher_id').notNull().references(() => fxVoucher.id, { onDelete: 'cascade' }),
  rowIndex: integer('row_index').notNull(),
  account: integer('account').notNull(),
  debitSek: integer('debit_sek').notNull().default(0), // öre, despite the name — platform-wide convention
  creditSek: integer('credit_sek').notNull().default(0),
  costCentreCode: text('cost_centre_code').references(() => fxCostCentre.code),
  fxProjectCode: text('fx_project_code').references(() => fxProject.code),
  transactionInfo: text('transaction_info'), // free-text line Fortnox shows per row; what classification_rule matches against
  removed: boolean('removed').notNull().default(false), // struck in Fortnox ("Ändra"); kept, excluded from totals
  syncedAt: timestamp('synced_at').notNull().defaultNow(),
}, (t) => [unique().on(t.voucherId, t.rowIndex)]);

export const fxSyncState = pgTable('fx_sync_state', {
  topic: text('topic').primaryKey(), // 'vouchers' | 'projects' | 'cost-centers' | 'financial-years'
  lastWebsocketOffset: text('last_websocket_offset'),
  lastFullSyncAt: timestamp('last_full_sync_at'),
});
```

`fx_voucher`/`fx_voucher_row` get a synthetic `id` primary key plus a
unique constraint on the natural Fortnox key, matching the rest of the
schema's convention (`project`, `area`, etc. all use a synthetic id; only
pure join tables use composite keys) — the reference note's "(year,
series, number, row)" key is kept as the unique constraint, not the PK,
so `classification.voucherRowId` below is a plain single-column FK.
**My call.**

`fx_supplier_invoice` from the reference note is **not** created this pass
— nothing reads it until the supplier-invoices slice.

### 4.2 Project groups and the annual budget

```ts
export const projectGroup = pgTable('project_group', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  costCentreCode: text('cost_centre_code').unique().references(() => fxCostCentre.code),
  parentId: text('parent_id').references(() => projectGroup.id: AnyPgColumn), // nested groups, e.g. a sub-area of Infrastructure
});
```

`costCentreCode` is unique: a cost centre maps to at most one group, so
"the unclassified row's cost centre" always resolves to exactly one group
in the reconciliation check (§6) — without this, a row could land in two
groups' unclassified totals at once. `parentId` is organisational only this
pass: the Year Overview sums each group independently and does **not** roll
a child's budget/actual up into its parent. Rollup is a real feature (a
treasurer will want "all of Infrastructure" as one number) but needs its
own pass once there's an actual nested group to test it against — adding
it speculatively now risks guessing the aggregation rule wrong. **My
call.**

`project` gains the column the events-module spec deliberately deferred:

```ts
// added to the existing `project` table:
projectGroupId: text('project_group_id').references(() => projectGroup.id),
```

`fortnoxProjectCode` is **not** added yet — nothing writes it until the
optional reclassification-push-back slice.

```ts
export type AnnualBudgetStatus = 'draft' | 'approved' | 'superseded';
export type BudgetLineKind = 'cost' | 'income';

export const annualBudget = pgTable('annual_budget', {
  id: text('id').primaryKey(),
  fiscalYear: integer('fiscal_year').notNull(), // calendar year, pending accountant confirmation — see §7
  version: integer('version').notNull(),
  status: text('status', { enum: ['draft', 'approved', 'superseded'] }).$type<AnnualBudgetStatus>().notNull().default('draft'),
  approvedByUserId: text('approved_by_user_id').references(() => user.id),
  approvedAt: timestamp('approved_at'),
  note: text('note'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [unique().on(t.fiscalYear, t.version)]);

export const budgetAmount = pgTable('budget_amount', {
  id: text('id').primaryKey(),
  annualBudgetId: text('annual_budget_id').notNull().references(() => annualBudget.id, { onDelete: 'cascade' }),
  projectGroupId: text('project_group_id').notNull().references(() => projectGroup.id),
  projectId: text('project_id').references(() => project.id), // optional: a line can target a specific project, not just its group
  kind: text('kind', { enum: ['cost', 'income'] }).$type<BudgetLineKind>().notNull(),
  month: integer('month'), // 1-12, null = whole-year line
  amountSek: integer('amount_sek').notNull(),
  accountFrom: integer('account_from'),
  accountTo: integer('account_to'),
});
```

`accountFrom`/`accountTo` is informational and never joined against
`classification` when computing a line's actual: "classified actual" for a
budget line is always the sum of `classification.amountSek` for rows whose
project (or project's group, for a group-level line) matches, full stop —
classification already pins a row to a project regardless of account, so
re-filtering by account at the budget-line level would mean some classified
money silently vanishes from the line whenever its account falls outside
the range. The account range only scopes the Unclassified list's grouping
and the nightly reconciliation's "which rows are cost/income candidates at
all" filter (accounts 3000–3999/4000–7999). **My call** — the alternative
(gating classified actuals by account too) would need its own rule for
what happens to a classified-but-out-of-range amount, and nothing in either
reference document asks for that.

Editing an approved `annual_budget` is not in-place: approving freezes a
version (status `approved`), and any later change inserts a new
`annual_budget` row (`version + 1`, status `draft` → `approved`) and flips
the old one to `superseded`, per the reference note's explicit confirmation
that budget rows are not versioned/immutable via `decisionLog` — Fortnox,
not this table, is the ledger of record, but the *budget itself* keeps
every approved version so a year-end report can show "as approved" vs. "as
revised." Every transition writes a `decisionLog` row
(`entity='annual_budget'`).

A version is one row for the *whole year*, with every group's lines
hanging off it via `budgetAmount.annualBudgetId` — so creating `version + 1`
must copy forward every unchanged `budgetAmount` row from the previous
version alongside the ones actually being edited. Without that copy, the
instant one group's number is revised, every other group's lines still
point at the now-`superseded` version and silently read as zero on the
Year Overview. **My call, since the alternative (a version per group) would
make "approve this year's budget" ambiguous about which groups are
included.**

"Approve" records that a `treasurer` marked the version approved — it does
not itself model a board or annual-meeting vote happening elsewhere (the
reference note says next year's budget is approved by "the board or the
annual meeting"). `decisionLog` plus `annualBudget.note` is the audit trail
for this pass; a dedicated meeting/minutes reference field is not added
now. **My call** — revisit once the legal-entity/K2-or-K3 question (§9,
carried over from the reference note) is settled with the accountant, since
that may dictate a stricter audit-trail requirement.

### 4.3 Classification

```ts
export const classification = pgTable('classification', {
  id: text('id').primaryKey(),
  voucherRowId: text('voucher_row_id').notNull().references(() => fxVoucherRow.id),
  projectId: text('project_id').notNull().references(() => project.id),
  amountSek: integer('amount_sek').notNull(), // this classification's share of the row; splits sum to the row total
  decidedByUserId: text('decided_by_user_id').notNull().references(() => user.id),
  decidedAt: timestamp('decided_at').notNull().defaultNow(),
  reason: text('reason'),
  supersededById: text('superseded_by_id').references(() => classification.id: AnyPgColumn),
});

export const classificationRule = pgTable('classification_rule', {
  id: text('id').primaryKey(),
  supplierTextMatch: text('supplier_text_match'), // substring match against fx_voucher_row.transactionInfo / fx_voucher.description
  accountFrom: integer('account_from'),
  accountTo: integer('account_to'),
  projectId: text('project_id').notNull().references(() => project.id),
  active: boolean('active').notNull().default(true),
  createdByUserId: text('created_by_user_id').notNull().references(() => user.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
```

A row is "classified" if it has a `classification` row with no
non-superseded successor. Splitting a row is multiple `classification`
rows against the same `voucherRowId` whose `amountSek` sum to the row's
amount — enforced at the server-action layer (the reference note's
requirement), not a DB constraint, since a split happens as several inserts
in one transaction.

**Suggestion order, my call** (the reference note says "rules and past
choices... pre-fill a suggestion" without specifying precedence): an active
`classification_rule` matching both `supplierTextMatch` (if set) and the
account range (if set) wins; if several match, the most recently created
rule wins; if none match, the most recent `classification` for a row with
the same `transactionInfo` text is shown as a secondary, lower-confidence
suggestion. A person always confirms before it's recorded — this ordering
only affects what's pre-filled, never an automatic classification.

## 5. Sync design

### 5.1 First import

Triggered once, by a `treasurer`, from a "Connect Fortnox" button:

1. Redirect to Fortnox's authorization URL with `account_type=service` and
   the scopes listed in the reference note's step 1
   (`bookkeeping`, `project`, `costcenter`, `supplierinvoice`, `supplier`,
   `payment`, `settings`, `inbox`, `archive`, `connectfile`,
   `companyinformation` — several of these aren't used until later slices
   but are requested once now since re-consenting later needs the same
   human BankID step).
2. On callback, exchange the code for tokens, write the `fortnoxConnection`
   row, `status = 'connected'`.
3. Read `/financialyears`, `/accounts`, `/costcenters`, `/projects`; upsert
   into the `fx_*` tables.
4. For the current and previous financial year, page through
   `/vouchers?financialyear=` and fetch each voucher with its rows; upsert.
5. Record `fx_sync_state.lastFullSyncAt` per topic.

### 5.2 Ongoing sync

- A nightly job (an HTTP route invoked by an external scheduler, the same
  shape as the existing `stripe-sync` cron route — the platform runs as
  one Fly machine today, there is no existing always-on worker process to
  copy) re-reads the current and previous month's vouchers regardless of
  any WebSocket activity (catches anything missed, and `Ändra` edits), and
  runs the reconciliation check (§6).
- All API calls go through the token-bucket client from §2 (25 requests /
  5 seconds), with backoff on HTTP 429.

**Decided: nightly-only for now, no WebSocket worker this pass.** A second
always-on Fly machine for the WebSocket connection is new recurring cost
and a new deploy/monitoring surface the platform doesn't have today;
up-to-a-day freshness is acceptable to start with. `fx_sync_state` is still
modelled with a `lastWebsocketOffset` column (§4.1) so adding the worker
later is additive — no migration, just a new process that starts
populating a column nothing reads yet. If it's added later: a worker
process holds the `wss://ws.fortnox.se/topics-v1` connection for
`vouchers`, `projects`, `cost-centers`, `financial-years`, and each event
triggers a fetch-and-upsert of that single resource, keyed so
duplicate/out-of-order events are harmless; if the worker has been down
more than ~2 weeks (the WebSocket replay window), the nightly job detects
the gap via `fx_sync_state` and falls back to a full re-read of the
affected year instead of relying on replay.

## 6. Views

- **Fortnox connection page** (`treasurer`-only): connection status,
  last sync times per topic, a "Reconnect" button when `needs_reauth`.
- **Project groups page** (`treasurer`-only): flat CRUD list, name +
  cost-centre mapping — same shape as `/areas`.
- **Budget entry page** (`treasurer`-only): create/edit a draft
  `annual_budget`, add/edit `budget_amount` rows per group/project/month,
  approve (freezes the version), see prior approved versions side by side.
- **Unclassified list** (any member can view; classify/split/move actions
  gated per §3): rows filtered to accounts 3000–3999/4000–7999 with no live
  `classification`, grouped by cost centre, with the rule/history
  suggestion inline; confirm, pick another project, or split.
- **Year overview** (any member): per project group — budget, classified
  actual, unclassified-by-cost-centre actual, not-yet-placed actual,
  remaining. (Forecast and the burn-by-month line from the reference note
  are deferred — no `forecast` table this pass.)
- **Project page** (any member): that project's budget lines (if any) and
  classified actual costs, no receipts yet (deferred).

Nightly reconciliation (§4.3/§6 of the reference note): sum of classified +
unclassified-by-cost-centre + not-yet-placed must equal Fortnox's booked
total for the period; a mismatch shows a warning banner on the year
overview rather than failing silently.

## 7. Testing

Following the existing per-module `.test.ts` convention (PGlite for
DB-backed tests):

- Token refresh: a near-expiry token triggers a refresh and persists the
  new pair; two concurrent calls needing a refresh result in exactly one
  real HTTP refresh (lock contention), both callers get a valid token; a
  failed refresh sets `needs_reauth` and leaves prior tokens in place.
- Sync upserts: replaying the same `voucher-created` event twice is a
  no-op the second time; a `removed` row is excluded from total queries.
- Budget versioning: approving freezes a version; editing an approved
  budget creates `version + 1` and marks the old one `superseded`; both
  versions remain queryable.
- Classification: a split's amounts must sum to the row amount or the
  action rejects; superseding writes a new row and the old one stops
  counting in totals while staying visible in history; permission checks
  for lead/group-member/treasurer per §3, including the cross-group
  treasurer-only case.
- Rule suggestions: an active rule matching supplier text + account range
  outperforms a non-matching one; most-recent-rule-wins on a tie; past
  classification for the same transaction text surfaces when no rule
  matches.
- Reconciliation: classified + unclassified + not-yet-placed sums equal a
  seeded Fortnox total; a deliberately broken seed trips the warning.

## 8. Migration

Single `drizzle-kit generate` after the schema additions in §4, committed
under `drizzle/`, per the existing `db:check` CI gate. Includes the
`treasurer` addition to the `Role` union (no data migration needed — it's
an additive enum value, nobody has it yet).

## 9. Open questions

Two decisions the builder-check flagged as blocking were settled directly
with the human partner and are reflected throughout this document, not
repeated here: sync is nightly-only this pass, no WebSocket worker (§5.2);
and viewing (not editing/classifying) the Unclassified list, Year
Overview and project pages is open to any member (§3, §6).

- [ ] Carried over from the reference note, unresolved and relevant to
  this slice specifically: is the financial year the calendar year?
  `annualBudget.fiscalYear` is modelled as a plain integer assumed to be a
  calendar year; if Alversjö's Fortnox financial year runs on a different
  boundary, the mapping from `fiscalYear` to the matching `fxFinancialYear`
  row needs to go by date range, not by year number equality.
- [ ] Carried over, unresolved: is Alversjö Natur AB the bookkeeping entity
  for everything this slice reads, or is there a separate förening? Doesn't
  block building the mirror (it reads whatever tenant the service account
  is consented against), but matters for what the budget/classification UI
  implies to users about whose money they're looking at.
- [ ] Carried over, unresolved: the accountant's account-range-to-project-group
  map. `budgetAmount.accountFrom/accountTo` and the Unclassified list's
  3000–3999/4000–7999 split are provisional until confirmed.
- [ ] My call, flagged above for confirmation: "group member" for
  classification permission derived from any `project_member` row in the
  group, rather than a dedicated membership table (§3); `treasurer` kept
  off `project_member.role` this pass (§3); suggestion-rule precedence
  (§4.3); `fx_voucher`/`fx_voucher_row` using a synthetic id instead of the
  natural Fortnox key as primary key (§4.1); `annual_budget` versioning
  copies forward unchanged `budget_amount` rows into the new version
  (§4.2); `project_group.costCentreCode` is unique and group nesting
  doesn't roll up totals this pass (§4.2).
