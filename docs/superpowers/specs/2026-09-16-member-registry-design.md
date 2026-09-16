# Member registry, access model & payment sync — design

Date: 2026-09-16. Status: approved in brainstorming.

## 1. Purpose

v0 added `phoneNumber`, `isActiveMember` and `membershipExpiresAt` to `user`,
with an admin-only `/users` list and edit page. This design builds the next
slice on top of that:

1. An access model: a member can view and edit their own profile; only an
   admin can edit anyone else's. Membership status is never member-editable.
2. A member-facing registry (`/members`) — the first thing every member sees
   on the platform, with per-field opt-in visibility for phone and email.
3. A generic `externalPayments` table that records individual payment events
   from any source, and a rule that derives `isActiveMember` /
   `membershipExpiresAt` from them automatically.
4. Bulk CSV import of existing members from two other systems the club
   currently uses, populating `externalPayments` and creating user rows for
   people who don't have one yet.
5. A Stripe sync (admin-triggered) that pulls successful charges into the
   same `externalPayments` table, so membership status can be checked
   without calling Stripe on every page load.

Out of scope, on purpose: automatic/scheduled Stripe sync (no scheduler
exists yet — manual admin button only), incremental/windowed Stripe fetch
(re-fetching and relying on the unique constraint to skip duplicates is fine
at this scale), editable email address (still deferred from v0; only a
visibility toggle is in scope here), and any UI for admins to browse
individual `externalPayments` rows beyond what's needed to explain a
computed status (a detail view can come later if it's actually needed).

## 2. Data model

```
user            + phoneVisible: boolean default false
                + emailVisible: boolean default false

externalPayments
  id            text primary key
  userId        text not null, references user.id, onDelete cascade
  source        text not null   -- 'stripe' or a free-text label entered at CSV upload time, e.g. "Legacy Website"
  externalId    text not null   -- Stripe charge id, or a deterministic hash of (source, email, paidAt, amountCents) for CSV rows
  email         text not null   -- the raw value matched against user.email at import/sync time
  amountCents   integer         -- nullable; not always available from CSV sources
  currency      text            -- nullable
  paidAt        timestamp not null
  createdAt     timestamp not null default now()

  unique (source, externalId)
```

`unique(source, externalId)` is the idempotency key for both the CSV
importer and the Stripe sync: re-uploading the same file or re-clicking
"Sync from Stripe" is always safe, because a second attempt at the same
record no-ops instead of duplicating it.

## 3. Access model

New helper in `src/lib/session.ts`:

```
requireSelfOrAdmin(userId: string): Promise<SessionUser>
```

Redirects away (same pattern as `requireAdmin`) if the session user is
neither `userId` nor an admin.

Field-level rules on a `user` row:

| Field | Self | Admin | Notes |
|---|---|---|---|
| `name`, `phoneNumber` | edit | edit | |
| `phoneVisible`, `emailVisible` | edit | edit | booleans controlling registry visibility |
| `isActiveMember`, `membershipExpiresAt` | read-only | edit (manual override) | otherwise system-computed, see §5 |
| `email` | read-only | read-only | unchanged from v0 — still deferred |

Pages:

- `/users` (admin-only, unchanged) — full table, all fields, edit any user.
- `/users/[id]` — gains self-access via `requireSelfOrAdmin`. The status
  fields render as read-only text for a self-viewing member and as
  editable inputs for an admin.
- `/members` (new, any logged-in user via `requireUser`) — registry: name +
  active/inactive badge for every member, plus phone and/or email only for
  members who set the corresponding `*Visible` flag to true. This becomes
  the landing page members see first.

## 4. Bulk CSV import

New admin-only page `/members/import`.

1. Admin enters a source label (free text, e.g. "Legacy Website", "Swish")
   and uploads a CSV with columns `email` (required), `name` (optional),
   `amount` (optional), `paid_at` (required, ISO date).
2. Server parses and validates every row. Invalid rows (bad email, bad date)
   are collected as errors and excluded; valid rows proceed. Nothing is
   written yet.
3. A preview screen shows: count of users to be newly created, count
   matched to existing accounts, count of payment rows to be added, and the
   list of skipped rows with their errors.
4. On confirm: for each valid row, find-or-create the user by email (new
   users get `role='member'`, `name` from the row if present, no phone),
   insert an `externalPayments` row (`externalId` = hash of
   `source+email+paidAt+amountCents`), then recompute status (§5) for every
   user touched by this batch.

## 5. Status computation

`recomputeMembershipStatus(db, userId)`, called after any write to
`externalPayments` for that user (from CSV import or Stripe sync):

- `membershipExpiresAt = max(paidAt over that user's externalPayments) + 1 year`
- `isActiveMember = membershipExpiresAt > now()`

An admin's manual edit on `/users/[id]` persists until the next payment
event triggers a recompute, at which point the computed value wins again.

## 6. Stripe sync

Admin-only action on `/members/import` (or a small section next to it):
"Sync from Stripe" button.

- Uses the `stripe` npm package (new dependency) and `STRIPE_API_KEY` from
  env — already provisioned as a Fly secret on the platform app; add an
  empty entry to `.env.example`, never a real key in the repo.
- Paginates through Stripe's successful charges, maps each to
  `{email: charge's customer email, amountCents: charge.amount,
  currency: charge.currency, paidAt: charge.created, externalId: charge.id,
  source: 'stripe'}`.
- Upserts into `externalPayments` with `ON CONFLICT (source, externalId) DO
  NOTHING` (cheap to re-run — already-seen charges are skipped, not
  re-processed). Find-or-creates the user by email, same as CSV import.
  Recomputes status for every touched user.
- On a mid-fetch API failure: already-written rows stay committed (each
  upsert is independent), and the admin sees an alert with how many charges
  were synced before the error. Re-clicking "Sync" continues safely.

## 7. Testing

- Unit: `recomputeMembershipStatus` rule, CSV row validation/parsing,
  Stripe-charge-to-payment-row mapping (Stripe client mocked), permission
  checks (self-edit allowed, admin-edit allowed, cross-user edit denied,
  status fields rejected from a non-admin update).
- Integration (PGlite): CSV import end-to-end (new user creation, existing
  user matching, duplicate-row no-op on re-upload), `/members` registry
  rendering with phone/email hidden unless opted in.

## 8. Deferred, on purpose

Scheduled/automatic Stripe sync, incremental Stripe fetch windows, email
address editing, an admin UI for browsing raw `externalPayments` rows,
membership periods other than "1 year from payment" (flagged here as the
simplest starting rule — revisit if the club's actual membership terms
differ).
