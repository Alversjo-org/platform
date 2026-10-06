# Profile Avatar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain email text in the header with a clickable avatar (photo, or initials/email-letter fallback) whose dropdown links to a new dedicated `/profile` page where any logged-in user — active member or not — can edit their personal details and upload/remove an avatar photo, server-side resized before storage.

**Architecture:** No new table — the avatar reuses BetterAuth's existing unused `user.image` text column, storing a small base64 WebP data URL. A new `sharp`-based resize module is the single place raw uploads get decoded/validated/shrunk before anything touches the database. `AppShell` (used by every page) grows a narrow, self-contained DB lookup for the three display fields it needs, so no existing call site changes.

**Tech Stack:** Next.js 16 App Router (Server Components + Server Actions), Drizzle ORM, `sharp` (new dependency), existing shadcn/`@base-ui/react` components (`DropdownMenu`, `Input`, `Button`, `Card`).

**Spec:** `docs/superpowers/specs/2026-10-06-profile-avatar-design.md`

## Global Constraints

- No new DB column or migration — the avatar is stored in the existing `user.image` text column as `data:image/webp;base64,...`.
- `MembershipExpiredError` is deleted entirely (class, its `updateOwnProfile` check, its test) — any logged-in user can edit their profile and avatar regardless of membership status. This reverses a rule from the membership-management spec; it is intentional, not a regression.
- Avatar fallback order: uploaded image → initials from `name` (first letter of each of the first two words) → first letter of `email`. `nickname` is never used for initials (only for the dropdown's text display).
- The resize pipeline is authoritative: a raw upload over 5MB is rejected before `sharp` ever touches it; whatever `sharp` produces (128×128 WebP) is what gets stored, regardless of what the client claims to have sent.
- "Remove photo" is its own action/form, separate from the main save — a save with no new file never clears the existing photo.
- Follow existing conventions: one `.test.ts` beside each lib/service module; PGlite `pglite://memory` for DB tests; server actions colocated with their page in `actions.ts`; hand-written shadcn-style components for anything new (no new UI library). Pages, actions, and presentational components are not unit-tested in this codebase — except where a Review Focus item below calls for extracting pure logic into a tested lib module specifically because of that.

## Review Focus

- A non-image or corrupted file is uploaded as an avatar — `sharp` must throw predictably, and the action must turn that into a friendly error, never a raw 500. → `avatar.test.ts` (Task 3).
- An oversized upload (well past 5MB) must be rejected *before* `sharp` ever decodes it — a cheap guard against asking the server to decode something huge. → code-level requirement in Task 5's action, verified by the manual check.
- A member with no `name` and no `nickname` (only ever logged in, never filled anything in) must still get a sensible single-letter avatar from their email, never a blank or crashing one. → `avatar-initials.test.ts` (Task 1).
- Clearing an avatar that's already `null` must be a harmless no-op, not an error. → `service.test.ts` (Task 2).
- Next.js's server-action body size limit defaults well under what a real photo needs — if it isn't raised, legitimate uploads get rejected by the framework before this app's own code (and its friendlier error message) ever runs. → Task 5's `next.config.ts` change, verified by a manual upload past 1MB.

---

### Task 1: Avatar fallback logic and presentational component

**Files:**
- Create: `src/lib/members/avatar-initials.ts`
- Create: `src/lib/members/avatar-initials.test.ts`
- Create: `src/components/ui/avatar.tsx`

**Interfaces:**
- Produces: `avatarFallbackText(name: string, email: string): string`; `Avatar` component with props `{ image: string | null; name: string; email: string; className?: string }`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/members/avatar-initials.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { avatarFallbackText } from './avatar-initials';

describe('avatarFallbackText', () => {
  it('returns initials from the first two words of a full name', () => {
    expect(avatarFallbackText('Viktor Zaunders', 'zaunders@example.org')).toBe('VZ');
  });

  it('returns a single initial for a one-word name', () => {
    expect(avatarFallbackText('Madonna', 'madonna@example.org')).toBe('M');
  });

  it('ignores extra whitespace between words', () => {
    expect(avatarFallbackText('  Viktor   Zaunders  ', 'zaunders@example.org')).toBe('VZ');
  });

  it('falls back to the first letter of the email when name is empty', () => {
    expect(avatarFallbackText('', 'zaunders@example.org')).toBe('Z');
  });

  it('falls back to the first letter of the email when name is only whitespace', () => {
    expect(avatarFallbackText('   ', 'zaunders@example.org')).toBe('Z');
  });

  it('uppercases the fallback letter', () => {
    expect(avatarFallbackText('', 'lowercase@example.org')).toBe('L');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/members/avatar-initials.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

Create `src/lib/members/avatar-initials.ts`:

```ts
/** Initials from the first two words of `name`, or the first letter of `email` if `name` is empty. */
export function avatarFallbackText(name: string, email: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 0) {
    return words.slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');
  }
  return email.charAt(0).toUpperCase();
}
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/lib/members/avatar-initials.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the Avatar component**

Create `src/components/ui/avatar.tsx`, following the same hand-written pattern as `src/components/ui/textarea.tsx` (no new UI library):

```tsx
import { cn } from "cn"
import { avatarFallbackText } from "@/lib/members/avatar-initials"

function Avatar({
  image,
  name,
  email,
  className,
}: {
  image: string | null
  name: string
  email: string
  className?: string
}) {
  return (
    <span
      data-slot="avatar"
      className={cn(
        "inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary text-xs font-medium text-primary-foreground",
        className
      )}
    >
      {image ? (
        // data: URLs aren't compatible with next/image without a custom loader; a plain <img> is correct here.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" className="size-full object-cover" />
      ) : (
        avatarFallbackText(name, email)
      )}
    </span>
  )
}

export { Avatar }
```

- [ ] **Step 6: Run lint and typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean. If lint flags the `<img>` element despite the disable comment, double-check the comment is on the line immediately above the `<img>` tag (not above the ternary) — adjust placement if needed, don't remove the comment.

- [ ] **Step 7: Commit**

```bash
git add src/lib/members/avatar-initials.ts src/lib/members/avatar-initials.test.ts src/components/ui/avatar.tsx
git commit -m "Add avatar fallback logic (initials/email letter) and the Avatar component"
```

---

### Task 2: Service layer — avatar storage, drop MembershipExpiredError

**Files:**
- Modify: `src/lib/members/service.ts`
- Modify: `src/lib/members/service.test.ts`

**Interfaces:**
- Produces: `updateOwnProfile`'s input gains an optional `image?: string` field (omitted = leave unchanged); new `clearAvatar(db: Db, id: string): Promise<void>`. `MembershipExpiredError` no longer exists.
- Consumes: nothing new from other tasks.

- [ ] **Step 1: Write the failing tests**

In `src/lib/members/service.test.ts`, replace the import line and the two tests that reference `MembershipExpiredError`:

```ts
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { createDb, schema, type Db } from '@/db';
import {
  clearAvatar, InvalidPhoneError, listMembers, touchLastContacted, updateMember, updateOwnProfile, UserNotFoundError,
} from './service';
```

Replace the existing `'updateOwnProfile refuses to edit a profile that is not currently active, even if someone posts the form directly'` test with:

```ts
  it('updateOwnProfile succeeds even for a member who is not currently active', async () => {
    // viktor is never made active in this test: isActiveMember defaults to false.
    const updated = await updateOwnProfile(db, { id: 'viktor', name: 'Vik', nickname: null, phoneNumber: null, discordHandle: null });
    expect(updated.name).toBe('Vik');
  });

  it('updateOwnProfile sets the image when provided', async () => {
    const updated = await updateOwnProfile(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null, image: 'data:image/webp;base64,AAAA',
    });
    expect(updated.image).toBe('data:image/webp;base64,AAAA');
  });

  it('updateOwnProfile leaves the image unchanged when not provided', async () => {
    await updateOwnProfile(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null, image: 'data:image/webp;base64,AAAA',
    });
    const updated = await updateOwnProfile(db, { id: 'viktor', name: 'Viktor Andersson', nickname: null, phoneNumber: null, discordHandle: null });
    expect(updated.image).toBe('data:image/webp;base64,AAAA');
  });

  it('clearAvatar sets the image back to null', async () => {
    await updateOwnProfile(db, {
      id: 'viktor', name: 'Viktor', nickname: null, phoneNumber: null, discordHandle: null, image: 'data:image/webp;base64,AAAA',
    });
    await clearAvatar(db, 'viktor');
    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, 'viktor'));
    expect(row.image).toBeNull();
  });

  it('clearAvatar on a member with no image is a harmless no-op', async () => {
    await expect(clearAvatar(db, 'viktor')).resolves.toBeUndefined();
    const [row] = await db.select().from(schema.user).where(eq(schema.user.id, 'viktor'));
    expect(row.image).toBeNull();
  });
```

(Leave every other existing test in the file untouched.)

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/members/service.test.ts`
Expected: FAIL — `clearAvatar` doesn't exist, `image` isn't a valid field, and the old `MembershipExpiredError`-based test (now deleted) is gone, but the new "succeeds even for..." test currently still throws.

- [ ] **Step 3: Implement**

In `src/lib/members/service.ts`:

1. Remove the `import { isActiveNow } from './status';` line (no longer used).
2. Remove the `MembershipExpiredError` class entirely.
3. Replace `updateOwnProfile` and add `clearAvatar`:

```ts
/** Self-service edit: any logged-in user can set their own name/nickname/phone/Discord/avatar, nothing membership-related. */
export async function updateOwnProfile(
  db: Db,
  input: { id: string; name: string; nickname: string | null; phoneNumber: string | null; discordHandle: string | null; image?: string },
): Promise<User> {
  checkPhone(input.phoneNumber);
  const [row] = await db
    .update(schema.user)
    .set({
      name: input.name, nickname: input.nickname, phoneNumber: input.phoneNumber, discordHandle: input.discordHandle,
      ...(input.image !== undefined ? { image: input.image } : {}),
    })
    .where(eq(schema.user.id, input.id))
    .returning();
  if (!row) throw new UserNotFoundError(input.id);
  return row;
}

export async function clearAvatar(db: Db, id: string): Promise<void> {
  await db.update(schema.user).set({ image: null }).where(eq(schema.user.id, id));
}
```

The file's existing `UserNotFoundError`/`InvalidPhoneError` classes, `checkPhone`, `listMembers`, `updateMember`, and `touchLastContacted` are all unchanged.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/members/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Fix the one remaining caller**

`src/app/actions.ts`'s `updateProfileAction` currently imports `MembershipExpiredError` and catches it alongside `InvalidPhoneError`. Task 6 (later in this plan) replaces this whole file, but leaving the reference dangling until then would break the build in between. Fix it now with a minimal edit — remove `MembershipExpiredError` from the import list and drop just the `|| e instanceof MembershipExpiredError` clause from the `catch` block's `if`, leaving the rest of `src/app/actions.ts` (including `updateProfileAction` itself) untouched for now:

```ts
import { InvalidPhoneError, UserNotFoundError, updateOwnProfile } from '@/lib/members/service';
```

```ts
    if (e instanceof InvalidPhoneError) {
      redirect(`/?error=${encodeURIComponent(e.message)}`);
    }
```

- [ ] **Step 6: Confirm nothing else references the deleted error, and the build is clean**

Run: `grep -rn "MembershipExpiredError" src`
Expected: no matches.

Run: `npx vitest run && npx tsc --noEmit`
Expected: both clean — `src/app/actions.ts` still compiles and its own behavior for `updateProfileAction` is otherwise unchanged at this point in the plan.

- [ ] **Step 7: Commit**

```bash
git add src/lib/members/service.ts src/lib/members/service.test.ts src/app/actions.ts
git commit -m "Let updateOwnProfile store an avatar image; drop MembershipExpiredError entirely"
```

---

### Task 3: Server-side resize pipeline

**Files:**
- Create: `src/lib/members/avatar.ts`
- Create: `src/lib/members/avatar.test.ts`
- Modify: `package.json` (new dependency)

**Interfaces:**
- Produces: `resizeAvatar(buffer: Buffer): Promise<string>` — returns a `data:image/webp;base64,...` string, or throws for undecodable input.

- [ ] **Step 1: Add the dependency**

Run: `npm install sharp`
Expected: `package.json`/`package-lock.json` gain a `sharp` entry.

- [ ] **Step 2: Write the failing test**

Create `src/lib/members/avatar.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { resizeAvatar } from './avatar';

describe('resizeAvatar', () => {
  it('returns a small 128x128 WebP data URL for a valid image', async () => {
    const input = await sharp({
      create: { width: 800, height: 600, channels: 3, background: { r: 10, g: 200, b: 80 } },
    }).png().toBuffer();

    const result = await resizeAvatar(input);
    expect(result).toMatch(/^data:image\/webp;base64,[A-Za-z0-9+/]+=*$/);

    const base64 = result.slice('data:image/webp;base64,'.length);
    const bytes = Buffer.from(base64, 'base64');
    expect(bytes.length).toBeLessThan(20_000);

    const meta = await sharp(bytes).metadata();
    expect(meta).toMatchObject({ width: 128, height: 128, format: 'webp' });
  });

  it('throws for input that is not a decodable image', async () => {
    await expect(resizeAvatar(Buffer.from('not an image'))).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/members/avatar.test.ts`
Expected: FAIL — module `./avatar` does not exist.

- [ ] **Step 4: Implement**

Create `src/lib/members/avatar.ts`:

```ts
import sharp from 'sharp';

const AVATAR_SIZE = 128;

/** Decodes, crops-to-square and resizes an uploaded image, returning it as a small WebP data URL ready to store. Throws for anything sharp cannot decode. */
export async function resizeAvatar(buffer: Buffer): Promise<string> {
  const resized = await sharp(buffer)
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
    .webp({ quality: 80 })
    .toBuffer();
  return `data:image/webp;base64,${resized.toString('base64')}`;
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/lib/members/avatar.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/members/avatar.ts src/lib/members/avatar.test.ts
git commit -m "Add sharp-based avatar resize pipeline: decode, crop to square, re-encode as small WebP"
```

---

### Task 4: Header avatar + dropdown

**Files:**
- Modify: `src/components/app-shell.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 1); `DropdownMenu`/`DropdownMenuTrigger`/`DropdownMenuContent`/`DropdownMenuItem`/`DropdownMenuSeparator` (already exist, unused until now); `isMemberAdmin` (`@/lib/session`, unchanged).
- Produces: no new exports — `AppShell`'s prop type (`{ user: SessionUser; children: React.ReactNode }`) is unchanged, so no other file needs to change. `AppShell` itself becomes `async` (Next.js Server Components support this natively — no caller needs to change how it's used).

- [ ] **Step 1: Replace the component**

Replace `src/components/app-shell.tsx`:

```tsx
import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { getDb, schema } from '@/db';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Separator } from '@/components/ui/separator';
import { isMemberAdmin, type SessionUser } from '@/lib/session';

export async function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const db = await getDb();
  const [profile] = await db
    .select({ name: schema.user.name, nickname: schema.user.nickname, image: schema.user.image })
    .from(schema.user)
    .where(eq(schema.user.id, user.id));
  const name = profile?.name ?? '';
  const image = profile?.image ?? null;
  const displayName = profile?.nickname || name || user.email;

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="space-y-2">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold">Alversjö</Link>
          <DropdownMenu>
            <DropdownMenuTrigger className="rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Avatar image={image} name={name} email={user.email} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <div className="flex items-center gap-2 px-1.5 py-1.5">
                <Avatar image={image} name={name} email={user.email} className="size-10 text-sm" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{displayName}</p>
                  <p className="truncate text-xs text-muted-foreground">{user.email}</p>
                </div>
              </div>
              {user.role !== 'member' && <div className="px-1.5 py-1"><Badge>{user.role}</Badge></div>}
              <DropdownMenuSeparator />
              <DropdownMenuItem render={<Link href="/profile" />}>Edit profile</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <nav className="flex items-center gap-4">
          <Link href="/boxes" className="text-sm text-muted-foreground hover:text-foreground">Boxes</Link>
          {isMemberAdmin(user) && <Link href="/members" className="text-sm text-muted-foreground hover:text-foreground">Members</Link>}
        </nav>
      </header>
      <Separator className="my-4" />
      <main>{children}</main>
    </div>
  );
}
```

- [ ] **Step 2: Run the full test suite, lint, and typecheck**

Run: `npx vitest run && npm run lint && npx tsc --noEmit`
Expected: all clean. No test file exercises `AppShell` directly (it's a presentational component, per convention), but every existing page's own tests/build must still pass since `AppShell` is used everywhere.

- [ ] **Step 3: Run the build**

Run: `npm run build`
Expected: succeeds. This is the first real check that an `async` Server Component passed as `<AppShell user={...}>` from every existing page (`/`, `/boxes`, `/boxes/[id]`, `/boxes/new`, `/members`, `/members/[id]`, `/members/import`, `/members/settings`) still compiles with no caller changes.

- [ ] **Step 4: Manual check**

Run: `npm run dev`. Log in, confirm the header shows a circular avatar (initials, since no photo exists yet) instead of the email text, and clicking it opens a dropdown showing name/email/role badge and an "Edit profile" link (which will 404 until Task 5 lands — that's expected for now).

- [ ] **Step 5: Commit**

```bash
git add src/components/app-shell.tsx
git commit -m "Replace the header's email text with an avatar + identity dropdown"
```

---

### Task 5: `/profile` page, actions, and the upload size limit

**Files:**
- Modify: `next.config.ts`
- Create: `src/app/profile/page.tsx`
- Create: `src/app/profile/actions.ts`

**Interfaces:**
- Consumes: `resizeAvatar` (Task 3); `updateOwnProfile`, `clearAvatar`, `InvalidPhoneError` (Task 2); `requireUser` (`@/lib/session`, unchanged); `AppShell` (Task 4).
- Produces: `updateProfileAction(formData)`, `removeAvatarAction()` — not consumed by any later task.

- [ ] **Step 1: Raise the server action body size limit**

In `next.config.ts`, check the installed Next.js version's `NextConfig` type (hover/autocomplete in your editor, or read `node_modules/next/dist/server/config-shared.d.ts`) for where the server-action request body size limit currently lives — in recent Next versions this is `experimental.serverActions.bodySizeLimit`. Add it set to `'5mb'`, matching this plan's upload ceiling:

```ts
const nextConfig: NextConfig = {
  // ...existing config unchanged...
  experimental: {
    serverActions: { bodySizeLimit: '5mb' },
  },
};
```

If the installed version has moved this setting out of `experimental` (i.e. it's now a stable top-level key), use that location instead and note what you found in your report.

- [ ] **Step 2: Add the profile page**

Create `src/app/profile/page.tsx`:

```tsx
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requireUser } from '@/lib/session';
import { removeAvatarAction, updateProfileAction } from './actions';

export const dynamic = 'force-dynamic';

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const sessionUser = await requireUser();
  const { error } = await searchParams;
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, sessionUser.id));

  return (
    <AppShell user={sessionUser}>
      {error && <Alert variant="destructive" className="mb-4"><AlertDescription>{error}</AlertDescription></Alert>}
      <Card className="max-w-md">
        <CardHeader><CardTitle>Edit profile</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center gap-4">
            <Avatar image={member.image ?? null} name={member.name} email={member.email} className="size-16 text-lg" />
            {member.image && (
              <form action={removeAvatarAction}>
                <Button type="submit" variant="outline" size="sm">Remove photo</Button>
              </form>
            )}
          </div>
          <form action={updateProfileAction} className="space-y-4">
            <div className="space-y-2"><Label htmlFor="avatar">Photo</Label><Input id="avatar" name="avatar" type="file" accept="image/*" /></div>
            <div className="space-y-2"><Label htmlFor="name">Name</Label><Input id="name" name="name" defaultValue={member.name} /></div>
            <div className="space-y-2"><Label htmlFor="nickname">Nickname</Label><Input id="nickname" name="nickname" defaultValue={member.nickname ?? ''} /></div>
            <div className="space-y-2"><Label htmlFor="phoneNumber">Phone number</Label><Input id="phoneNumber" name="phoneNumber" type="tel" placeholder="+46701234567" defaultValue={member.phoneNumber ?? ''} /></div>
            <div className="space-y-2"><Label htmlFor="discordHandle">Discord handle</Label><Input id="discordHandle" name="discordHandle" defaultValue={member.discordHandle ?? ''} /></div>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 3: Add the actions**

Create `src/app/profile/actions.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import { resizeAvatar } from '@/lib/members/avatar';
import { clearAvatar, InvalidPhoneError, UserNotFoundError, updateOwnProfile } from '@/lib/members/service';
import { requireUser } from '@/lib/session';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export async function updateProfileAction(formData: FormData) {
  const user = await requireUser();
  const phoneRaw = String(formData.get('phoneNumber') ?? '').trim();

  const avatarFile = formData.get('avatar');
  let image: string | undefined;
  if (avatarFile instanceof File && avatarFile.size > 0) {
    if (avatarFile.size > MAX_AVATAR_BYTES) {
      redirect(`/profile?error=${encodeURIComponent('Image is too large (max 5MB)')}`);
    }
    try {
      image = await resizeAvatar(Buffer.from(await avatarFile.arrayBuffer()));
    } catch {
      redirect(`/profile?error=${encodeURIComponent('Could not process that image')}`);
    }
  }

  try {
    await updateOwnProfile(await getDb(), {
      id: user.id,
      name: String(formData.get('name') ?? '').trim(),
      nickname: String(formData.get('nickname') ?? '').trim() || null,
      phoneNumber: phoneRaw === '' ? null : phoneRaw,
      discordHandle: String(formData.get('discordHandle') ?? '').trim() || null,
      ...(image !== undefined ? { image } : {}),
    });
  } catch (e) {
    if (e instanceof InvalidPhoneError) redirect(`/profile?error=${encodeURIComponent(e.message)}`);
    throw e;
  }
  redirect('/profile');
}

export async function removeAvatarAction() {
  const user = await requireUser();
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, user.id));
  if (!member) throw new UserNotFoundError(user.id);
  await clearAvatar(db, user.id);
  redirect('/profile');
}
```

- [ ] **Step 4: Run the full test suite, lint, typecheck, and build**

Run: `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`
Expected: all clean.

- [ ] **Step 5: Manual check**

Run: `npm run dev`. Log in, go to `/profile` (directly, or via the header dropdown's "Edit profile" link now that it resolves). Upload a real photo a few hundred KB to a few MB in size — confirm it's accepted (not rejected by Next's body size limit before your own code runs), saves, and the header's avatar updates to show it. Click "Remove photo" and confirm it reverts to initials. Try uploading a non-image file (e.g. rename a `.txt` to `.png`) and confirm you get the friendly "Could not process that image" message, not a crash page.

- [ ] **Step 6: Commit**

```bash
git add next.config.ts src/app/profile
git commit -m "Add the /profile page: edit personal details and upload/remove an avatar photo"
```

---

### Task 6: Remove the inline profile form from the homepage

**Files:**
- Modify: `src/app/page.tsx`
- Modify: `src/app/actions.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `src/app/actions.ts` keeps only `startCheckoutAction` — no later task depends on this file's other exports.

- [ ] **Step 1: Trim the homepage**

Replace `src/app/page.tsx`:

```tsx
import { eq } from 'drizzle-orm';
import { getDb, schema } from '@/db';
import { AppShell } from '@/components/app-shell';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { isActiveNow, needsPayment } from '@/lib/members/status';
import { requireUser } from '@/lib/session';
import { startCheckoutAction } from './actions';

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
      {checkout === 'success' && <Alert className="mb-4"><AlertDescription>Payment received — your membership will update shortly.</AlertDescription></Alert>}
      <Card className="max-w-md">
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
            </div>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
```

- [ ] **Step 2: Trim the homepage's actions**

Replace `src/app/actions.ts`:

```ts
'use server';

import { eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';
import { getDb, schema } from '@/db';
import { UserNotFoundError } from '@/lib/members/service';
import { requireUser } from '@/lib/session';
import { createCheckoutSession, type MembershipPlan } from '@/lib/stripe/checkout';
import { getStripe } from '@/lib/stripe/client';

const VALID_PLANS: readonly MembershipPlan[] = ['yearly', 'monthly'];

function isMembershipPlan(value: string): value is MembershipPlan {
  return (VALID_PLANS as readonly string[]).includes(value);
}

export async function startCheckoutAction(formData: FormData) {
  const sessionUser = await requireUser();
  const planRaw = String(formData.get('plan') ?? '');
  if (!isMembershipPlan(planRaw)) {
    redirect(`/?error=${encodeURIComponent(`Unknown membership plan: ${planRaw}`)}`);
  }
  const plan = planRaw;
  const db = await getDb();
  const [member] = await db.select().from(schema.user).where(eq(schema.user.id, sessionUser.id));
  if (!member) throw new UserNotFoundError(sessionUser.id);
  const platformUrl = process.env.PLATFORM_URL ?? 'http://localhost:3000';
  const url = await createCheckoutSession(getStripe(), { plan, user: member, platformUrl });
  redirect(url);
}
```

- [ ] **Step 3: Run the full test suite, lint, typecheck, and build**

Run: `npx vitest run && npm run lint && npx tsc --noEmit && npm run build`
Expected: all clean. Confirm no remaining reference to `updateProfileAction`, `InvalidPhoneError`, or `MembershipExpiredError` in `src/app/actions.ts` or `src/app/page.tsx`.

- [ ] **Step 4: Manual check**

Run: `npm run dev`. Confirm `/` now shows only the Membership card (status + payment buttons, no "Your profile" card) for both an active and an expired/non-member account, and that editing personal details only works from `/profile`.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx src/app/actions.ts
git commit -m "Remove the inline profile form from the homepage — editing now lives solely on /profile"
```

---

## After all tasks

Run the whole suite once more (`npx vitest run`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `npm run db:check`) and open a PR per `CLAUDE.md` — never push to `main`.
