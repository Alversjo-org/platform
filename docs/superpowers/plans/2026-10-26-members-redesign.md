# Members page redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/members`'s wide list and separate `/members/[id]` edit page with a leaner, filterable list and two URL-driven dialogs (member card, roles), and rename how roles display (not how they're stored).

**Architecture:** `/members/page.tsx` stays a server component; it resolves `?status=`/`?edit=`/`?roles=`/`?error=` from `searchParams` and passes booleans/data down as props into one new small client component per row (`member-row-dialogs.tsx`) that owns the two `Dialog`s. Both dialogs are controlled by those query params, not internal state — opening is a plain `Link` navigation, closing (Cancel/backdrop/Escape) navigates back to `/members`. A new `Dialog` UI primitive wraps `@base-ui/react/dialog`, mirroring the existing `dropdown-menu.tsx`'s use of `@base-ui/react/menu`. `setUserRoleAction` gains a `returnTo` field so the roles dialog can redirect back into itself instead of always to `/roles`.

**Tech Stack:** Next.js (App Router, server actions), `@base-ui/react`, Drizzle ORM, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-members-redesign-design.md`

## Global Constraints

- Role *values* (`'admin'`, `'role-admin'`, `'member-admin'`, `'mapper'`) are unchanged everywhere except display text (spec §7).
- The renewal-ask flow (`sendRenewalAskAction`, `touchLastContacted`, `sendRenewalEmail`, `/members/settings`) is hidden from the UI, not deleted from the codebase (spec §6).
- No new automated tests for dialog/page markup — matches this codebase's existing convention of zero `.test.tsx` files and no action-level tests (spec §9); verified by `npm run build` and a manual `npm run dev` walkthrough before the PR.
- Filter default is `active` (spec §2).

## Review Focus

- A member with `lastContactedAt` or `membershipExpiresAt` of `null` must render an empty date input, not crash or show "Invalid Date" — the existing `membershipExpiresAt` field already handles this (`? ...toISOString().slice(0,10) : ''`); the new `lastContactedAt` field must follow the identical pattern. → Task 5 (the form that actually renders the date input).
- `setUserRoleAction`'s `returnTo` must not become an open redirect to an arbitrary external host — it's a same-origin path+query the form itself sets (`/roles` or `/members?roles=<id>`), never user-typed free text, so no validation is needed beyond it staying a relative path; a future caller must not wire it to anything user-controllable. → Task 4 (documented in the step, not a runtime check, since nothing in this plan accepts a `returnTo` from outside the two forms that set it).
- A `role-admin` (not `admin`) viewing the roles dialog for *any* member — including themselves — must see `admin`/`role-admin` tags as disabled chips, not forms, exactly matching `/roles`'s existing per-cell logic. → Task 5.
- Switching the status filter or closing a dialog must not silently resurrect a stale `error` banner from a previous navigation — `error` only renders when paired with a matching `edit`/`roles` id, and plain tab/Cancel links carry no query params forward. → Task 5.
- Deleting `/members/[id]/page.tsx` must not leave a dangling import anywhere (`sendRenewalAskAction`, `getRenewalMessage`, `renderMessage` were only ever imported there and by `/members/settings`, which is untouched) — confirmed by `npm run build` failing loudly on any orphaned import. → Task 5/Task 7.

---

### Task 1: `Dialog` UI primitive

**Files:**
- Create: `src/components/ui/dialog.tsx`

**Interfaces:**
- Consumes: `@base-ui/react/dialog` (`Dialog.Root/Trigger/Portal/Backdrop/Popup/Title/Close`, confirmed present in `node_modules`), `cn` from `"cn"` (same import every other `src/components/ui/*.tsx` uses).
- Produces: `Dialog` (= `Root`, supports `open`/`onOpenChange`/`defaultOpen`), `DialogTrigger`, `DialogPopup` (bundles `Portal`+`Backdrop`+`Popup`, same bundling pattern `DropdownMenuContent` already uses for `Portal`+`Positioner`+`Popup` in `src/components/ui/dropdown-menu.tsx:20-49` — callers never touch `Portal`/`Backdrop` directly), `DialogTitle`, `DialogClose`.

No test — no React-rendering test infra exists in this codebase (zero `.test.tsx` files); verified by `npm run build` (Task 7) and the manual walkthrough.

- [ ] **Step 1: Implement `src/components/ui/dialog.tsx`**

  ```tsx
  "use client"

  import * as React from "react"
  import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
  import { cn } from "cn"

  function Dialog({ ...props }: DialogPrimitive.Root.Props) {
    return <DialogPrimitive.Root data-slot="dialog" {...props} />
  }

  function DialogTrigger({ ...props }: DialogPrimitive.Trigger.Props) {
    return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
  }

  function DialogPopup({ className, children, ...props }: DialogPrimitive.Popup.Props) {
    return (
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop
          data-slot="dialog-backdrop"
          className="fixed inset-0 z-50 bg-black/50 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        />
        <DialogPrimitive.Popup
          data-slot="dialog-popup"
          className={cn(
            "fixed inset-x-4 bottom-4 top-auto z-50 max-h-[85vh] overflow-y-auto rounded-lg bg-popover p-5 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:inset-x-auto sm:top-1/2 sm:left-1/2 sm:bottom-auto sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2",
            className
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    )
  }

  function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
    return (
      <DialogPrimitive.Title
        data-slot="dialog-title"
        className={cn("mb-4 text-lg font-semibold", className)}
        {...props}
      />
    )
  }

  function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
    return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
  }

  export { Dialog, DialogTrigger, DialogPopup, DialogTitle, DialogClose }
  ```

- [ ] **Step 2: Build check**

  Run: `npm run build`
  Expected: compiles (nothing imports this file yet, so this just confirms the file itself type-checks).

- [ ] **Step 3: Commit**

  ```bash
  git add src/components/ui/dialog.tsx
  git commit -m "feat: add a Dialog UI primitive over @base-ui/react/dialog"
  ```

---

### Task 2: Role display labels

**Files:**
- Create: `src/lib/roles/labels.ts`
- Create: `src/lib/roles/labels.test.ts`

**Interfaces:**
- Consumes: `Role` (`@/db/schema`).
- Produces: `ROLE_LABELS: Record<Role, string>`.

- [ ] **Step 1: Write the failing test in `src/lib/roles/labels.test.ts`**

  ```ts
  import { describe, expect, it } from 'vitest';
  import { ROLE_LABELS } from './labels';

  describe('ROLE_LABELS', () => {
    it('gives every role a distinct, human display label', () => {
      expect(ROLE_LABELS).toEqual({
        admin: 'Superadmin',
        'role-admin': 'Role-Manager',
        'member-admin': 'Member-Manager',
        mapper: 'Mapper',
      });
      const labels = Object.values(ROLE_LABELS);
      expect(new Set(labels).size).toBe(labels.length);
    });
  });
  ```

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run src/lib/roles/labels.test.ts`
  Expected: FAIL — `./labels` doesn't exist yet.

- [ ] **Step 3: Implement `src/lib/roles/labels.ts`**

  ```ts
  import type { Role } from '@/db/schema';

  export const ROLE_LABELS: Record<Role, string> = {
    admin: 'Superadmin',
    'role-admin': 'Role-Manager',
    'member-admin': 'Member-Manager',
    mapper: 'Mapper',
  };
  ```

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run src/lib/roles/labels.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit**

  ```bash
  git add src/lib/roles/labels.ts src/lib/roles/labels.test.ts
  git commit -m "feat: add display labels for role names"
  ```

---

### Task 3: `lastContactedAt` becomes a plain editable field

**Files:**
- Modify: `src/lib/members/service.ts:21-40` (`updateMember`)
- Modify: `src/lib/members/service.test.ts`
- Modify: `src/app/members/actions.ts:18-46` (`updateMemberAction`)

**Interfaces:**
- Produces: `updateMember`'s input type gains `lastContactedAt: Date | null`.

- [ ] **Step 1: Write the failing test in `src/lib/members/service.test.ts`**

  Find the existing `updateMember` test (the one matching "updateMember sets every member-admin-editable field..."). Add a new case:
  ```ts
  it('updateMember persists lastContactedAt, including clearing it back to null', async () => {
    const updated = await updateMember(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null,
      isActiveMember: true, membershipExpiresAt: null, contactNotes: null, canCreateEvents: true,
      lastContactedAt: new Date('2027-01-15'),
    });
    expect(updated.lastContactedAt).toEqual(new Date('2027-01-15'));
    const cleared = await updateMember(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null,
      isActiveMember: true, membershipExpiresAt: null, contactNotes: null, canCreateEvents: true,
      lastContactedAt: null,
    });
    expect(cleared.lastContactedAt).toBeNull();
  });
  ```
  (Match the existing test file's `beforeEach` setup — a `viktor` user should already exist there; if the seeded id differs, use whatever the file's existing tests use.)

- [ ] **Step 2: Run test to verify it fails**

  Run: `npx vitest run src/lib/members/service.test.ts`
  Expected: FAIL — TS error, `lastContactedAt` not in `updateMember`'s input type.

- [ ] **Step 3: Update `updateMember` in `src/lib/members/service.ts`**

  Add `lastContactedAt: Date | null;` to the input type (alongside `contactNotes`), and `lastContactedAt: input.lastContactedAt,` to the `.set({...})` call.

- [ ] **Step 4: Run test to verify it passes**

  Run: `npx vitest run src/lib/members/service.test.ts`
  Expected: PASS.

- [ ] **Step 5: Update `updateMemberAction` in `src/app/members/actions.ts`**

  - Add, alongside the existing `expiresRaw`/`phoneRaw` parsing:
    ```ts
    const lastContactedRaw = String(formData.get('lastContactedAt') ?? '').trim();
    ```
  - In the `updateMember(...)` call, add:
    ```ts
    lastContactedAt: lastContactedRaw === '' ? null : new Date(lastContactedRaw),
    ```
  - Change the error-path redirect target from `` `/members/${id}?error=${encodeURIComponent(message)}` `` to `` `/members?edit=${id}&error=${encodeURIComponent(message)}` `` — the old target 404s once Task 5 deletes `/members/[id]`.

- [ ] **Step 6: Build check**

  Run: `npm run build`
  Expected: compiles (no caller passes the new field yet until Task 5, but the type change alone must not break anything — `src/app/members/actions.ts` is the only other caller and is updated in this same step).

- [ ] **Step 7: Commit**

  ```bash
  git add src/lib/members/service.ts src/lib/members/service.test.ts src/app/members/actions.ts
  git commit -m "feat: make lastContactedAt a plain editable member field"
  ```

---

### Task 4: `setUserRoleAction` gains `returnTo`

**Files:**
- Modify: `src/app/roles/actions.ts`
- Modify: `src/app/roles/page.tsx:49-54` (the existing per-cell form)

**Interfaces:**
- Consumes: nothing new.
- Produces: `setUserRoleAction` now reads an optional `returnTo` form field (defaults to `/roles`); callers that want to land somewhere else after a grant/revoke add `<input type="hidden" name="returnTo" value="..." />` to their form.

No new test — this action has no existing test file (matches this codebase's thin-action convention, same as every other `*/actions.ts` in `src/app`); verified by `npm run build` and the manual walkthrough (Task 7), plus Task 5 exercising it live through the new roles dialog.

- [ ] **Step 1: Update `setUserRoleAction` in `src/app/roles/actions.ts`**

  ```ts
  export async function setUserRoleAction(formData: FormData) {
    const actor = await requireRoleAdmin();
    const targetUserId = String(formData.get('userId'));
    const role = String(formData.get('role')) as Role;
    const grant = formData.get('grant') === 'true';
    const returnTo = String(formData.get('returnTo') ?? '/roles');
    try {
      await setUserRole(await getDb(), { actor, targetUserId, role, grant });
    } catch (e) {
      const message = knownMessage(e);
      if (message === undefined) throw e;
      redirect(`${returnTo}${returnTo.includes('?') ? '&' : '?'}error=${encodeURIComponent(message)}`);
    }
    revalidatePath('/roles');
    revalidatePath('/members');
    redirect(returnTo);
  }
  ```
  (Added `revalidatePath('/members')` alongside the existing `revalidatePath('/roles')`, since a grant/revoke from the new `/members` roles dialog needs that page's data fresh too; revalidating a path nothing currently renders from is harmless.)

- [ ] **Step 2: Leave `src/app/roles/page.tsx`'s existing form as-is**

  No change needed — `formData.get('returnTo')` is `null` there, so the function's default (`'/roles'`) reproduces today's exact behavior. (No step 2 code change; this step is here so the task's completion doesn't silently skip verifying the old page still behaves identically.)

- [ ] **Step 3: Build check**

  Run: `npm run build`
  Expected: compiles.

- [ ] **Step 4: Commit**

  ```bash
  git add src/app/roles/actions.ts
  git commit -m "feat: let setUserRoleAction redirect back to a caller-chosen path"
  ```

---

### Task 5: Member list redesign

**Files:**
- Create: `src/app/members/member-row-dialogs.tsx`
- Modify: `src/app/members/page.tsx`
- Delete: `src/app/members/[id]/page.tsx`

**Interfaces:**
- Consumes: `Dialog`/`DialogPopup`/`DialogTitle`/`DialogClose` (Task 1), `ROLE_LABELS` (Task 2), `updateMemberAction` (Task 3, now accepting `lastContactedAt`), `setUserRoleAction` (Task 4, now accepting `returnTo`), `GRANTABLE_ROLES`/`groupRolesByUserId`/`listUserRoles` (`@/lib/roles/service`, existing), `hasAnyRole` (`@/lib/session`, existing).
- Produces: `MemberRowDialogs` component, consumed only by `src/app/members/page.tsx`.

No new tests (Global Constraints) — verified by `npm run build` and the manual `npm run dev` walkthrough in Task 7.

- [ ] **Step 1: Implement `src/app/members/member-row-dialogs.tsx`**

  A client component. Exact props:
  ```ts
  export function MemberRowDialogs(props: {
    member: User;                 // from @/db/schema
    memberRoles: Role[];
    canManageRoles: boolean;      // hasAnyRole(actor, ['admin', 'role-admin'])
    canChangeAdminRoles: boolean; // hasAnyRole(actor, ['admin'])
    openEdit: boolean;
    openRoles: boolean;
    error?: string;
  }): React.ReactElement
  ```

  Behavior:
  - `'use client'`, imports `useRouter` from `next/navigation`.
  - Renders the member's name as `<Link href={`/members?edit=${member.id}`} className="underline">{member.name || member.nickname || '—'}</Link>` (not a `DialogTrigger` — opening is a plain navigation, per spec §8).
  - A `<Dialog open={props.openEdit} onOpenChange={(open) => { if (!open) router.push('/members'); }}>` wrapping a `<DialogPopup>` containing: `<DialogTitle>{member.name || member.email}</DialogTitle>`, the `error` shown in an `<Alert variant="destructive">` when present, then a `<form action={updateMemberAction}>` with exactly the fields from the old `/members/[id]/page.tsx` "Details" card (`id` hidden, `name`, `nickname`, `phoneNumber`, `discordHandle`, `isActiveMember` checkbox, `canCreateEvents` checkbox, `membershipExpiresAt` date) **plus** a new `lastContactedAt` date field (same `type="date"` / `? ...toISOString().slice(0,10) : ''` pattern as `membershipExpiresAt` — Review Focus item 1), and a `contactNotes` textarea. Submit button "Save"; a `<Button render={<Link href="/members" />} variant="outline">Cancel</Button>` beside it (no `DialogClose` needed — `Link` already navigates, which `onOpenChange` turns into a close).
  - If `props.canManageRoles`, also renders a `<Link href={`/members?roles=${member.id}`}>` styled as a small "Roles" button, and a second `<Dialog open={props.openRoles} onOpenChange={...}>` (same close-on-false pattern) containing `<DialogTitle>Roles for {member.name || member.email}</DialogTitle>` and one tag per `GRANTABLE_ROLES` entry:
    - If the role is in `['admin', 'role-admin']` and `!props.canChangeAdminRoles`: a plain `<span>` styled as a disabled/dashed pill, text `ROLE_LABELS[role]`.
    - Otherwise: a `<form action={setUserRoleAction}>` with hidden `userId` (`member.id`), `role`, `grant` (`memberRoles.includes(role) ? 'false' : 'true'`), and `returnTo` (`` `/members?roles=${member.id}` ``), submitting a `<Button type="submit" size="sm" variant={held ? 'default' : 'outline'} className="rounded-full">{held ? '✓ ' : ''}{ROLE_LABELS[role]}</Button>`.
    - A `<Button render={<Link href="/members" />} variant="outline">Close</Button>` at the bottom.

- [ ] **Step 2: Rewrite `src/app/members/page.tsx`**

  ```tsx
  import Link from 'next/link';
  import { getDb } from '@/db';
  import { AppShell } from '@/components/app-shell';
  import { Badge } from '@/components/ui/badge';
  import { Button } from '@/components/ui/button';
  import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
  import { listMembers } from '@/lib/members/service';
  import { GRANTABLE_ROLES, groupRolesByUserId, listUserRoles } from '@/lib/roles/service';
  import { hasAnyRole, requireMemberAdmin } from '@/lib/session';
  import { syncFromStripeAction } from './actions';
  import { MemberRowDialogs } from './member-row-dialogs';

  export const dynamic = 'force-dynamic';

  type Status = 'active' | 'inactive' | 'all';
  const STATUS_TABS: { value: Status; label: string }[] = [
    { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'all', label: 'All' },
  ];

  export default async function MembersPage({
    searchParams,
  }: {
    searchParams: Promise<{
      synced?: string; created?: string; matched?: string; error?: string;
      status?: string; edit?: string; roles?: string;
    }>;
  }) {
    const admin = await requireMemberAdmin();
    const db = await getDb();
    const allMembers = await listMembers(db);
    const rolesByUserId = groupRolesByUserId(await listUserRoles(db));
    const canManageRoles = hasAnyRole(admin, ['admin', 'role-admin']);
    const canChangeAdminRoles = hasAnyRole(admin, ['admin']);
    const { synced, created, matched, error, edit, roles, status: statusRaw } = await searchParams;
    const status: Status = statusRaw === 'inactive' || statusRaw === 'all' ? statusRaw : 'active';
    const members = allMembers.filter((m) =>
      status === 'all' ? true : status === 'active' ? m.isActiveMember : !m.isActiveMember);

    return (
      <AppShell user={admin}>
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Members</h1>
          <div className="flex items-center gap-4">
            <Link href="/members/import" className="text-sm underline">Import CSV</Link>
            <form action={syncFromStripeAction}>
              <Button type="submit" variant="outline" size="sm">Sync from Stripe</Button>
            </form>
          </div>
        </div>
        {synced !== undefined && (
          <p className="mb-4 text-sm text-muted-foreground">
            Stripe sync: {created ?? 0} created, {matched ?? 0} matched, {error ?? 0} errored.
          </p>
        )}
        <div className="mb-4 flex gap-2">
          {STATUS_TABS.map((tab) => (
            <Button key={tab.value} render={<Link href={`/members?status=${tab.value}`} />}
              variant={status === tab.value ? 'default' : 'outline'} size="sm">
              {tab.label}
            </Button>
          ))}
        </div>
        <Table>
          <TableHeader>
            <TableRow><TableHead>Name</TableHead><TableHead>Email</TableHead><TableHead>Membership</TableHead><TableHead /></TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <MemberRowDialogs
                    member={m}
                    memberRoles={rolesByUserId.get(m.id) ?? []}
                    canManageRoles={canManageRoles}
                    canChangeAdminRoles={canChangeAdminRoles}
                    openEdit={edit === m.id}
                    openRoles={roles === m.id}
                    error={edit === m.id ? error : undefined}
                  />
                </TableCell>
                <TableCell>{m.email}</TableCell>
                <TableCell>
                  <Badge variant={m.isActiveMember ? 'default' : 'secondary'}>{m.isActiveMember ? 'active' : 'inactive'}</Badge>
                  {m.membershipExpiresAt && <span className="ml-2 text-muted-foreground text-sm">until {m.membershipExpiresAt.toISOString().slice(0, 10)}</span>}
                </TableCell>
                <TableCell />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </AppShell>
    );
  }
  ```

  Note what moved: the `Phone`/`Discord`/`Last contacted` columns and the `Renewal message` link are gone (into the card, and deleted, respectively, per spec §2/§6). The trailing `<TableCell />` exists so the header row's four `<TableHead>`s line up with four cells per row — `MemberRowDialogs` renders both the name trigger and (when `canManageRoles`) the "Roles" trigger together in the first cell, per Step 1.

- [ ] **Step 3: Delete `src/app/members/[id]/page.tsx`**

  ```bash
  git rm "src/app/members/[id]/page.tsx"
  ```

- [ ] **Step 4: Build check**

  Run: `npm run build`
  Expected: compiles, `/members/[id]` no longer listed among routes, `/members` still listed. This is also where Review Focus item 5 (no dangling import from the deleted page) gets caught, if there is one.

- [ ] **Step 5: Commit**

  ```bash
  git add src/app/members/page.tsx src/app/members/member-row-dialogs.tsx
  git commit -m "feat: redesign /members list with card and roles dialogs"
  ```

---

### Task 6: Apply role labels in the account menu and `/roles`

**Files:**
- Modify: `src/components/app-shell.tsx`
- Modify: `src/app/roles/page.tsx:31-32`

**Interfaces:**
- Consumes: `ROLE_LABELS` (Task 2).

- [ ] **Step 1: `src/components/app-shell.tsx`**

  Add `import { ROLE_LABELS } from '@/lib/roles/labels';`. Change `{user.roles.map((r) => <Badge key={r}>{r}</Badge>)}` to `{user.roles.map((r) => <Badge key={r}>{ROLE_LABELS[r]}</Badge>)}`.

- [ ] **Step 2: `src/app/roles/page.tsx`**

  Add the same import. Change `{GRANTABLE_ROLES.map((role) => <TableHead key={role}>{role}</TableHead>)}` to `{GRANTABLE_ROLES.map((role) => <TableHead key={role}>{ROLE_LABELS[role]}</TableHead>)}`.

- [ ] **Step 3: Build check**

  Run: `npm run build`
  Expected: compiles.

- [ ] **Step 4: Commit**

  ```bash
  git add src/components/app-shell.tsx src/app/roles/page.tsx
  git commit -m "feat: show role display labels in the account menu and /roles"
  ```

---

### Task 7: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full suite**

  Run: `npm run lint && npm test && npm run build`
  Expected: all three pass clean (no new warnings beyond the two pre-existing `<img>` warnings).

- [ ] **Step 2: Grep for orphaned imports from the deleted route**

  Run: `grep -rn "sendRenewalAskAction\|from '\.\./actions'" "src/app/members"`
  Expected: `sendRenewalAskAction` still defined (and exported) in `src/app/members/actions.ts`, no longer imported anywhere else — confirms Review Focus item 5.

- [ ] **Step 3: Manual local walkthrough**

  `npm run dev`, log in as an admin (OTP in console), on `/members`: confirm the Active/Inactive/All tabs filter correctly; click a name, edit a field (including the new "Last contacted" date), Save, confirm the dialog closes and the change persisted; trigger a validation error (e.g. an invalid phone number) and confirm the dialog reopens showing it; click "Roles" on a member, grant then revoke a role, confirm the dialog stays open/reachable across both actions and the tag's state flips; confirm the account-menu badge and the `/roles` page both show the new labels (Superadmin/Role-Manager/Member-Manager/Mapper); confirm `/members/settings` still loads by direct URL but has no link pointing to it from `/members`.

- [ ] **Step 4: Commit (only if Steps 1-3 required fixes)**

  ```bash
  git add -A
  git commit -m "fix: address final-review findings on members redesign"
  ```
