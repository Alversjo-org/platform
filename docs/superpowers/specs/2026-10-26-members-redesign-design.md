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
Discord, Last contacted move into the card (§3). Name becomes a dialog
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
result banners are unchanged. The "Renewal message" link is removed (§5).

## 3. Member card (replaces `/members/[id]`)

A dialog, opened by clicking a name, closed by Cancel/Save/outside-click.
Contains exactly today's "Details" card's fields — name, nickname, phone,
discord, active-member checkbox, can-create-events checkbox, membership
expiry — **plus `lastContactedAt` as a new plain editable date field**,
since the renewal-ask flow (§5) was the only thing that ever set it
before, and that flow is being hidden. Notes field unchanged.

`updateMember` (`src/lib/members/service.ts:21`) gains `lastContactedAt:
Date | null` in its input and `.set()` call, mirroring how
`membershipExpiresAt` already works. `updateMemberAction`
(`src/app/members/actions.ts:18`) reads it from the form the same way.

On save, the action still `redirect('/members')`s — in the App Router
this re-renders the page tree, which naturally closes the dialog (its
open state lives in the client component instance that gets remounted),
so no extra client-side "close on success" logic is needed.

No `/members/[id]` page/route survives this pass — direct links to it
(none exist in-app; it was only reached via the list) go away.

## 4. Roles dialog

Opened by the row's "Roles" button. Shows the member's name/email and one
tag per `GRANTABLE_ROLES` entry (`src/lib/roles/service.ts:7`:
Member-Manager, Mapper, Role-Manager, Superadmin — display labels, §6).
Each grantable tag is a tiny form (`setUserRoleAction`, same action
`/roles` already uses) that toggles grant↔revoke on click — exactly the
semantics already implemented and tested in the last PR, just surfaced
here too. Tags for `admin`/`role-admin` render as plain disabled chips
(not forms) when the viewer isn't themself an `admin`, matching
`setUserRole`'s existing server-side check — this dialog adds no new
authorization logic, only a second UI surface for the existing one.

## 5. Hiding the renewal-ask flow

Removed from the UI, not deleted from the codebase (explicitly: "we will
implement it differently" later):

- The "Send renewal ask" card on the member page — gone, since the member
  page itself (§3) replaces `/members/[id]`.
- The "Renewal message" link in `/members`'s header (`src/app/members/page.tsx`).
- `/members/settings` (the renewal-message-template editor) — link
  removed; the route, its action, and `renewalMessageSetting`
  table/`src/lib/members/renewal-message.ts` are untouched and still
  reachable by direct URL, just not linked from anywhere.

`sendRenewalAskAction`, `touchLastContacted`, `sendRenewalEmail` all stay
as-is in the codebase, simply unreferenced by any visible UI.

## 6. Role display labels

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
cells, and the new roles dialog (§4). The underlying `Role` strings
(`'admin'`, `'role-admin'`, etc.) are unchanged everywhere else — form
field values, `GRANTABLE_ROLES`, `hasAnyRole` calls, the database. This
is a presentation-layer mapping, not a rename.

## 7. New UI primitive: Dialog

`src/components/ui/dialog.tsx`, built on `@base-ui/react/dialog`
(confirmed present in `node_modules`, same package the existing
`dropdown-menu.tsx` uses for `@base-ui/react/menu` — no new dependency).
One component, not a separate mobile Drawer: styled to fill most of the
viewport on narrow screens and sit centered with a max-width on wide
ones, matching "works for both mobile and desktop" without a second
primitive. Uncontrolled (`Dialog.Root` manages its own open state
internally, like the existing `DropdownMenu` usage) — so `/members/page.tsx`
stays a server component; only `dialog.tsx` itself needs `'use client'`,
same pattern as `dropdown-menu.tsx`.

Exports mirror the existing primitives' shape: `Dialog`, `DialogTrigger`,
`DialogPortal`, `DialogBackdrop`, `DialogPopup`, `DialogTitle`,
`DialogClose`.

## 8. Testing

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

## 9. Migration

None. `lastContactedAt` already exists as a nullable timestamp column
(`src/db/schema.ts`); this pass only makes it editable, no schema change.
