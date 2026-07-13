# CapacityLens — operations runbook (controlled demo)

One page: how to deploy, watch, back up, restore, reset, and roll back the hosted demo.
Flags and their droplet values live in the **flag register** in
[`production-plan.md`](production-plan.md) — this file doesn't duplicate it. Host layout
(Nginx + daemon + paths) is in the plan's "Target architecture"; the cutover steps are
the plan's Phase 2.

> **Live setup (auth-on, 2026-07-11) — read this first.** The instance runs the server-backed
> build with **password auth ON** (`CAPACITYLENS_AUTH=password`) under `NODE_ENV=production` —
> the daemon **refuses to boot** in production with auth off (the posture interlock in
> `server/src/productionGuard.ts`). Access is invite-only (Settings → Members → Invite), and
> tenant isolation is enforced server-side: the account a caller can touch is derived from
> their session + membership (`authorize()`), not client-asserted. The full wiring — Forge
> deploy script, daemon wrapper + env, Nginx `/api` proxy, first-user bootstrap — lives in
> [`deploy.md`](deploy.md) (**source of truth for the deployed posture**); generic
> systemd/Docker self-hosting is [`self-hosting.md`](self-hosting.md). This runbook is the
> day-to-day operations layer on top of those.
> - **Deploy gotcha:** the daemon runs from the rotating `current/` symlink, so a **server-code**
>   change (`server/`) needs a manual restart of the `capacitylens-server` Background process in Forge
>   after the deploy; client/`dist` changes go live on the symlink swap automatically.
> - **Not yet done (Phase 2 remainders):** Nginx security headers, cache-control, droplet restore drill.

## Deploy

Run the gate locally (`gate` + `gate:server` + `e2e`; optionally `e2e:webkit` / `e2e:firefox` for a
Safari / Firefox pass), then push to `main` → Forge deploy script. Hosted CI also runs the gate
(`.github/workflows/gate.yml`: PRs, manual dispatch, release tags, monthly cron), but the local
gate stays the pre-push bar — CI is the backstop, not the substitute.

The deploy script itself (build) and the daemon env are maintained in
[`deploy.md`](deploy.md) §4–5 — don't duplicate them here. Two build facts that matter
operationally:

```sh
nvm use                       # .nvmrc pins Node 24
pnpm install --frozen-lockfile
export VITE_CAPACITYLENS_BUILD_SHA="$(git rev-parse --short HEAD)" # build stamp
export VITE_CAPACITYLENS_FEEDBACK_MAILTO="<owner address>"         # Send-feedback link
pnpm run build                 # → dist/
# restart the daemon (Forge daemon panel does this; CLI equivalent:)
# forge daemon:restart <id>   — daemon runs: pnpm --filter capacitylens-server start
```

- **Do NOT set `VITE_CAPACITYLENS_API`** — empty *is* same-origin server mode (the variable is
  an origin *override* for different-origin deploys, not an on-switch; see `deploy.md`).
- **Never set `VITE_CAPACITYLENS_DEMO`** here — that builds the backend-less localStorage demo.

**Verify after every deploy:** Settings shows `build <sha> · server`. A demo-flagged build
shows `· local` and otherwise looks identical — the stamp is the tell (`· local` = bad build).

## Logs

- Daemon stdout (Forge daemon log): with `CAPACITYLENS_LOG=1` every request is one JSON line
  (method/path/status/latency, pino) plus `capacitylens-server: backup written …` lines hourly.
- Nginx access log: request-level traffic only. Who-did-what attribution comes from the
  **audit log** (`capacitylens-audit.jsonl` beside the DB, on by default — one JSON line per
  mutation with `userId`/`accountId`; field names only, never values).
- 500s appear in the daemon log with the real error; the HTTP body stays generic.

## Backups (CAPACITYLENS_BACKUP_DIR)

The daemon snapshots `capacitylens.db` online (WAL-safe — never `cp` the live file) into
`/home/forge/capacitylens-data/backups/capacitylens-<YYYYMMDD-HHmmss-SSS>.db`: once at boot, then every
`CAPACITYLENS_BACKUP_INTERVAL_MIN` (60), keeping the newest `CAPACITYLENS_BACKUP_KEEP` (48) — RPO ≤ 1 h.

## Restore (P4.2 — drill performed 2026-06-13, exact sequence)

```sh
# 1. stop the daemon (Forge panel, or kill -TERM <pid> — it drains and exits 0)
# 2. copy the chosen snapshot over the live file; remove WAL sidecars (stale ones from a
#    crashed daemon would replay old frames over the restored file)
cp /home/forge/capacitylens-data/backups/capacitylens-<stamp>.db /home/forge/capacitylens-data/capacitylens.db
rm -f /home/forge/capacitylens-data/capacitylens.db-wal /home/forge/capacitylens-data/capacitylens.db-shm
# 3. start the daemon; verify in the app (signed in — /api/state needs a session with auth on,
#    so the app is the easy check; curl works only with a valid session cookie)
```

Drill verification: an edit made after the snapshot is gone post-restore; seeded data
intact. **Re-run this drill once on the droplet before testers arrive** — a backup that's
never been restored is a hope, not a backup.

This drill is now also codified as an automated, reproducible test — `server/src/restore.drill.test.ts`
— that runs on every `pnpm run gate:server`: it backs up an on-disk DB, simulates loss by corrupting
the live file, restores via the sequence above, and verifies the seeded data is recovered while the
post-snapshot edit is gone. So the restore PATH is continuously verified; the **on-droplet** re-run
above remains the operator's pre-go-live step.

## Demo reset between testing sessions (P4.3)

Take a named pre-session snapshot, restore it afterwards (the restore sequence above):

```sh
sqlite3 /home/forge/capacitylens-data/capacitylens.db ".backup /home/forge/capacitylens-data/backups/pre-session-<date>.db"
```

This replaces any temptation to enable `CAPACITYLENS_ALLOW_RESET` in production — which the
boot-guard refuses anyway (the daemon will not start with it under `NODE_ENV=production`).

## Monitoring (P4.4)

- Uptime check (Forge monitor / UptimeRobot) on `https://<site>/api/health` — deliberately
  unauthenticated and rate-limit-exempt, so no creds needed even with auth on. With
  `CAPACITYLENS_HEALTH_DEEP=1` a 200 `{ok,db:true}` proves the DB answers; 503 `{ok:false}` =
  DB broken while the process lives. Also check the SPA root.
- Droplet disk alert sized against backup retention (48 × DB size + WAL headroom; the DB
  is KB–MB scale, so any sane threshold works — set it when confirming disk headroom).

## Cohesion demo import (Phase 2 step 3 — dry-run verified locally 2026-06-13)

A fresh daemon boots **EMPTY** — the two-company demo seed (Studio North / Loft Digital) is an
explicit opt-in (`CAPACITYLENS_SEED_DEMO=1`), never automatic. The Cohesion Labs dataset
(`_input/cohesion-labs-import.json`, 166 records) imports into its own Account — create
the Account first, then import **into** it. **The easy path is the app itself:** sign in as
the Owner, create the "Cohesion Labs" company from the account picker, switch to it, and use
the sidebar **Import** — done, skip the curl below.

For the direct API route (run on the droplet from the repo root), three auth-on facts:
loopback bypasses Nginx but **not** app-level auth, so every call below needs a signed-in
session cookie; account creation goes through **`POST /api/orgs`** — the generic
`POST /api/accounts` is closed under auth-on and 403s with "Accounts cannot be created
through this endpoint when authentication is on. Use POST /api/orgs." (`/api/orgs` atomically
creates the account, its built-in Internal client, and **your Owner membership**, which is
what entitles the follow-up import); and the single-company cap applies to `/api/orgs` too —
once any account exists, creating another 403s ("This instance allows a single company. Set
CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.") unless `CAPACITYLENS_MULTI_ACCOUNT=1` is set in
the daemon's environment (restart required):

```sh
# 1. Sign in once; the session cookie lands in the jar:
curl -s -c /tmp/cl-session.txt -X POST http://127.0.0.1:8787/api/auth/sign-in/email \
  -H 'content-type: application/json' \
  -d '{"email":"<owner email>","password":"<owner password>"}'
# 2. Create the Account (id optional — server-generated if omitted; timestamps are server-set):
curl -s -b /tmp/cl-session.txt -X POST http://127.0.0.1:8787/api/orgs \
  -H 'content-type: application/json' \
  -d '{"id":"a-cohesion","name":"Cohesion Labs"}'
# 3. Import into it (same cookie — import is admin+-gated per account; step 2 made you Owner):
node -e "
const data = require('./_input/cohesion-labs-import.json');
console.log(JSON.stringify({ accountId: 'a-cohesion', data }))" \
  | curl -s -b /tmp/cl-session.txt -X POST http://127.0.0.1:8787/api/import \
      -H 'content-type: application/json' --data-binary @-
rm /tmp/cl-session.txt
```

Expected: `200 {"imported":166,"skipped":0,…}`. *Verify:* Cohesion Labs appears in the
AccountPicker next to any existing companies, with 12 resources / 11 clients / 12 projects /
30 tasks / 79 allocations / 20 time-off entries; existing companies are untouched.

## Testers (P5.1 / P5.3 / Phase 2 #3)

- **Access:** invite-only via **Settings → Members → Invite** (briefly set
  `CAPACITYLENS_ALLOW_OPEN_SIGNUP=1` while the invitee creates their credential, then unset it);
  forgotten passwords via the admin-issued **Reset password** link on the member row
  (single-use, 24 h). Revoke by removing the membership. First-user bootstrap and the full
  flow are in [`deploy.md`](deploy.md) §7. Attribution is per-user (login + audit log).
- **One Account (company) per tester** — needs `CAPACITYLENS_MULTI_ACCOUNT=1` (the default
  instance is single-company) — plus the Cohesion import. Each tester sees only the
  Account(s) they're a member of; login is "who are you".
- **Briefing paragraph (paste into the invite):**

  > Your data lives on our demo server, scoped to your company — you only see the
  > companies you've been invited into. Anything you type is visible to that company's
  > other members and to us, so please use demo-ish names, not real client data. The little stamp at the bottom
  > of Settings says which build you're on — include it in any bug report (the “Send
  > feedback” link next to it pre-fills this). You can export your company's data as JSON
  > from the sidebar at any time. Best on a laptop; on a phone, landscape works better.

## Rollback (data decision, not just a redeploy)

Rebuilding with `VITE_CAPACITYLENS_DEMO=1` returns the app to browser-local storage (an
unflagged build stays server mode — `VITE_CAPACITYLENS_API` is only an origin override) but
**strands the server data** (nothing migrates back). Before flipping, export the data —
the app's sidebar JSON export as a signed-in user is the easy path, or with a valid
session cookie:

```sh
curl -s -b '<session cookie>' https://<site>/api/state > capacitylens-server-export-$(date +%F).json
```

Then add `VITE_CAPACITYLENS_DEMO=1` to the build step in the deploy script and redeploy.
Server-mode rollback to a good state without leaving server mode = the
restore sequence above.

## Production-shaped rehearsal (Phase 6, run locally before cutover)

Proves the production build + ON-state flags end to end without a droplet
(`NODE_ENV` stays unset locally — the reset route is needed by the specs and P1.6 forbids
it under `production`; the guard has its own tests):

```sh
# 1. server with the droplet's flags + reset for the specs (fresh temp DB)
cd server && rm -f .rehearsal.db* && PORT=8787 CAPACITYLENS_DB=.rehearsal.db CAPACITYLENS_ALLOW_RESET=1 \
  CAPACITYLENS_LOG=1 CAPACITYLENS_HEALTH_DEEP=1 CAPACITYLENS_RATE_LIMIT=300 CAPACITYLENS_BACKUP_DIR=/tmp/capacitylens-rehearsal-backups \
  pnpm start &
# 2. production build pointing at the proxy origin, served behind a local /api proxy
VITE_CAPACITYLENS_API=http://127.0.0.1:4173 VITE_CAPACITYLENS_BUILD_SHA=$(git rev-parse --short HEAD) pnpm run build
node scripts/serve-dist.mjs &        # dist/ on :4173, /api/* → 127.0.0.1:8787
# 3. the db-backed e2e specs against the production-shaped stack
CAPACITYLENS_REHEARSAL_URL=http://127.0.0.1:4173 pnpm exec playwright test --project=rehearsal
```

## Launch checklist

The post-deploy smoke list (15 min, incl. a phone pass) is in
[`production-plan.md`](production-plan.md) → "Post-deploy smoke" — run it top to bottom
after the first deploy and after any Nginx/env change.
