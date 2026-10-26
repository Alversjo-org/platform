# Role management design

## 1. Summary

Replaces the single `role` enum column on `user` (`'member' | 'member-admin' | 'admin'`)
with a many-to-many roles model: a new `user_role` table, so a person can hold
any combination of roles at once instead of exactly one. This is driven by
roles already in sight that don't fit a linear hierarchy — `mapper` (manage
areas), and later `makerspace-admin` (tool access codes) and `resident`
(building access) — plus a request for a role that can grant other roles
without being a full `admin`.

This pass builds the general mechanism, migrates today's `admin` and
`member-admin` into it unchanged, and adds two new roles: `mapper` (wired to
the existing areas/map feature) and `role-admin` (can grant/revoke roles,
nothing else). It does not build `makerspace-admin` or `resident` — neither
has a feature to attach permissions to yet (no tool-access-codes system, no
defined resident capabilities). Adding either later is a small follow-up:
one new string in the `Role` union, a migration, and whatever check the new
feature needs — the same amount of work adding `mapper` is in this pass.

Out of scope: a no-code/admin-configurable permission builder (roles stay a
fixed set defined in code, same as today's enum — a new role is already a
code change because it always comes with a new feature to gate); row-level
security / DB policies (confirmed not needed — every query already goes
through one trusted server-side connection, gated by application code before
the query runs, never reached directly by an untrusted client); `resident`
and `makerspace-admin` themselves.

## 2. Roles

| Role | Can do | Granted by |
|---|---|---|
| *(no roles)* | Plain member: own homepage/profile, pay via Stripe | — (default) |
| `mapper` | Everything a member can, plus `/areas` — create/edit areas, edit grid cells | `admin` or `role-admin` |
| `member-admin` | Everything a member can, plus `/members` directory, CSV import, renewal asks, event sign-up override | `admin` or `role-admin` |
| `role-admin` | Everything a member can, plus the `/roles` page: grant/revoke `mapper` and `member-admin` on anyone | `admin` only |
| `admin` | Everything, including `/boxes` fleet management, and granting any role including `admin`/`role-admin` | `admin` only |

A user can hold several of these at once (e.g. `member-admin` + `mapper`).
`admin` is not stored as "has every other role" — it's checked for
explicitly alongside the specific role at every gate (see §4), the same way
`isMemberAdmin()` already checks for `admin` or `member-admin` today.

**`role-admin` cannot grant `admin` or `role-admin`.** It can hand out
`mapper` and `member-admin` freely, but promoting someone to `admin` or
`role-admin` requires already being `admin` — otherwise a `role-admin` could
mint more `role-admin`s (including themselves gaining full `admin` by a
different route) and the "not every possible permission" boundary the whole
role would stop meaning anything. This is enforced in the grant action
(§5), not just the UI.

## 3. Data model

```ts
export type Role = 'admin' | 'member-admin' | 'mapper' | 'role-admin';

export const userRole = pgTable(
  'user_role',
  {
    userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'member-admin', 'mapper', 'role-admin'] }).$type<Role>().notNull(),
    // Null for the one-time ADMIN_EMAILS bootstrap grant (§6), which has no human granter.
    grantedByUserId: text('granted_by_user_id').references(() => user.id),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.role] })],
);
```

Same shape as the existing `boxAccess` join table, except `grantedByUserId`
is nullable here (that table's equivalent column is `.notNull()` — every box
grant today has a human granter; the admin bootstrap doesn't).

The `role` column is dropped from `user`. "Member" is no longer a stored
value — it's the absence of any `user_role` row.

## 4. Authorization helpers

`src/lib/session.ts`:

```ts
export type SessionUser = { id: string; email: string; roles: Role[] };

export function hasAnyRole(user: SessionUser, roles: Role[]): boolean {
  return roles.some((r) => user.roles.includes(r));
}

export async function requireAnyRole(roles: Role[]): Promise<SessionUser> {
  const u = await requireUser();
  if (!hasAnyRole(u, roles)) redirect('/');
  return u;
}

export const requireAdmin = () => requireAnyRole(['admin']);
export const requireMemberAdmin = () => requireAnyRole(['admin', 'member-admin']);
export const requireMapper = () => requireAnyRole(['admin', 'mapper']);
export const requireRoleAdmin = () => requireAnyRole(['admin', 'role-admin']);
```

`getSessionUser()` fetches `roles` with a query against `user_role` for the
session's user id, alongside the existing BetterAuth session lookup.

Named wrappers (`requireAdmin`, `requireMemberAdmin`, ...) are kept, each
built on the shared `requireAnyRole` — call sites don't change shape, and
`admin` can't be left out of a new gate's list by accident the way a
freestanding per-site check could.

Every current call site keeps its existing gate **except** areas. This
touches every place that reads `user.role` directly, not just the
`requireX()` call sites — `SessionUser.role: Role` becomes
`SessionUser.roles: Role[]`, so anything doing `user.role === 'admin'`
breaks at the type level and needs to become `hasAnyRole(user, ['admin'])`:

- `src/app/boxes/**` and `src/lib/boxes/access.ts` — stay admin-only, but
  three spots currently check `user.role === 'admin'` directly instead of
  going through a named helper and need updating to `hasAnyRole`:
  `canAccessBox()`/`listBoxesFor()` in `src/lib/boxes/access.ts` (also
  update `AccessUser` from `{ role: Role }` to `{ roles: Role[] }`), the
  inline `isAdmin` check in `src/app/boxes/[id]/page.tsx`, and the "New box"
  button visibility check in `src/app/boxes/page.tsx`.
- `src/app/members/**`, `src/app/members/actions.ts` — stays `requireMemberAdmin()`.
- `src/app/areas/**`, `src/app/areas/[id]/cells/**` — changes from
  `requireMemberAdmin()` to `requireMapper()`.
- `src/lib/projects/authorization.ts` (`getEventRole` member-admin override)
  — unchanged, still keyed on `admin`/`member-admin`.
- `src/components/app-shell.tsx` nav — "Areas" link visibility switches from
  `isMemberAdmin` to `hasAnyRole(['admin', 'mapper'])`; new "Roles" link
  visible under `hasAnyRole(['admin', 'role-admin'])`. The account-menu role
  badge (currently one `<Badge>{user.role}</Badge>`) renders one badge per
  entry in `user.roles` instead.
- `src/app/api/internal/box-session/route.ts` — resolves role a different
  way than every other call site: it builds its own session from a raw
  cookie header (not through `getSessionUser()`, which reads `headers()`
  from the Next.js request context this route doesn't have), then reads
  `session.user.role` directly and calls `roleFromRaw`. Both of those
  disappear with the column. `session.ts` exports a `rolesFor(db, userId):
  Promise<Role[]>` helper (the query `getSessionUser()` now runs against
  `user_role` internally) for this route to call directly with
  `session.user.id`. `roleFromRaw` is deleted (nothing else uses it).

`isMemberAdmin(user)` is kept as a thin wrapper over the same roles the
array now carries (`hasAnyRole(user, ['admin', 'member-admin'])`), for the
same reason the `requireX` wrappers are kept.

## 5. Role management page (`/roles`)

Gated by `requireRoleAdmin()`. Lists every member (reusing `listMembers`)
with a checkbox per grantable role (`member-admin`, `mapper`, plus
`admin`/`role-admin` rendered read-only/disabled unless the acting user is
`admin`). One server action, `setUserRoleAction(userId, role, grant: boolean)`:

```ts
export async function setUserRoleAction(formData: FormData) {
  const actor = await requireRoleAdmin();
  const targetId = String(formData.get('userId'));
  const role = String(formData.get('role')) as Role;
  const grant = formData.get('grant') === 'true';

  if ((role === 'admin' || role === 'role-admin') && !hasAnyRole(actor, ['admin'])) {
    redirect('/roles?error=' + encodeURIComponent('Only an admin can change this role'));
  }
  if (grant) {
    await db.insert(schema.userRole).values({ userId: targetId, role, grantedByUserId: actor.id }).onConflictDoNothing();
  } else {
    await db.delete(schema.userRole).where(and(eq(schema.userRole.userId, targetId), eq(schema.userRole.role, role)));
  }
  await logDecision(db, { entity: 'user_role', entityId: targetId, actorUserId: actor.id, action: grant ? 'grant' : 'revoke', diff: { role } });
  revalidatePath('/roles');
  redirect('/roles');
}
```

No self-protection beyond the check above (e.g. nothing stops an `admin`
removing their own `admin` role) — same trust level the single `admin` role
already implies today; not a new risk this pass introduces.

## 6. Bootstrap and migration

`ADMIN_EMAILS` still seeds the first `admin`, but moves from `user.create`'s
`before` hook (which only sets fields on the row being inserted) to an
`after` hook, since it now needs to insert into a second table that
references the just-created user's id:

```ts
databaseHooks: {
  user: {
    create: {
      after: async (u) => {
        if (adminEmails().includes(u.email.toLowerCase())) {
          await db.insert(schema.userRole).values({ userId: u.id, role: 'admin', grantedByUserId: null });
        }
      },
    },
  },
},
```

`additionalFields.role` is removed from the BetterAuth config — `role` is no
longer a `user` column.

**Data migration** (one `drizzle-kit generate` migration, hand-edited to
carry data — there's no existing data-carrying migration in this repo to
copy from, so this is written from scratch, not adapted from a precedent):

1. Create `user_role`.
2. Backfill: every `user` with `role = 'admin'` → insert `{role: 'admin'}`.
   Every `user` with `role = 'member-admin'` → insert **both**
   `{role: 'member-admin'}` and `{role: 'mapper'}` — grandfathering existing
   member-admins into area access they have today, so shipping this doesn't
   silently lock anyone out of `/areas`. This is a one-time backfill, not an
   ongoing rule: a member-admin promoted after this migration does not
   automatically get `mapper`.
3. Drop `user.role`.

## 7. Testing

Following the existing layout (`.test.ts` beside the module, PGlite for
anything hitting the DB):

- `hasAnyRole`/`requireAnyRole`: matches on any listed role, denies when none
  match, `admin` always satisfies a gate it isn't explicitly in (via the
  named wrappers including it).
- `/roles` action: a `role-admin` can grant/revoke `mapper` and
  `member-admin`; a `role-admin` is rejected granting `admin` or
  `role-admin`; an `admin` can grant any role including `admin`; a plain
  member is rejected outright; each successful change writes a
  `decisionLog` row.
- `/areas` and `/areas/[id]/cells`: a `mapper`-only user (no `member-admin`)
  can reach them; a `member-admin`-only user created *after* migration
  (i.e. without `mapper`) cannot.
- Migration backfill, reviewed by inspecting the generated SQL (consistent
  with how the existing CI `db:check` gate already verifies migrations match
  schema — not a new automated test class).

## 8. Follow-ups (not this pass)

- `makerspace-admin`: add `'makerspace-admin'` to the `Role` union, a
  migration, and whichever tool-access-codes feature needs the check — no
  change to the mechanism in §4/§5.
- `resident`: same pattern, once its actual capabilities are defined.
