# Alversjö platform

The browser-based control plane for Alversjö's cloud development machines
("boxes") and the first slice of the membership platform's identity layer.
Anyone can log in with an email address and a six-digit code; admins can
create, start, stop, destroy and share boxes; anyone with access can open a
box's CloudCLI session in the browser, through the platform, without a second
login. Memberships, Stripe and everything else are explicitly out of scope for
v0 — see [`docs/superpowers/specs/2026-09-15-platform-v0-design.md`](docs/superpowers/specs/2026-09-15-platform-v0-design.md)
for the full design.

Next.js 16 (App Router) behind a custom Node server (`server.ts`) so WebSocket
upgrades to boxes can be proxied, Drizzle ORM over Fly Postgres (prod) or
PGlite (dev), BetterAuth 1.7 with the email-OTP plugin, shadcn/ui on Tailwind.

## Running it on a dev box

```bash
npm install
cp .env.example .env   # then edit
npm run dev            # http://localhost:3000
```

- **Database.** Leave `DATABASE_URL` unset (or `pglite://.pglite`) and the app
  opens a PGlite database in `.pglite/` and runs migrations on startup. No
  Postgres, no Docker. `pglite://memory` gives a throwaway in-memory one.
- **Login codes.** With `RESEND_API_KEY` unset, no mail is sent: the code is
  printed to the server console as `[email] to=... subject="123456 is your
  Alversjö login code"`. Put your address in `ADMIN_EMAILS` before the first
  login — the role is decided once, when the user row is created.
- **Box hostnames.** Set `COOKIE_DOMAIN=localhost` so the session cookie set on
  `localhost` is also sent to box hosts. Browsers resolve every
  `*.localhost` name to loopback on their own, so
  `http://<box-id>.boxes.localhost:3000` reaches the proxy with no hosts-file
  entry. `BOXES_DOMAIN=boxes.localhost` must match.
- **Pointing at a real box.** `BOX_TARGET_OVERRIDE=127.0.0.1:18080` makes every
  box hostname proxy to that address instead of
  `<machine-id>.vm.alversjo-boxes.internal:8080`, which is how you drive the
  proxy against a box container running locally.

Tests are `npx vitest run` (PGlite in-memory, Fly and Resend faked); `npm run
lint`, `npm run build` and `npx tsc --noEmit` complete the local check.

## How deploys work

Merging to `main` is the entire deployment procedure. GitHub Actions runs one
`check` job (`npm run db:check`, `lint`, `test`, `build`) and, only on `main`,
a `deploy` job that runs `flyctl deploy --remote-only --ha=false` against
`alversjo-platform`. Fly's `release_command` in `fly.toml` applies pending
Drizzle migrations before the new version takes traffic, and `--ha=false`
keeps the app at the single machine the design calls for.

After any change to `src/db/schema.ts`, run `npm run db:generate` and commit
the generated SQL in `drizzle/` with the schema change. CI's `db:check`
regenerates the migrations and fails if that produces a diff, so a forgotten
migration never reaches `main`.

### Secrets

All of these live in `fly secrets` on `alversjo-platform`, never in the repo
(spec §4.7): `DATABASE_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`,
`FLY_API_TOKEN`, `ADMIN_EMAILS`, `CLOUDFLARE_API_TOKEN`, and the tokens
injected into boxes at creation — `BOX_CLAUDE_TOKEN`, `BOX_GH_TOKEN_ADMIN`,
`BOX_GH_TOKEN_CONTRIBUTOR`. CI additionally holds a `FLY_API_TOKEN` as a
GitHub Actions secret, for the deploy job. Non-secret configuration
(`PLATFORM_URL`, `BOXES_DOMAIN`, `COOKIE_DOMAIN`, `FLY_BOXES_APP`,
`BOX_IMAGE`, `EMAIL_FROM`) is in `fly.toml`'s `[env]`.

## The box model

CloudCLI cannot be served under a path prefix, so every box gets its own
hostname, `<box-id>.boxes.alversjo.land`, and `server.ts` routes on the `Host`
header. Nothing is rewritten.

- Requests for a box host are authorised by the platform: the BetterAuth
  session cookie (valid across `*.alversjo.land`) is read, and the user must
  own the box, have `box_access`, or be an admin. No session redirects to
  `https://members.alversjo.land/login`; no access answers 403.
- `/__enter` — where the "Open" button points — mints a CloudCLI JWT with that
  box's own `jwt_secret` and serves a tiny page that writes it to
  `localStorage['auth-token']` and redirects to `/`. CloudCLI's client then
  authenticates itself as usual. That JWT is the only credential the box ever
  sees.
- Everything else is relayed verbatim to
  `http://[<machine-id>.vm.alversjo-boxes.internal]:8080` over Fly's private
  network. The proxy **strips the platform's cookies** from relayed requests
  and strips `Set-Cookie` from relayed responses, so a box can neither read nor
  overwrite the platform session.
- WebSocket upgrades are authorised **at the upgrade only**. An open shell is
  not re-checked, so revoking access does not kill a live connection; it takes
  effect on the next connect.
- Deploys of the platform drop open box sessions. `server.ts` stops accepting
  connections on `SIGTERM` and hard-exits after 10 seconds, so a redeploy
  interrupts anyone with a shell open (they reconnect by reloading).

## Manual end-to-end check (spec §5)

Not in CI; run it after a change to the proxy, the Fly client or the box
image.

1. Log in at https://members.alversjo.land as an admin.
2. `/boxes/new` → name it `e2e`, profile **contributor**, create. The volume
   and machine are created and the row lands in `started`.
3. Press **Open** on the box. The browser goes to
   `https://<box-id>.boxes.alversjo.land/__enter` and lands in CloudCLI,
   already logged in.
4. Open a shell in CloudCLI and run `ls /work` — the box's volume, with the
   profile's `CLAUDE.md` in it.
5. Back on `/boxes/<id>`, press **Destroy**. The machine and volume go away and
   the rows are deleted. Confirm with `fly machines list -a alversjo-boxes`.

## Creating the admin box

The admin box is `protected: true` and cannot be destroyed from the UI, so it
is created by a script run on the platform machine, which already holds every
secret:

```bash
fly ssh console -a alversjo-platform -C "sh -c 'cd /app && npx tsx /app/scripts/create-admin-box.ts owner@example.org'"
```

The owner email must have logged in at least once (the script needs a user
row), and it refuses to run if a protected box already exists.

## Known limitations (v0)

- **Session cookie scope.** The session cookie is set on `.alversjo.land` so it
  is also sent to box hosts. That means a box subdomain can also *set* a cookie
  on that domain: a malicious box could fix a session on a visitor (session
  fixation). Today only admins use boxes, and the boxes run our own image, so
  the exposure is accepted for v0. The planned fix is to mint a short-lived
  ticket on the platform host and have `/__enter` exchange it for a *host-only*
  cookie on the box host, leaving the platform cookie scoped to
  `members.alversjo.land`.
- **Box status is not reconciled with Fly.** The `status` column reflects what
  the platform last did. A machine that Fly restarted, stopped or lost is not
  noticed until someone acts on the box.
- **`BOX_IMAGE` defaults to `:latest`.** New boxes get whatever the box repo
  pushed last, and there is no record of which image a given box was created
  from.
- **Shared boxes expose emails.** Everyone who can see a box's detail page sees
  the email address of everyone else with access to it.
