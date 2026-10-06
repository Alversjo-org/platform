# Membership management design

## 1. Summary

Turns the identity layer built in v0 (`docs/superpowers/specs/2026-09-15-platform-v0-design.md`)
into an actual membership system: members pay dues through Stripe, see their
own membership status and expiry on the homepage, and a new `member-admin`
role gets a directory of every member — including ones imported from
elsewhere who have never logged in — to track who's been asked to renew.

v0 deliberately deferred "membership import and Stripe" (§7 of that spec).
This is that work. It also happens to complete a few columns
(`isActiveMember`, `membershipExpiresAt`, `phoneNumber`) that v0's schema
already anticipated but never used.

Out of scope for this pass: scheduled/automatic renewal emails (sends are
manual, per member, triggered by a member-admin), multiple membership tiers
(there is one membership, payable three ways), a full contact history log
(one `lastContactedAt` timestamp + a notes field, not a log table), email
address changes (already deferred in v0), promoting users to admin/member-admin
from the UI (direct DB update, same as today's `ADMIN_EMAILS` bootstrap for
`admin`).

## 2. Roles

`role` extends from `'member' | 'admin'` to `'member' | 'member-admin' | 'admin'`.
`admin` is a superset of `member-admin` — anywhere the code checks for
member-admin access, it accepts either role:

```ts
function isMemberAdmin(user: SessionUser) {
  return user.role === 'admin' || user.role === 'member-admin';
}
```

There is no bootstrap env var for `member-admin` (unlike `ADMIN_EMAILS` for
`admin`) — a member-admin is promoted by an admin editing the `role` column
directly (via the DB; no UI for it in this pass, matching how admin
promotion already works).

| Role | Can do |
|---|---|
| `member` | Own homepage: view/edit own profile, view own membership status, pay/renew via Stripe |
| `member-admin` | Everything a member can, plus `/members` directory, CSV import, send renewal asks, edit any member's contact notes/fields, edit the renewal message template |
| `admin` | Everything member-admin can, plus `/boxes` fleet management |

## 3. Data model

All changes are to the existing `user` table, plus one new singleton table.

```ts
export type Role = 'member' | 'member-admin' | 'admin';

// user (existing columns kept; additions below)
nickname: text('nickname'),
discordHandle: text('discord_handle'),
stripeCustomerId: text('stripe_customer_id'),
stripeSubscriptionId: text('stripe_subscription_id'),
lastContactedAt: timestamp('last_contacted_at'),
contactNotes: text('contact_notes'),
```

`role` column's enum grows to include `'member-admin'`; default stays
`'member'`.

`isActiveMember` and `membershipExpiresAt` (already present) remain the
source of truth for membership status. They're set either by the Stripe
webhook (§5) or by a member-admin hand-editing a row (for cash payments,
grandfathered members, etc.) — same dual-write pattern the schema already
implied by having both an explicit boolean and a webhook-shaped `stripe*`
pair of columns.

New table, one row (`id = 'default'`), holding the configurable renewal
message:

```ts
export const renewalMessageSetting = pgTable('renewal_message_setting', {
  id: text('id').primaryKey().default('default'),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  updatedByUserId: text('updated_by_user_id').references(() => user.id),
});
```

Seeded on first migration with a sensible default subject/body containing
`{name}` and `{expiresAt}` placeholders.

**Imported, not-yet-logged-in members are plain `user` rows** — role
`member`, `emailVerified=false`, no `account`/`session` row, created by CSV
import (§6). No separate "members" table. Because login is email-OTP only
(no password/registration step), the first time that person logs in,
BetterAuth's email-OTP plugin matches their existing row by email and signs
them into it — nothing special needs to happen to "convert" an imported row
into a real account.

## 4. Stripe integration

### 4.1 Config

Already in Fly secrets: `STRIPE_API_KEY`. New secrets this adds:
`STRIPE_WEBHOOK_SECRET`. New non-secret env (`fly.toml` `[env]`, like
`EMAIL_FROM`): `STRIPE_PRICE_YEARLY`, `STRIPE_PRICE_MONTHLY`,
`STRIPE_PRICE_ONE_TIME` — the three Stripe Price IDs for the one
membership, sold three ways.

`stripe` is added as a dependency (currently not in `package.json`).

### 4.2 Paying

The payment UI (embedded in the homepage, §5) offers three buttons:

- **Pay yearly** (recurring) — the default/pre-selected option
- **Pay monthly** (recurring)
- **Pay one year** (one-time)

Each is a server action that creates a Stripe Checkout Session server-side
and redirects the browser to Stripe's hosted page — no Stripe.js, no
publishable key, matching the "no client-side Stripe SDK" simplicity of a
pure redirect flow:

```ts
stripe.checkout.sessions.create({
  mode: price === priceOneTime ? 'payment' : 'subscription',
  customer: user.stripeCustomerId ?? undefined,
  customer_email: user.stripeCustomerId ? undefined : user.email,
  line_items: [{ price, quantity: 1 }],
  success_url: `${platformUrl}/?checkout=success`,
  cancel_url: `${platformUrl}/?checkout=cancelled`,
  client_reference_id: user.id,
});
```

`client_reference_id` is how the webhook maps the session back to a
platform user without relying on email matching alone.

### 4.3 Webhook

`POST /api/webhooks/stripe` — verifies `Stripe-Signature` against
`STRIPE_WEBHOOK_SECRET` using `stripe.webhooks.constructEvent`, then:

- **`checkout.session.completed`**, `mode: 'subscription'` — loads the
  subscription to get `current_period_end`; sets `stripeCustomerId`,
  `stripeSubscriptionId`, `isActiveMember=true`,
  `membershipExpiresAt = current_period_end`.
- **`checkout.session.completed`**, `mode: 'payment'` (one-time) — sets
  `stripeCustomerId`, `isActiveMember=true`,
  `membershipExpiresAt = addYears(max(now, user.membershipExpiresAt ?? now), 1)`
  so renewing before expiry doesn't forfeit remaining time. No
  `stripeSubscriptionId`.
- **`customer.subscription.updated`** — resync `membershipExpiresAt` to the
  subscription's new `current_period_end` (covers renewals and plan
  changes).
- **`customer.subscription.deleted`** — clear `stripeSubscriptionId`.
  `isActiveMember` is not flipped immediately; it simply goes stale once
  `membershipExpiresAt` passes (checked at read time, §5), consistent with
  one-time payers never having a subscription to delete in the first place.

All four handlers look up the user by `client_reference_id` (checkout) or by
`stripeCustomerId` (subscription events, which don't carry
`client_reference_id`).

### 4.4 "Needs to pay" condition

A member sees the payment buttons (not just a status line) when:

```ts
!user.isActiveMember || user.membershipExpiresAt <= now || !user.stripeSubscriptionId
```

i.e. not a member at all, membership expired, or membership is active but
not backed by a live recurring subscription (manually granted, imported, or
paid one-time — `stripeSubscriptionId` is only ever set by the subscription
checkout path and cleared on `customer.subscription.deleted`, so its
presence is the "on a recurrent payment" signal). This matches "available
for all who log in that are not yet members or that are not on a recurrent
payment" exactly, with no separate subscription-status field to keep in
sync.

## 5. Member homepage (`/`)

Replaces today's unconditional `redirect('/boxes')`.

- **Active membership** (`isActiveMember && membershipExpiresAt > now`):
  shows "Member until `<date>`", the three payment buttons (always offered,
  per §4.4), and a profile form — name, nickname, phone, Discord handle,
  editable by the member themself via a server action parallel to today's
  admin-only `updateUserAction`.
- **Expired or never-active**: shows only the status line ("Membership
  expired on `<date>`" / "You are not yet a member") and the three payment
  buttons. Profile editing and everything else on the page is hidden.

`/boxes` becomes an ordinary nav link (next to "Members" for member-admins,
mirroring how "Users" is admin-only today) instead of the forced landing
page. Visibility of the link itself doesn't change — anyone logged in could
already visit `/boxes` and see only boxes shared with them.

## 6. Member directory (`/members`, member-admin)

Replaces `/users` (admin-only today) — same underlying list-and-edit
feature, under-scoped before this pass; `/users` and its action file are
removed rather than kept alongside a near-duplicate page.

- **List**: every member — including inactive/imported, never-logged-in
  ones. Columns: name, nickname, email, phone, Discord, membership
  status + expiry, last contacted, notes.
- **Edit row**: the existing fields (name, phone, isActiveMember,
  membershipExpiresAt) extended with nickname, discordHandle,
  contactNotes — same server-action pattern as today's `updateUserAction`,
  gated on `isMemberAdmin` instead of `requireAdmin`.
- **Send renewal ask**: opens the stored default subject/body
  (`{name}`/`{expiresAt}` substituted), editable before sending for that one
  send only (doesn't alter the stored default), sends via Resend (§7), and
  stamps `lastContactedAt = now()` on success.
- **Import CSV** (`/members/import`): upload `name,email,membershipExpiresAt`
  rows (`membershipExpiresAt` optional, ISO date, blank = never a member
  yet). For each row: if a `user` with that email exists, leave it alone
  (import never overwrites an existing member); otherwise insert a new
  `user` row (`role='member'`, `emailVerified=false`,
  `membershipExpiresAt` from the row or `null`, `isActiveMember` = whether
  that date is in the future, `false` if blank). Reports a per-row summary
  (created / skipped-existing / error) after upload rather than failing the
  whole batch on one bad row.
- **Renewal message settings** (`/members/settings`): edit the singleton
  `renewalMessageSetting` row's subject/body.

## 7. Renewal emails via Resend

`sendRenewalEmail` in `src/lib/email.ts`, mirroring `sendOtpEmail`:

```ts
export async function sendRenewalEmail(
  { to, subject, body }: { to: string; subject: string; body: string },
): Promise<void>
```

Without `RESEND_API_KEY` it logs to console (`[email] to=... subject=...`),
exactly like OTPs do on dev boxes — no separate dev-mode flag needed.
Placeholder substitution (`{name}`, `{expiresAt}`) happens in the caller
(the send-renewal-ask action), before either the default or a customized
message reaches this function, so the function itself stays a plain
sender with no templating logic.

## 8. Testing

Following the existing test layout (one `.test.ts` beside the module it
tests, Resend/Fly faked, PGlite for anything hitting the DB):

- `isMemberAdmin` / role-gating unit tests for `/members`, `/members/import`,
  `/members/settings`.
- Stripe webhook handler tests against constructed fake event payloads
  (no real network call to Stripe) covering all four event types in §4.3,
  including the "extend from max(now, current expiry)" math for one-time
  renewals.
- CSV import: valid rows, a row with an existing email (skipped, not
  overwritten), a malformed row (reported, batch continues).
- Renewal email: placeholder substitution, and that sending stamps
  `lastContactedAt`.
- Homepage: active vs. expired member sees the right set of controls
  (profile form present/absent, payment buttons present).

## 9. Migration

Single `drizzle-kit generate` after the schema changes in §3, committed
under `drizzle/` per the existing CI `db:check` gate. The
`renewal_message_setting` default row is seeded by the migration itself
(a data-carrying SQL migration, same mechanism Drizzle already uses for
schema), so a fresh PGlite dev DB gets a working default message with no
extra setup step.
