# Alversjö platform v0 — design

Date: 2026-09-15. Status: approved in brainstorming, revised the same day after
verifying CloudCLI, GitHub and Fly constraints. Implementation plans live in
`docs/superpowers/plans/` of each repo.

## 1. Purpose

Give Alversjö a browser-based control plane for cloud development machines
("boxes") and the first slice of the membership platform's identity layer.
v0 does **not** store memberships or talk to Stripe. It does three things:

1. Lets anyone log in with an email address and a six-digit code.
2. Lets admins create, start, stop, destroy and share boxes.
3. Lets anyone with access open a box's CloudCLI session in the browser,
   through the platform, with no second login.

4. Manages the `alversjo.land` DNS zone with dnscontrol, from a repo and
   from admin boxes.

Everything else from the original discussion (membership import, Stripe,
Borderland map hosting, per-service templates) is explicitly out of scope
and must not leak into v0.

## 2. Repos and Fly apps

| Thing | Name | Role |
|---|---|---|
| GitHub repo | `Alversjo-org/box` (renamed from `admin-box`) | Docker image every box runs |
| GitHub repo | `Alversjo-org/platform` | Next.js control plane, this spec |
| GitHub repo | `Alversjo-org/infrastructure` | `dnsconfig.js` for `alversjo.land` (pushed by CI with dnscontrol); later any other infra config |
| Fly app | `alversjo-platform` | Runs the platform, one machine, attached Fly Postgres |
| Fly app | `alversjo-boxes` | Holds every box as one machine plus one volume |
| Fly app | `alversjo-admin-box` | **Deleted** once the admin box is recreated inside `alversjo-boxes` |

A Fly *app* is a namespace with a config, secrets, private DNS and any number
of *machines*. Keeping boxes in their own app means platform deploys never
touch running boxes, and the proxy reaches any box at
`<machine-id>.vm.alversjo-boxes.internal` over the org's private network.

All three repos are **public**. Nothing secret is ever committed to them;
public visibility is what makes GitHub branch protection available on the
free org plan (see §3, contributor profile).

Rule inherited from the box repo: every change to any repo is committed
and pushed immediately.

### 2.1 Domain and DNS

Domain: `alversjo.land`, zone on Cloudflare (free plan, account "Alversjö",
already active, currently a wildcard pointing at the old Hostpoint host plus
Resend DKIM records). Records are managed only through dnscontrol, never by
hand in the Cloudflare UI.

| Name | Record | Purpose |
|---|---|---|
| `members.alversjo.land` | A + AAAA to the platform's Fly IPs | the platform (membership site) |
| `*.boxes.alversjo.land` | A + AAAA to the same Fly IPs | one hostname per box, e.g. `<box-id>.boxes.alversjo.land` |
| `_acme-challenge.boxes.alversjo.land` | CNAME to the target `fly certs add` prints | DNS-01 validation for the wildcard cert |
| `_acme-challenge.members.alversjo.land` | CNAME likewise | validation for the platform cert |

All Fly-facing records are DNS-only (not Cloudflare-proxied), because Fly
terminates TLS. The platform app gets a **dedicated IPv4** (about 2 USD per
month) since wildcard certificates on Fly's shared IPv4 are not documented as
supported. Fly issues the wildcard certificate `*.boxes.alversjo.land`
(about 2 USD per month).

The `infrastructure` repo holds `dnsconfig.js` and a `creds.json` that reads the token
from the env var `CLOUDFLARE_API_TOKEN`. CI on `main` runs
`dnscontrol push`; pull requests run `dnscontrol preview`. The Cloudflare
token is an account-owned token with DNS edit rights on the zone, so
`creds.json` also carries the Cloudflare account id (not secret).

## 3. Box image (`Alversjo-org/box`)

Builds on the existing Dockerfile (Debian, pinned flyctl, gh, Node, Claude
Code). Additions:

- **CloudCLI** (`@cloudcli-ai/cloudcli`, pinned, 1.37.3 at time of writing)
  installed globally. `CLAUDE_CLI_PATH` points at the system `claude`.
- **dnscontrol** (pinned binary) so admin boxes can preview and push DNS
  from a clone of the `infrastructure` repo.
- **Superpowers** plugin preinstalled at build time with
  `claude plugin marketplace add anthropics/claude-plugins-official` and
  `claude plugin install superpowers@claude-plugins-official` (both work
  without login), so every Claude session on a box has it.
- **Two profiles**, chosen by env var `BOX_PROFILE=admin|contributor`.
  The entrypoint copies `profiles/<profile>/CLAUDE.md` to `/work/CLAUDE.md`
  on every boot. The admin profile allows anything. The contributor profile
  instructs Claude to work on branches and open PRs, never push to `main`.
- **Entrypoint** keeps today's never-crash-loop behaviour, then starts
  CloudCLI bound to the machine's private IPv6 (`fly-local-6pn`) on port
  8080 with `JWT_SECRET`, `DATABASE_PATH=/work/.cloudcli/auth.db`,
  `WORKSPACES_ROOT=/work`. On first boot it registers one CloudCLI user
  (`box` / random password, never needed again) so JWT mode has a user row.
  SSH via `fly ssh console` keeps working as a fallback.
- **No public services.** The image never exposes a port to the internet.

Secrets are never in the image. They arrive as machine env at creation:

| Env | admin | contributor | Purpose |
|---|---|---|---|
| `CLAUDE_CODE_OAUTH_TOKEN` | yes | yes | Claude Code |
| `GH_TOKEN` | full org token | fine-grained token: contents read, pull requests write, no `main` push | gh + git |
| `FLY_API_TOKEN` | yes | no | operate the Fly org |
| `RESEND_API_KEY` | yes | no | needed to run the platform locally |
| `CLOUDFLARE_API_TOKEN` | yes | no | dnscontrol against `alversjo.land` |
| `JWT_SECRET` | yes | yes | per-box, generated by the platform |
| `BOX_PROFILE` | `admin` | `contributor` | profile selection |

"No push to `main`" is enforced by branch protection ("require a pull
request before merging", not enforced for admins) on all three public
repos. A personal token acts as its owner, and org owners bypass protection,
so the contributor token **must belong to a non-owner bot account**
(`alversjo-contributor`, an org member with write access to the repos).
Creating that account and its fine-grained token is a manual step. The
prompt in CLAUDE.md is a courtesy, not the control.

Contributor boxes can run the platform locally against PGlite, so they need
no Postgres and no extra services.

## 4. Platform app (`Alversjo-org/platform`)

### 4.1 Stack

- Next.js 16 (App Router, TypeScript), deployed as a single Fly machine
  behind a custom Node server (`server.ts`) so WebSocket upgrades can be
  proxied. `proxy.ts` (Next 16's name for middleware) handles session gating.
- UI built entirely with **shadcn/ui** on Tailwind CSS, with **Base UI**
  (`@base-ui/react`, by the MUI team and Radix's original authors) as the
  primitive layer, which is shadcn's default since July 2026. Every form,
  table, dialog and button is a shadcn component or composed from them. No
  Radix, no second component library, no hand-rolled equivalents of things
  shadcn provides.
- BetterAuth 1.7 with the **email OTP** plugin. Six-digit code, sent through
  Resend from `notifications.alversjo.land` (verified in Resend; its DNS records are in the zone). Cookies are set for
  `.alversjo.land` via `advanced.crossSubDomainCookies` so a session made on
  `members.alversjo.land` is valid on `<box>.boxes.alversjo.land`.
- Drizzle ORM. Same schema for Fly Postgres (prod) and PGlite (dev boxes).
  `DATABASE_URL` decides: `postgres://...` uses the pg driver, unset or
  `pglite://<path>` uses the PGlite driver with a file under `/work`.
- Fly Machines REST API called directly with `fetch`, no SDK.

### 4.2 Data model

All foreign keys reference `user.id`. Email is a mutable column on `user`.
BetterAuth's own tables (`user`, `session`, `account`, `verification`) are
generated into the Drizzle schema. Email change uses BetterAuth's built-in
`changeEmail` with verification of the new address; the UI for it is not in
v0 but nothing in the model prevents it.

Additional tables:

```
user            (BetterAuth) + role: 'member' | 'admin'  default 'member'
boxes           id, name, profile ('admin'|'contributor'), fly_machine_id,
                fly_volume_id, status, owner_user_id,
                jwt_secret (encrypted at rest or plain, see 4.6), created_at
box_access      box_id, user_id, granted_by_user_id, created_at   (PK box_id+user_id)
```

Admin role: on first login, if the email is in env `ADMIN_EMAILS`
(comma-separated) the user gets `role='admin'`. Admins can also promote
others later; not in v0 UI. Role lives on the user id, so a later email
change keeps it.

### 4.3 Migrations

- Schema in `src/db/schema.ts`. `drizzle-kit generate` writes SQL to
  `drizzle/`. Migrations are committed with the schema change.
- On startup (both prod and PGlite) the app runs `migrate()` before serving.
- Fly `release_command = "npm run db:migrate"` runs pending migrations
  against prod Postgres before the new version takes traffic.
- CI (GitHub Actions on `main`): job 1 runs `drizzle-kit generate` and
  fails if it produces a diff (schema changed, migration forgotten); job 2
  runs tests; job 3 runs `fly deploy`. Merging to `main` is therefore the
  entire prod migration procedure.

### 4.4 Auth flow

1. `/login`: enter email. BetterAuth sends a six-digit code via Resend.
2. Enter code. Session cookie issued. User row created on first login,
   role set from `ADMIN_EMAILS`.
3. Middleware protects everything except `/login` and BetterAuth routes.
4. Members land on `/boxes` and see only boxes shared with them.

### 4.5 Fleet manager (admins only)

Pages: `/boxes` (list), `/boxes/new`, `/boxes/[id]` (detail, share, actions).

Actions, each a server action calling the Fly Machines API on
`alversjo-boxes`:

- **create**: generate `JWT_SECRET`, create volume (10 GB, region `arn`),
  create machine with the box image, chosen profile, env from the table in
  §3, `restart.policy=always`. Insert `boxes` row, grant `box_access` to the
  creator.
- **start / stop**: Fly machine start/stop, update `status`.
- **destroy**: destroy machine, delete volume, delete rows. Any box can be
  destroyed by an admin, including the admin box; it can be recreated from
  the UI.
- **share**: add `box_access` for an existing user by email. **revoke**
  removes it. Owner and admins always have access.

The existing admin box is recreated as the first machine in `alversjo-boxes`
with `profile='admin'`, then `alversjo-admin-box` is deleted. Nothing on its
volume needs to survive.

### 4.6 Box proxy

CloudCLI has no base-path support (verified in its source), so each box gets
its own hostname `<box-id>.boxes.alversjo.land` and the proxy routes on the
`Host` header instead of a path prefix. Nothing is rewritten.

1. The custom `server.ts` looks at every incoming request's `Host`. Hosts
   under `boxes.alversjo.land` go to the box proxy; everything else goes to
   Next.js.
2. The box proxy reads the BetterAuth session cookie (valid across
   subdomains), loads the session, and checks `box_access` or admin role.
   Without a session it redirects to `https://members.alversjo.land/login`.
   Without access it answers 403.
3. Path `/__enter` (the link the platform's "Open" button points at) mints
   a CloudCLI JWT with the box's `jwt_secret` (payload `{userId, username}`
   of the seeded CloudCLI user, 7-day expiry, same shape CloudCLI itself
   issues) and serves a tiny page that writes it to
   `localStorage['auth-token']` and redirects to `/`. CloudCLI's client
   then authenticates itself as usual.
4. All other requests, including WebSocket upgrades, are forwarded verbatim
   to `http://[<machine-id>.vm.alversjo-boxes.internal]:8080`. Upgrades use
   a hand-rolled forwarder on Node's `http` module (no `http-proxy`
   dependency); Next.js's own upgrade listener ignores hosts it does not
   route.
5. A stopped box gets a "start it?" page for admins and a "not running"
   page for members.

`jwt_secret` is stored plain in Postgres for v0. It only grants access to a
box that the platform already fully controls; the Fly token is the real
crown jewel and lives only in Fly secrets.

### 4.7 Secrets on the platform machine

`DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `FLY_API_TOKEN`,
`ADMIN_EMAILS`, `CLOUDFLARE_API_TOKEN`, and the tokens to inject into boxes:
`BOX_CLAUDE_TOKEN`, `BOX_GH_TOKEN_ADMIN`, `BOX_GH_TOKEN_CONTRIBUTOR`. All via
`fly secrets`, none in the repo.

## 5. Testing

- Unit: access checks (member vs admin vs shared), profile-to-env mapping,
  JWT minting, Fly API client against a mocked `fetch`.
- Integration, run locally with PGlite: login with a captured OTP (Resend
  mocked), create-box flow with Fly mocked.
- One manual end-to-end script: create a real contributor box, open it
  through the proxy, destroy it. Documented, not in CI.
- Box image: a build-only CI job in the `box` repo, plus a smoke script that
  boots the image locally with fake tokens and checks CloudCLI answers on
  8080.

## 6. Deployment order

0. Manual prerequisites: make the three repos public, enable branch
   protection on `main`, create the `alversjo-contributor` bot account and
   its fine-grained token, allocate the dedicated IPv4.
1. `infrastructure` repo: import the current zone into `dnsconfig.js`, add the
   platform and boxes records, CI with `dnscontrol preview` / `push`.
2. `box` repo: CloudCLI, dnscontrol, superpowers, profiles, entrypoint.
   Build and push the image to Fly's registry as
   `registry.fly.io/alversjo-boxes:<git-sha>` (images are readable across
   apps of the same org).
3. `platform` repo: auth + schema + migrations + CI. Deploy to
   `alversjo-platform` with Postgres attached, certificates issued.
4. Fleet manager + proxy. Recreate the admin box inside `alversjo-boxes`,
   verify access through the platform, delete `alversjo-admin-box`.

## 7. Deferred, on purpose

Membership import and Stripe, box templates per service (map etc.),
promoting admins from the UI, email-change UI, encrypting `jwt_secret`,
multiple regions, box resizing, replacing the bot-account token with a
GitHub App that mints short-lived tokens.
