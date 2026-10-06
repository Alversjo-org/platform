# Profile avatar design

## 1. Summary

Replaces the plain email text in the header with a clickable avatar (an
uploaded photo, or a fallback of initials/first-letter-of-email), and moves
all personal-detail editing — currently an inline form on the homepage — to
its own dedicated page reached through that avatar. The homepage goes back
to showing only membership status and payment once this lands.

A deliberate behavior change from the membership-management design
(`2026-10-06-membership-management-design.md` §5): that spec hid "all other
features except the payment page" from an expired member. Profile editing
is explicitly carved out of that rule now — any logged-in user, active or
not, can edit their name/nickname/phone/Discord handle and avatar. Keeping
contact details current actually helps the member-admin side of this
system (last-contacted tracking, renewal asks) regardless of payment status.

## 2. Data model

No new column. BetterAuth's existing `user.image` text column (present
since v0, never used) stores a small `data:image/webp;base64,...` string
directly — no object storage, no migration.

`MembershipExpiredError` (added in the membership-management work to make
`updateOwnProfile` refuse an inactive member) is deleted along with its
check and its test. Once the homepage's inline form — its only caller — is
removed, nothing throws or catches it; keeping it would be dead code
contradicting the new rule.

## 3. Avatar component and fallback

New `src/components/ui/avatar.tsx`, hand-written in the same shadcn-style
pattern as this codebase's existing `Textarea` addition (no new UI library):
a circular element, sized by a `size` prop, that renders in this priority:

1. `<img src={image}>` if the user has one stored.
2. Initials — the first letter of each of the first two words in `name`,
   uppercased (e.g. "Viktor Zaunders" → "VZ"; "Madonna" → "M") — if `name`
   is non-empty.
3. The first letter of `email`, uppercased.

Background is a single neutral token (matching `Badge`'s default variant),
not per-user-hashed — simple for now, revisit later if wanted. `nickname` is
not consulted for initials (unlike the dropdown's *text* display in §4,
which does prefer it) — a nickname isn't guaranteed to be two words, so
falling back straight to the email's first letter when `name` is empty is
more predictable than trying to extract initials from an arbitrary string.

## 4. Header: avatar + dropdown

In `app-shell.tsx`, the email + role badge `span` is replaced by the new
`Avatar` wrapped in a `DropdownMenuTrigger`, reusing the `DropdownMenu`
component that already exists in `src/components/ui/dropdown-menu.tsx` but
has had no caller anywhere in the app until now. The dropdown's content
shows, read-only:

- A larger `Avatar` + the user's `name` (or `nickname` if set and `name`
  isn't, or `email` as the last resort)
- The email
- A role `Badge`, shown under the same condition as today's header badge
  (`role !== 'member'`)
- A `DropdownMenuSeparator`, then a `DropdownMenuItem` linking to `/profile`,
  labeled "Edit profile"

This item is **always shown**, regardless of the viewer's membership
status — per §1, there is no active-membership gate on reaching or using
the edit page.

## 5. `/profile` page

New `src/app/profile/page.tsx` + `src/app/profile/actions.ts`. Reachable by
any logged-in user via `requireUser()` — no stricter guard, no redirect
based on membership status. Contains:

- The fields currently inline on the homepage: name, nickname, phone
  number, Discord handle (same inputs, same validation via
  `InvalidPhoneError`).
- A new file input for the avatar photo, submitted in the same form.
- A separate small `<form action={removePhotoAction}>` with its own
  one-click submit button, entirely distinct from the main save form — so
  a plain save with no new file reliably means "leave the current photo
  alone" rather than overloading one field with three states, and removing
  a photo never has to go through the rest of the form's validation.

`src/app/page.tsx` loses its "Your profile" card entirely; `src/app/actions.ts`'s
`updateProfileAction` moves to `src/app/profile/actions.ts` (colocated with
its page, matching this codebase's existing per-page `actions.ts`
convention — e.g. `src/app/members/actions.ts`).

## 6. Upload and resize pipeline

New dependency: `sharp`. New `src/lib/members/avatar.ts`:

```ts
export async function resizeAvatar(buffer: Buffer): Promise<string>
```

Decodes the input, resizes/crops to a fixed 128×128 square, re-encodes as
WebP, and returns a `data:image/webp;base64,...` string. Isolated from the
server action specifically so it's unit-testable with a real tiny image
fixture, independent of a full form submission.

In `src/app/profile/actions.ts`'s save action:

1. Before touching `sharp` at all, reject a raw uploaded file over a hard
   ceiling (5MB) with a friendly `?error=` redirect — a cheap guard against
   asking the server to decode something huge.
2. Call `resizeAvatar`. If `sharp` throws (corrupt file, unsupported
   format), catch it and redirect with a friendly error, not a crash.
3. If no file was selected in this submission, pass through the existing
   `image` value unchanged — a save without a new photo never clears one.
4. The separate "Remove photo" action explicitly sets `image` to `null`.

`updateOwnProfile` (`src/lib/members/service.ts`) gains an optional
`image?: string | null` field, written straight through to `schema.user.image`.
`updateMember` (the member-admin edit of someone else's row) is unchanged —
admins are not editing other members' avatars in this design.

## 7. Testing

- `src/lib/members/avatar.test.ts`: feed `resizeAvatar` a tiny real PNG
  fixture (committed as a test asset), assert the result is a well-formed
  `data:image/webp;base64,...` string and stays well under a sane size
  ceiling (e.g. under 20KB for a 128×128 WebP).
- `src/lib/members/service.test.ts`: extend `updateOwnProfile`'s existing
  tests to cover setting `image` to a value and clearing it back to `null`;
  remove the now-deleted `MembershipExpiredError` test.
- No tests for the `Avatar` component, the dropdown wiring, or the
  `/profile` page/actions themselves — matching this codebase's existing
  convention that presentational components and server actions aren't
  unit-tested (only service/lib layers are).
