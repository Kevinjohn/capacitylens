# Floaty — operations runbook (controlled demo)

One page: how to deploy, watch, back up, restore, reset, and roll back the hosted demo.
Flags and their droplet values live in the **flag register** in
[`production-plan.md`](production-plan.md) — this file doesn't duplicate it. Host layout
(Nginx + daemon + paths) is in the plan's "Target architecture"; the cutover steps are
the plan's Phase 2.

## Deploy

Run the gate locally (`gate` + `gate:server` + `e2e`), then push to `main` → Forge deploy script
(there is no hosted CI by default — the local gate is the pre-push bar):

```sh
nvm use                       # .nvmrc pins Node 24
npm ci
export VITE_FLOATY_API="https://<site>"                      # server mode — REQUIRED
export VITE_FLOATY_BUILD_SHA="$(git rev-parse --short HEAD)" # build stamp
export VITE_FLOATY_FEEDBACK_MAILTO="<owner address>"         # Send-feedback link
npm run build                 # → dist/
# restart the daemon (Forge daemon panel does this; CLI equivalent:)
# forge daemon:restart <id>   — daemon runs: npm start --workspace=server
```

**Verify after every deploy:** Settings shows `build <sha> · server`. A build missing
`VITE_FLOATY_API` silently reverts to localStorage and otherwise looks identical — the
stamp is the tell (`· local` = bad build).

## Logs

- Daemon stdout (Forge daemon log): with `FLOATY_LOG=1` every request is one JSON line
  (method/path/status/latency, pino) plus `floaty-server: backup written …` lines hourly.
- Nginx access log: per-tester Basic Auth usernames — who was on when.
- 500s appear in the daemon log with the real error; the HTTP body stays generic.

## Backups (FLOATY_BACKUP_DIR)

The daemon snapshots `floaty.db` online (WAL-safe — never `cp` the live file) into
`/home/forge/floaty-data/backups/floaty-<YYYYMMDD-HHmmss>.db`: once at boot, then every
`FLOATY_BACKUP_INTERVAL_MIN` (60), keeping the newest `FLOATY_BACKUP_KEEP` (48) — RPO ≤ 1 h.

## Restore (P4.2 — drill performed 2026-06-13, exact sequence)

```sh
# 1. stop the daemon (Forge panel, or kill -TERM <pid> — it drains and exits 0)
# 2. copy the chosen snapshot over the live file; remove WAL sidecars (stale ones from a
#    crashed daemon would replay old frames over the restored file)
cp /home/forge/floaty-data/backups/floaty-<stamp>.db /home/forge/floaty-data/floaty.db
rm -f /home/forge/floaty-data/floaty.db-wal /home/forge/floaty-data/floaty.db-shm
# 3. start the daemon; verify in the app (or: curl -su <user> https://<site>/api/state)
```

Drill verification: an edit made after the snapshot is gone post-restore; seeded data
intact. **Re-run this drill once on the droplet before testers arrive** — a backup that's
never been restored is a hope, not a backup.

## Demo reset between testing sessions (P4.3)

Take a named pre-session snapshot, restore it afterwards (the restore sequence above):

```sh
sqlite3 /home/forge/floaty-data/floaty.db ".backup /home/forge/floaty-data/backups/pre-session-<date>.db"
```

This replaces any temptation to enable `FLOATY_ALLOW_RESET` in production — which the
boot-guard refuses anyway (the daemon will not start with it under `NODE_ENV=production`).

## Monitoring (P4.4)

- Uptime check (Forge monitor / UptimeRobot) **with Basic Auth creds** on:
  `https://<site>/api/health` (with `FLOATY_HEALTH_DEEP=1` a 200 `{ok,db:true}` proves the
  DB answers; 503 `{ok:false}` = DB broken while the process lives) — and the SPA root.
- Droplet disk alert sized against backup retention (48 × DB size + WAL headroom; the DB
  is KB–MB scale, so any sane threshold works — set it when confirming disk headroom).

## Cohesion demo import (Phase 2 step 3 — dry-run verified locally 2026-06-13)

First daemon boot auto-seeds Studio North / Loft Digital. The Cohesion Labs dataset
(`_input/cohesion-labs-import.json`, 166 records) imports into its own Account — create
the Account first, then import **into** it (run on the droplet from the repo root; with
Basic Auth in front, give curl `-u <user>`):

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

- **Access:** one htpasswd entry per tester (`htpasswd /etc/nginx/.htpasswd-floaty <name>`)
  — attribution in access logs, per-person revocation. Remove a line to revoke.
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

Rebuilding without `VITE_FLOATY_API` returns the app to browser-local storage but
**strands the server data** (nothing migrates back). Before flipping:

```sh
curl -su <user> https://<site>/api/state > floaty-server-export-$(date +%F).json
```

Then remove the `VITE_FLOATY_API`/`VITE_FLOATY_BUILD_SHA` exports from the deploy script
and redeploy. Server-mode rollback to a good state without leaving server mode = the
restore sequence above.

## Production-shaped rehearsal (Phase 6, run locally before cutover)

Proves the production build + ON-state flags end to end without a droplet
(`NODE_ENV` stays unset locally — the reset route is needed by the specs and P1.6 forbids
it under `production`; the guard has its own tests):

```sh
# 1. server with the droplet's flags + reset for the specs (fresh temp DB)
cd server && rm -f .rehearsal.db* && PORT=8787 FLOATY_DB=.rehearsal.db FLOATY_ALLOW_RESET=1 \
  FLOATY_LOG=1 FLOATY_HEALTH_DEEP=1 FLOATY_RATE_LIMIT=300 FLOATY_BACKUP_DIR=/tmp/floaty-rehearsal-backups \
  npm start &
# 2. production build pointing at the proxy origin, served behind a local /api proxy
VITE_FLOATY_API=http://127.0.0.1:4173 VITE_FLOATY_BUILD_SHA=$(git rev-parse --short HEAD) npm run build
node scripts/serve-dist.mjs &        # dist/ on :4173, /api/* → 127.0.0.1:8787
# 3. the db-backed e2e specs against the production-shaped stack
FLOATY_REHEARSAL_URL=http://127.0.0.1:4173 npx playwright test --project=rehearsal
```

## Launch checklist

The post-deploy smoke list (15 min, incl. a phone pass) is in
[`production-plan.md`](production-plan.md) → "Post-deploy smoke" — run it top to bottom
after the first deploy and after any Nginx/env change.
