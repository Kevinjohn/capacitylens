# Production posture

This page describes the **production posture** CapacityLens enforces in code, and the
environment you set to reach it. It is deliberately honest about the line between what the
**process** can guarantee (config it can refuse to boot on) and what only the **operator** can
do at go-live (TLS, the reverse proxy, uptime, the restore drill). The former is enforced and
tested here; the latter is cross-linked at the bottom.

The short version: in production, CapacityLens **retires the dev/open posture**. Running with
authentication OFF in production would expose the open/demo dataset to the world, so the server
**refuses to boot** in that state unless you opt in explicitly.

---

## What "production posture" means

"Production posture" is the set of conditions a real, internet-facing CapacityLens deployment
should hold. Concretely:

- **`NODE_ENV=production`** — the switch that engages every production-only guard below.
- **Auth is ON** — `CAPACITYLENS_AUTH=password` or `sso`. The dev/open (auth-off) posture is
  retired: without a login, the demo dataset is world-readable and world-writable.
- **HTTPS / HSTS** — the public origin is real HTTPS. Set `CAPACITYLENS_HTTPS=1` when *this
  process* terminates TLS so it emits HSTS; leave it unset when TLS terminates at a reverse
  proxy (HSTS over plain HTTP is harmful, so it is off by default).
- **The destructive reset route is impossible** — `CAPACITYLENS_ALLOW_RESET` stays unset. The
  separate boot guard in [`server/src/bootGuard.ts`](../server/src/bootGuard.ts) already refuses
  to start if `CAPACITYLENS_ALLOW_RESET=1` is combined with `NODE_ENV=production`.
- **Structured logging + redaction** — `CAPACITYLENS_LOG=1` for per-request JSON logs (pino).
- **Backups on** — `CAPACITYLENS_BACKUP_DIR` set to a writable volume so the DB is snapshotted
  on a timer.
- **Deep health on** — `CAPACITYLENS_HEALTH_DEEP=1` so `/api/health` does a real DB read.
- **Rate limiting on** — `CAPACITYLENS_RATE_LIMIT` set to a positive requests-per-minute value.
- **CORS not `*`** — `CAPACITYLENS_CORS_ORIGIN` names the real origin(s). With the same-origin
  nginx `/api` proxy the browser never makes a cross-origin call, so this can even stay unset
  (fail-closed defaults), but it must never be `*` on a public deployment.

---

## The boot interlock

The production-posture contract is a pure predicate in
[`server/src/productionGuard.ts`](../server/src/productionGuard.ts)
(`evaluateProductionPosture`), consulted by the entrypoint right after auth is resolved. It is a
**fail-closed safety interlock** — like the reset guard, it is *not* behind an opt-in flag,
because defaulting a safety guard to off defeats it. It is active **only** when
`NODE_ENV=production`; for any other value (unset, `development`, `test`) it is a strict no-op,
so dev / e2e / self-host runs that legitimately use the open posture are completely untouched.

In production it produces two tiers:

**Refusals (the server will not start):**

- **Auth is OFF** (`CAPACITYLENS_AUTH` unset or `off`) — the open/demo dataset would be exposed
  with no login. The boot message names the fix: set `CAPACITYLENS_AUTH=password` or `sso`, or
  set `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1` to deliberately run the open posture.
  - The **only** escape is `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1`. It *downgrades* this
    refusal to a loud warning — the server then boots into the open posture on purpose — but it
    **never silences** the concern.

**Warnings (boot continues, logged loudly):**

- **HTTPS / HSTS off** — `CAPACITYLENS_HTTPS` is not `1`. Expected when TLS terminates at a
  reverse proxy; if this process serves HTTPS directly, set `CAPACITYLENS_HTTPS=1`.
- **Open signup on** — `CAPACITYLENS_ALLOW_OPEN_SIGNUP=1` re-opens self-service registration,
  which should normally stay closed / invite-only in production.

The contract and both directions (it actually refuses, and a clean config passes clean) are
covered by [`server/src/productionGuard.test.ts`](../server/src/productionGuard.test.ts).

---

## Minimum production environment

The env vars to set for a hosted, authenticated posture. All names are exactly as read by the
server (see the env register at the top of [`server/src/index.ts`](../server/src/index.ts) and
[`.env.example`](../.env.example)).

| Variable | Set to | Why |
| --- | --- | --- |
| `NODE_ENV` | `production` | Engages every production-only guard, including this interlock. |
| `CAPACITYLENS_AUTH` | `password` or `sso` | Auth ON — the open posture is retired in production. |
| `BETTER_AUTH_SECRET` | 32+ random chars | Session signing secret (required when auth is on). |
| `BETTER_AUTH_URL` | the public origin | The origin the browser uses (required when auth is on). |
| `CAPACITYLENS_HTTPS` | `1` (only if this process serves TLS) | Emits HSTS. Leave unset if TLS terminates at the proxy. |
| `CAPACITYLENS_LOG` | `1` | Structured per-request JSON logs. |
| `CAPACITYLENS_HEALTH_DEEP` | `1` | `/api/health` does a real DB read. |
| `CAPACITYLENS_BACKUP_DIR` | a writable directory | Enables periodic online DB snapshots. |
| `CAPACITYLENS_RATE_LIMIT` | a positive integer (req/min/IP) | Per-IP rate limiting across `/api/*`. |
| `CAPACITYLENS_CORS_ORIGIN` | the real origin(s), never `*` | Locks CORS to your app's origin. |

**Guards that must stay UNSET** (each, if set, is a production hazard the interlock either
refuses or warns on):

- `CAPACITYLENS_ALLOW_RESET` — would expose the destructive reset route; refuses boot in
  production via [`bootGuard.ts`](../server/src/bootGuard.ts).
- `CAPACITYLENS_ALLOW_OPEN_SIGNUP` — would re-open self-service registration; warned on.
- `CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION` — only set it to `1` if you *intend* to run the open /
  demo (auth-off) posture in production; otherwise leave it unset so auth-off refuses to boot.

---

## Verifying locally without a live host

You do not need a server, a domain, or TLS to confirm the **configuration** is correct — you can
watch the interlock refuse and warn from a laptop:

- Set `NODE_ENV=production` with auth unset and start the API: the server **refuses to boot** and
  prints a `refusing to start — production posture:` line naming `CAPACITYLENS_AUTH`.
- Add `CAPACITYLENS_AUTH=password` (with `BETTER_AUTH_SECRET` / `BETTER_AUTH_URL`) but leave
  `CAPACITYLENS_HTTPS` unset: it boots, but logs a `production posture warning — ... HSTS ...`
  line.
- Set `CAPACITYLENS_AUTH=password` + `CAPACITYLENS_HTTPS=1`: clean boot, no posture warnings.
- Run `npm run gate:server` — the pure guard test exercises every combination above.

Be honest about what this proves: it verifies the **config contract**, not the live deploy. A
green run here says the process will refuse the wrong env and accept the right one — it says
nothing about whether your TLS certificate, proxy, or host are actually up.

### Backups & monitoring (also no live host)

The two operational signals — periodic DB snapshots and deep health — are likewise
**configuration you can confirm from a laptop**, no server / domain / TLS / Docker needed. Both are
**OFF by default**; the env names below are exactly as read by
[`server/src/backup.ts`](../server/src/backup.ts) and the `/api/health` route in
[`server/src/app.ts`](../server/src/app.ts) (and listed in [`.env.example`](../.env.example)).

```sh
# from the repo root; a throwaway DB + a throwaway backup dir keep your real data untouched
BACKUPS=$(mktemp -d)
CAPACITYLENS_DB=:memory: \
CAPACITYLENS_BACKUP_DIR="$BACKUPS" \
CAPACITYLENS_BACKUP_INTERVAL_MIN=1 \
CAPACITYLENS_HEALTH_DEEP=1 \
PORT=8787 \
npm start --workspace=server
```

- **Backups on boot.** `CAPACITYLENS_BACKUP_DIR` set ⇒ a snapshot is taken **immediately on start**
  (then every `CAPACITYLENS_BACKUP_INTERVAL_MIN`; default 60, set low here to watch a second one
  land in ~1 minute). A `capacitylens-<YYYYMMDD-HHmmss>.db` file appears in `$BACKUPS`, and the
  server logs `capacitylens-server: backup written <path>`. Confirm with `ls "$BACKUPS"`. Retention
  is `CAPACITYLENS_BACKUP_KEEP` (default 48, oldest pruned).
- **Deep health on.** With `CAPACITYLENS_HEALTH_DEEP=1`, `curl http://localhost:8787/api/health`
  returns `{ "ok": true, "db": true, "audit": "ok" }` (the DB probe ran; `audit` reports the sink
  state — `"degraded"` if an audit write has latched a failure, still a 200 because that is a soft
  signal). **Without** the flag (the default, omit it), the same URL returns exactly `{ "ok": true }`
  — the shallow shape the Playwright `webServer` probe depends on.

Same honesty caveat as above: this verifies the **config / behaviour** (backups fire, deep health
probes the DB), not a live deploy. For the operator-side wiring — an external uptime monitor
actually polling `/api/health`, snapshots running and retained on the host over time, and the
on-host **restore drill** — see [`docs/runbook.md`](runbook.md)'s **Backups**, **Monitoring**, and
**Restore** sections (cross-linked below).

---

## Out of scope here (operator-side at go-live)

These are real production requirements, but they live on the **host**, not in this repo's code,
so they are not enforced by the boot interlock:

- The actual droplet / VM deploy and the Docker images.
- The **TLS certificate** and its renewal.
- The **nginx reverse proxy** and the headers it delivers (and terminating TLS there).
- **Uptime monitoring** and alerting.
- The **restore drill** — periodically proving a backup actually restores.

For those, see the operator docs: [`docs/production-plan.md`](production-plan.md) (target
architecture and the flag register), [`docs/runbook.md`](runbook.md) (deploy / watch / back up /
restore / roll back), and [`docs/self-hosting.md`](self-hosting.md) (the end-to-end Docker
setup, including auth).
