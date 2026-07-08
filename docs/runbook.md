# CapacityLens — operations runbook (controlled demo)

One page: how to deploy, watch, back up, restore, reset, and roll back the hosted demo.
Flags and their droplet values live in the **flag register** in
[`production-plan.md`](production-plan.md) — this file doesn't duplicate it. Host layout
(Nginx + daemon + paths) is in the plan's "Target architecture"; the cutover steps are
the plan's Phase 2.

> **Live setup (alpha, 2026-06-16) — read this first.** The demo is deployed at
> **small-saas-agency-resource-alpha.kevinjohngallagher.com** (DigitalOcean + Forge,
> zero-downtime releases — app at `current/`, web root `current/dist`). What's actually wired —
> this **supersedes the Basic-Auth / per-tester-Account instructions below**:
> - **Server:** a Forge **Background process** named `capacitylens-server` runs
>   `/home/forge/capacitylens-data/run-server.sh` (a wrapper that `cd current && exec pnpm --filter
>   capacitylens-server start` with `NODE_ENV=production` + the droplet flags). `CAPACITYLENS_DB=/home/forge/capacitylens-data/capacitylens.db`.
> - **Nginx:** `location /api/ → 127.0.0.1:8787` added via Forge's Nginx editor (no trailing
>   slash on `proxy_pass`, so the `/api` prefix is preserved).
> - **Deploy script (Forge):** `git pull` → `pnpm install --frozen-lockfile` → `export VITE_CAPACITYLENS_API` +
>   `VITE_CAPACITYLENS_BUILD_SHA` → `pnpm run build`. **`NODE_ENV=development` is kept for alpha** (flip
>   to `production` before beta).
> - **No auth this round (owner):** no Nginx Basic Auth, `CAPACITYLENS_AUTH` off — the dataset is
>   shared and OPEN. Wherever this runbook says `curl -u` / htpasswd / per-tester creds, **that
>   gate does not exist yet**. **No per-tester Accounts** either — testers share the seeded Accounts.
> - **Deploy gotcha:** the daemon runs from the rotating `current/` symlink, so a **server-code**
>   change (`server/`) needs a manual restart of the `capacitylens-server` Background process in Forge
>   after the deploy; client/`dist` changes go live on the symlink swap automatically.
> - **Not yet done (Phase 2 remainders):** Nginx security headers, cache-control, droplet restore drill.

## Deploy

Run the gate locally (`gate` + `gate:server` + `e2e`; optionally `e2e:webkit` / `e2e:firefox` for a
Safari / Firefox pass),
then push to `main` → Forge deploy script
(there is no hosted CI by default — the local gate is the pre-push bar):

```sh
nvm use                       # .nvmrc pins Node 24
pnpm install --frozen-lockfile
export VITE_CAPACITYLENS_API="https://<site>"                      # server mode — REQUIRED
export VITE_CAPACITYLENS_BUILD_SHA="$(git rev-parse --short HEAD)" # build stamp
export VITE_CAPACITYLENS_FEEDBACK_MAILTO="<owner address>"         # Send-feedback link
pnpm run build                 # → dist/
# restart the daemon (Forge daemon panel does this; CLI equivalent:)
# forge daemon:restart <id>   — daemon runs: pnpm --filter capacitylens-server start
```

**Verify after every deploy:** Settings shows `build <sha> · server`. A build missing
`VITE_CAPACITYLENS_API` silently reverts to localStorage and otherwise looks identical — the
stamp is the tell (`· local` = bad build).

## Logs

- Daemon stdout (Forge daemon log): with `CAPACITYLENS_LOG=1` every request is one JSON line
  (method/path/status/latency, pino) plus `capacitylens-server: backup written …` lines hourly.
- Nginx access log: per-tester Basic Auth usernames — who was on when. (NOT wired in the
  current alpha — see the alpha banner; there are no Basic Auth usernames to log this round.)
- 500s appear in the daemon log with the real error; the HTTP body stays generic.

## Backups (CAPACITYLENS_BACKUP_DIR)

The daemon snapshots `capacitylens.db` online (WAL-safe — never `cp` the live file) into
`/home/forge/capacitylens-data/backups/capacitylens-<YYYYMMDD-HHmmss>.db`: once at boot, then every
`CAPACITYLENS_BACKUP_INTERVAL_MIN` (60), keeping the newest `CAPACITYLENS_BACKUP_KEEP` (48) — RPO ≤ 1 h.

## Restore (P4.2 — drill performed 2026-06-13, exact sequence)

```sh
# 1. stop the daemon (Forge panel, or kill -TERM <pid> — it drains and exits 0)
# 2. copy the chosen snapshot over the live file; remove WAL sidecars (stale ones from a
#    crashed daemon would replay old frames over the restored file)
cp /home/forge/capacitylens-data/backups/capacitylens-<stamp>.db /home/forge/capacitylens-data/capacitylens.db
rm -f /home/forge/capacitylens-data/capacitylens.db-wal /home/forge/capacitylens-data/capacitylens.db-shm
# 3. start the daemon; verify in the app (or: curl -su <user> https://<site>/api/state)
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

- Uptime check (Forge monitor / UptimeRobot) **with Basic Auth creds** on:
  `https://<site>/api/health` (no Basic Auth this round — see the alpha banner; hit
  `/api/health` directly) — with `CAPACITYLENS_HEALTH_DEEP=1` a 200 `{ok,db:true}` proves the
  DB answers; 503 `{ok:false}` = DB broken while the process lives — and the SPA root.
- Droplet disk alert sized against backup retention (48 × DB size + WAL headroom; the DB
  is KB–MB scale, so any sane threshold works — set it when confirming disk headroom).

## Cohesion demo import (Phase 2 step 3 — dry-run verified locally 2026-06-13)

First daemon boot auto-seeds Studio North / Loft Digital. The Cohesion Labs dataset
(`_input/cohesion-labs-import.json`, 166 records) imports into its own Account — create
the Account first, then import **into** it (run on the droplet from the repo root; the
`curl -u <user>` note assumes Basic Auth, which is NOT wired in the current alpha — see the
alpha banner, so drop the `-u`):

```sh
NOW=$(node -e "console.log(new Date().toISOString())")
curl -s -X POST http://127.0.0.1:8787/api/accounts -H 'content-type: application/json' \
  -d "{\"id\":\"a-cohesion\",\"name\":\"Cohesion Labs\",\"color\":\"#3b82f6\",\"createdAt\":\"$NOW\",\"updatedAt\":\"$NOW\"}"
node -e "
const data = require('./_input/cohesion-labs-import.json');
fetch('http://127.0.0.1:8787/api/import', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ accountId: 'a-cohesion', data }),
}).then(async (r) => console.log(r.status, await r.text()))"
```

Expected: `200 {"imported":166,"skipped":0,…}`. *Verify:* Cohesion Labs appears in the
AccountPicker next to the seeded companies, with 12 resources / 11 clients / 12 projects /
30 tasks / 79 allocations / 20 time-off entries; the seeded companies are untouched.
(Hitting the daemon on loopback as above bypasses Nginx — no Basic Auth needed when SSH'd in.)

## Testers (P5.1 / P5.3 / Phase 2 #3)

- **Access:** one htpasswd entry per tester (`htpasswd /etc/nginx/.htpasswd-capacitylens <name>`)
  — attribution in access logs, per-person revocation. Remove a line to revoke. (NOT wired in
  the current alpha — see the alpha banner; there is no htpasswd gate this round.)
- **One Account (company) per tester**, created in the UI after deploy, plus the Cohesion
  import — makes last-writer-wins collisions rare by construction; the AccountPicker
  doubles as "who are you".
- **Briefing paragraph (paste into the invite):**

  > Your data lives on our demo server and is shared per company — pick *your* company on
  > the picker and stay in it. Anything you type is visible to the other testers and to
  > us, so please use demo-ish names, not real client data. The little stamp at the bottom
  > of Settings says which build you're on — include it in any bug report (the “Send
  > feedback” link next to it pre-fills this). You can export your company's data as JSON
  > from the sidebar at any time. Best on a laptop; on a phone, landscape works better.

## Rollback (data decision, not just a redeploy)

Rebuilding without `VITE_CAPACITYLENS_API` returns the app to browser-local storage but
**strands the server data** (nothing migrates back). Before flipping:

```sh
curl -su <user> https://<site>/api/state > capacitylens-server-export-$(date +%F).json
```

Then remove the `VITE_CAPACITYLENS_API`/`VITE_CAPACITYLENS_BUILD_SHA` exports from the deploy script
and redeploy. Server-mode rollback to a good state without leaving server mode = the
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
