# Members page redesign

## 1. Summary

Replaces the `/members` list's wide, mostly-empty columns with a lean row
(name, email, membership badge) plus an active/inactive filter; replaces
the separate `/members/[id]` edit page with a popup card opened by
clicking a name, editable in place; adds a per-row "Roles" button opening
a second popup where role-admins/admins grant or revoke roles by tapping
tags, without leaving `/members`; and hides (not deletes) the renewal-ask
email flow, since that's being redesigned separately later.

Also renames how roles are *displayed* (not stored) — `admin` →
Superadmin, `role-admin` → Role-Manager, `member-admin` → Member-Manager,
`mapper` unchanged — because three different "admin" labels in one UI
(as seen on the `/roles` page from the last PR) reads as a naming bug even
though the permissions themselves are fine.

Out of scope: renaming the stored `Role` values themselves (would need
another migration — explicitly deferred per conversation); pagination or
search on `/members` (stays as today, just fewer columns); the redesigned
renewal-ask flow itself (hidden, not rebuilt); any change to `/roles`,
which stays as the role-matrix overview and is unaffected by this pass.

## 2. List (`/members`)

Columns shrink to **Name, Email, Membership, (Roles button)** — Phone,
Discord, Last contacted move into the card (§4). Name becomes a dialog
trigger instead of a `Link` to `/members/[id]`, which is removed as a
route.

**Filter**: three tabs — Active / Inactive / All — reading/writing a
`?status=` query param, default `active`. `listMembers(db)` is unchanged
(still returns everyone); the page filters the already-fetched array by
`isActiveMember`, the same boolean the existing badge already renders
from, so no new query function.

**Roles button**: rendered only when the viewer satisfies the same gate
`/roles` already uses (`hasAnyRole(actor, ['admin', 'role-admin'])`) — a
plain member-admin without role-admin sees no Roles button, same as they
can't reach `/roles` today.

The existing "Import CSV" / "Sync from Stripe" links/button and their
result banners are unchanged. The "Renewal message" link is removed (§6).

## 3. Dialog open state: driven by the URL, not component state

Both dialogs in §4/§5 are **controlled**, not uncontrolled: whether one is
open is decided server-side, from `?edit=<id>` / `?roles=<id>` query
params on `/members`, and passed down as a prop. (Revised from an earlier
draft of this doc that assumed a server action's `redirect('/members')`
would "naturally" reset a client dialog's internal open state — that's
not a safe assumption under React's reconciliation, since the row tree
doesn't necessarily remount just because the page re-rendered with new
server data. Driving open state from the URL sidesteps the question
entirely, and is also what makes §5's "stay on `/members` across several
grants" and §4's error-reopen behavior actually work.)

Concretely: `MembersPage` reads `{ edit?: string; roles?: string; error?:
string }` from `searchParams` alongside today's `status`/`synced`/etc.,
and passes `openEdit={member.id === edit}` / `openRoles={member.id ===
roles}` into a small new per-row client component (§8) that renders both
dialogs for that row. Opening either dialog (clicking a name, clicking
"Roles") is a plain client-side navigation to `/members?edit=<id>` or
`/members?roles=<id>` (a `Link`, no server round-trip); closing (Cancel,
backdrop click, the dialog's own close button) navigates back to plain
`/members`, dropping the param.

## 4. Member card (replaces `/members/[id]`)

Contains exactly today's "Details" card's fields — name, nickname, phone,
discord, active-member checkbox, can-create-events checkbox, membership
expiry — **plus `lastContactedAt` as a new plain editable date field**,
since the renewal-ask flow (§6) was the only thing that ever set it
before, and that flow is being hidden. Notes field unchanged.

`updateMember` (`src/lib/members/service.ts:21`) gains `lastContactedAt:
Date | null` in its input and `.set()` call, mirroring how
`membershipExpiresAt` already works. `updateMemberAction`
(`src/app/members/actions.ts:18`) reads it from the form the same way.

- **On success:** `redirect('/members')` (no `edit` param) — per §3, this
  is what actually closes the dialog now, not an assumption about
  remounting.
- **On a known error** (`InvalidPhoneError`, `UserNotFoundError`):
  `redirect(`/members?edit=${id}&error=${message}`)` — replaces today's
  `redirect(`/members/${id}?error=...`)`, which would 404 once that route
  is gone. The card dialog reopens (via §3's URL-driven state) showing
  the error, same UX as today's inline `Alert`.

No `/members/[id]` page/route survives this pass — direct links to it
(none exist in-app; it was only reached via the list) go away.

## 5. Roles dialog

Opened by the row's "Roles" button (`/members?roles=<id>`, §3). Shows the
member's name/email and one tag per `GRANTABLE_ROLES` entry
(`src/lib/roles/service.ts:7`: Member-Manager, Mapper, Role-Manager,
Superadmin — display labels, §7). Each grantable tag is a tiny form
submitting to `setUserRoleAction`, which gains one new hidden field,
**`returnTo`** — the path+query to redirect back to on success/error,
defaulting to `/roles` if absent so the existing `/roles` page's forms
need no behavior change (just add `<input type="hidden" name="returnTo"
value="/roles" />` there too, for symmetry — or leave them omitting it
and let the default apply). The `/members` roles dialog's forms set
`returnTo` to `/members?roles=<id>`, so toggling a role redirects back to
the *same open dialog* rather than to `/roles` — an admin can tick
several tags in one sitting without re-opening anything, directly
resolving the contradiction a review pass caught in an earlier draft
(reusing the action unmodified would have sent them to `/roles` instead,
defeating §1's "without leaving `/members`" goal).

`src/app/roles/actions.ts`:
```ts
const returnTo = String(formData.get('returnTo') ?? '/roles');
// ...
redirect(returnTo); // was: redirect('/roles')
// and on NotAuthorizedError/UnknownRoleError:
redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);
```

Tags for `admin`/`role-admin` render as plain disabled chips (not forms)
when the viewer isn't themself an `admin`, matching `setUserRole`'s
existing server-side check — this dialog adds no new authorization
logic, only a second UI surface for the existing one.

## 6. Hiding the renewal-ask flow

Removed from the UI, not deleted from the codebase (explicitly: "we will
implement it differently" later):

- The "Send renewal ask" card on the member page — gone, since the member
  card itself (§4) replaces `/members/[id]`.
- The "Renewal message" link in `/members`'s header (`src/app/members/page.tsx`).
- `/members/settings` (the renewal-message-template editor) — link
  removed; the route, its action, and `renewalMessageSetting`
  table/`src/lib/members/renewal-message.ts` are untouched and still
  reachable by direct URL, just not linked from anywhere.

`sendRenewalAskAction`, `touchLastContacted`, `sendRenewalEmail` all stay
as-is in the codebase, simply unreferenced by any visible UI.

## 7. Role display labels

New `src/lib/roles/labels.ts`:

```ts
export const ROLE_LABELS: Record<Role, string> = {
  admin: 'Superadmin',
  'role-admin': 'Role-Manager',
  'member-admin': 'Member-Manager',
  mapper: 'Mapper',
};
```

Used everywhere a role is rendered as text: the account-menu badges
(`src/components/app-shell.tsx`), the `/roles` page's column headers and
cells, and the new roles dialog (§5). The underlying `Role` strings
(`'admin'`, `'role-admin'`, etc.) are unchanged everywhere else — form
field values, `GRANTABLE_ROLES`, `hasAnyRole` calls, the database. This
is a presentation-layer mapping, not a rename.

## 8. New UI primitive: Dialog, and the per-row client wrapper

`src/components/ui/dialog.tsx`, built on `@base-ui/react/dialog`
(confirmed present in `node_modules`, same package the existing
`dropdown-menu.tsx` uses for `@base-ui/react/menu` — no new dependency).
One component, not a separate mobile Drawer: styled to fill most of the
viewport on narrow screens and sit centered with a max-width on wide
ones, matching "works for both mobile and desktop" without a second
primitive. Thin wrapper over `Dialog.Root`'s own `open`/`onOpenChange`
props (Base UI supports both controlled and uncontrolled use natively;
this component doesn't need to pick one) — `dialog.tsx` itself needs
`'use client'`, same as `dropdown-menu.tsx`.

Exports mirror the existing primitives' shape: `Dialog`, `DialogTrigger`,
`DialogPortal`, `DialogBackdrop`, `DialogPopup`, `DialogTitle`,
`DialogClose`.

Per §3, `MembersPage` itself stays a server component — it resolves
`openEdit`/`openRoles` from `searchParams` and passes them as props into
one new small client component per row, e.g. `src/app/members/member-row-dialogs.tsx`
(`'use client'`), which owns: the name-as-`Link` trigger to
`/members?edit=<id>`, the member-card `Dialog` with `open={openEdit}`
and `onOpenChange` navigating back to `/members` on close, the
"Roles"-button `Link` trigger to `/members?roles=<id>`, and the roles
`Dialog` with `open={openRoles}` likewise. Using `Link` for triggers
(rather than a client `onClick` + `router.push`) keeps opening a dialog
a normal, server-renderable navigation — no JS-only interaction.

## 9. Testing

Following the existing layout:

- `src/lib/members/service.test.ts`: `updateMember` persists
  `lastContactedAt` (new case alongside existing field coverage).
- No new tests for `dialog.tsx`, the member card, or the roles dialog
  markup — matches this codebase's existing convention of zero
  `.test.tsx` files and no React-rendering test infra; verified by
  `npm run build` and a manual local run (`npm run dev`) before the PR,
  per your request.
- `src/lib/roles/labels.ts`: a plain data map: one test asserting all
  four `Role` values have a distinct label.
- Existing `/roles` page and `setUserRoleAction`/`setUserRole` tests are
  untouched — this pass adds a second UI surface for already-tested
  logic, not new authorization behavior.

## 10. Migration

None. `lastContactedAt` already exists as a nullable timestamp column
(`src/db/schema.ts`); this pass only makes it editable, no schema change.
