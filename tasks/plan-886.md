# Plan 886 — port lanes and a shared CPU budget for concurrent worktrees (rev 3)

Target: ten worktrees can each run `pnpm run gate`, `pnpm run gate:server` and `pnpm run e2e`
concurrently without port collisions, without inheriting another worktree's orphans, and without
contention-induced timeout failures. Not infinitely scalable; predictable at ten.

Rev 2 rewrote the ownership and CPU mechanisms after review round 1: rev 1 claimed lanes inside
Playwright `globalSetup` (too late — `playwright.config.ts` has already materialised its ports),
sized workers by sampling a live lane count (unstable under staggered starts, and `pnpm run gate`
never claimed a lane at all), used `poolOptions.forks.maxForks` (removed in the pinned Vitest
4.1.11), and missed both the 4173 preview binds and several runtime port consumers.

Rev 3 closes review round 2: the CPU allocator now states the bound it can actually enforce instead
of a cap it cannot, the server suite is removed from the worker-sizing consumers because it is
already serial, `docs/` regeneration is folded into the tasks that touch `docs-src/`, and orphan
reaping gains an ownership test.

## Facts

- Fixed bind points: 5173 (`vite.config.ts:113`, `strictPort: true`), 5273/5373/5473
  (`package.json` `dev:api`/`dev:auth`/`dev:oidc`, mirrored `playwright.config.ts:14,16,18`),
  8787 (`scripts/dev-fullstack.mjs:35`, `playwright.config.ts:13`), 8887/8897
  (`playwright.config.ts:15,17`, `server/package.json`), 5556/5557 (`scripts/e2e-oidc.mjs:10,86,173`),
  4173 (`scripts/serve-dist.mjs:129`, and the Vite default taken by both root `preview` and
  `docs:preview`).
- `playwright.config.ts:51` sets `reuseExistingServer: false` on every server, deliberately.
- `docs-src/.vitepress/config.mts` sets neither `vite.server.port` nor `vite.preview.port`, so
  `docs:dev` takes 5173 and `docs:preview` takes 4173.
- Runtime consumers that hold a port _without_ binding it: `e2e/auth-helpers.ts:9` (literal 8887),
  `e2e/db-helpers.ts:10` (env with an 8787 fallback), `server/scripts/setup-access-lab.ts:18,35`,
  `scripts/dev-access-lab.mjs:9`, `server/scripts/check-health.mjs:4`.
- Not lane consumers, deliberately: `server/src/routes/appConfig.ts:14` (`DEFAULT_CORS`, a
  production default), `server/scripts/generate-database-fixtures.ts:38` (fixture generation),
  and the OIDC literals below.
- Vitest is pinned at 4.1.11 (`pnpm-lock.yaml`): worker sizing is the top-level `test.maxWorkers`;
  `poolOptions.forks.maxForks` no longer exists.
- The server suite is already serial and is not a sizing lever: `server/package.json` runs
  `test:coverage`, `test:account-flows`, `test:credential-durability` and `test:migrations` with
  `--pool=forks --no-file-parallelism`, and `server/scripts/run-unit-shard.mjs` spawns unit files
  one at a time. `server/vitest.config.ts` is not the config those commands use.
- Neither suite caps parallelism today: `vite.config.ts` `test:` sets no worker option;
  `playwright.config.ts:57` sets `fullyParallel: true` with no `workers`. Machine has 10 cores.
- `pnpm run gate` (`scripts/run-gate.mjs`) simply runs `gateCommands` in sequence; it owns no
  environment and claims nothing.
- Primitives that exist: `parsePort` (`scripts/port.mjs`), `portInUse`, `terminateProcessTrees`,
  `acquireExclusiveFile` (`scripts/dev-processes.mjs:12,84,88`).

## Design

### One launcher owns the lane

Everything flows through `scripts/with-lane.mjs <command...>`. It claims a lane and a CPU
reservation **before** the child process starts, exports the resolved values into the child
environment, and releases both after the child and its managed servers have exited (including on
SIGINT/SIGTERM). Configuration files only _read_ `CAPACITYLENS_PORT_LANE` and
`CAPACITYLENS_TEST_SHARE`; nothing claims anything during config evaluation. This is what makes
`playwright.config.ts` correct — its port constants are resolved from an environment variable that
was already fixed before Playwright loaded — and it is what brings `pnpm run gate` inside the
budget, which rev 1 did not.

Scripts routed through it: `e2e`, `e2e:webkit`, `e2e:firefox`, `e2e:browsers`, `e2e:all`, `gate`,
`gate:server`, `test`, `dev`, `dev:web`, `dev:demo`, `preview`, `docs:dev`, `docs:preview`.
`CAPACITYLENS_PORT_LANE` set in the environment short-circuits the claim (CI sets 0).

### Lanes

One integer 0–9 per concurrent run. Every port is `base + lane`:

| Service         | Base | Lane 0 | Lane 9 |
| --------------- | ---- | ------ | ------ |
| core/demo web   | 5173 | 5173   | 5182   |
| db-backed web   | 5273 | 5273   | 5282   |
| auth-backed web | 5373 | 5373   | 5382   |
| db API          | 8787 | 8787   | 8796   |
| auth API        | 8887 | 8887   | 8896   |
| dist preview    | 4173 | 4173   | 4182   |
| docs dev        | 5900 | 5900   | 5909   |
| docs preview    | 5910 | 5910   | 5919   |

Lane 0 reproduces every port in use today, so CI, existing documentation and a single checkout see
no change. The auth API base is only 10 below the OIDC API's 8897: keep the ceiling at ten lanes, or
move 8897 before raising it.

### OIDC is out of the lane system

`e2e/oidc/dex.yaml` pins the issuer to `127.0.0.1:5556` and the callback to `localhost:5473`, and
`scripts/e2e-oidc.mjs:173` maps that host port fixedly. Changing it is Docker work and is not
authorised. So `pnpm run e2e:oidc` takes a dedicated single-flight lock, machine-wide, and keeps
every literal it has today — `e2e/oidc.oidc.spec.ts`, `dex.yaml`, `server/package.json`
`start:oidc-e2e`, `scripts/dev-access-lab.mjs`, `server/scripts/setup-access-lab.ts`. The ten-lane
guarantee covers `gate`, `gate:server` and the default `e2e`, and explicitly excludes `e2e:oidc`.
Its exhaustion message says so rather than implying a queue.

### Claiming: correctness details

Rev 1 leaned on `acquireExclusiveFile` alone; it is the right primitive for the create step and the
wrong one for the rest.

- Claim and stale-reclaim run under a single short-lived directory mutex in
  `~/.cache/capacitylens/lanes/`, so two starters cannot both reclaim the same stale lane. The
  cache directory is created if absent (`acquireExclusiveFile` does not).
- A lane file records the launcher pid, the worktree path, the claim time and the reserved CPU
  share. Release reads the file and unlinks **only if the pid matches**, so a release cannot delete
  a successor's freshly created lock.
- Liveness is by pid probe; a dead pid makes the lane reclaimable.
- Detached listeners can outlive the recorded pid after a hard kill, so preflight does not trust
  the pid: it probes each of the claimed lane's ports with `portInUse` before starting. Ports
  outside the claimed lane are never touched.
- Reaping requires ownership, not merely occupancy: a listener is killed only when its pid is
  recorded in this lane's file or its process ancestry resolves to this worktree. Anything else
  holding a lane port is reported by pid and command line, and the run refuses that lane rather
  than killing a stranger's process.
- An inherited `CAPACITYLENS_PORT_LANE` means an outer launcher already owns the lane. A nested
  launcher neither re-claims nor releases it.
- All ten lanes held is an immediate error naming each holder's pid and worktree, not a 90-second
  Playwright start failure that names one port.

### CPU budget: reservation, not sampling

A token allocator in the same directory, `cores - 1` tokens total (9 here). At claim time a run
reserves `min(desiredWorkers, available, ceil(cores / 2))` with a floor of 1, records the
reservation in its lane file, and releases at exit. Reservation is stable where rev 1's live-count
division was not: ten simultaneous starts cannot each observe "I am alone" and take the whole
machine, because the tokens are actually held.

Admission never blocks, so this is a **bound, not a hard cap**, and the plan states the bound rather
than claiming the pool is inviolable. An existing holder does not shrink when a later run arrives,
and a run that finds the pool empty still gets its floor of one. Worst case is therefore one
early run at the per-run ceiling plus nine single-worker runs — about 14 test processes on 10 cores,
against roughly 54 today at six concurrent runs. The per-run ceiling of `ceil(cores / 2)` exists
precisely to keep that worst case near the core count; without it the worst case is 18.

`CAPACITYLENS_TEST_SHARE` carries the reservation to the child. Consumers:

- `vite.config.ts` `test.maxWorkers` (top-level — Vitest 4).
- `playwright.config.ts` `workers: max(1, floor(share / 2))`, preserving today's half-the-cores
  ratio at a full reservation and leaving the per-project `workers: 1` overrides intact.

The server suite is deliberately not a consumer: every server gate command already passes
`--no-file-parallelism`, so it contributes one worker per run whatever the reservation says. It
still claims a lane and a token, so its one worker is counted against the pool.

Worker count does not move coverage percentages, but it does move duration and peak memory, so the
recorded CI timing budget is re-measured once at lane 0 rather than asserted to be unchanged.

## Tasks

**T0 — pin the documentation ports.** `docs-src/.vitepress/config.mts` gains both
`vite.server.port` and `vite.preview.port` (5900/5910, `strictPort: true`), followed by
`pnpm run docs:build` with the regenerated `docs/` committed, as `AGENTS.md` requires for any change
to a documentation build input. Ships alone, no dependency on anything below; removes the silent
`docs:dev` ↔ E2E collision on 5173 and the `docs:preview` ↔ `preview` ↔ `serve-dist` collision
on 4173.

**T1 — `scripts/ports.mjs` + `scripts/with-lane.mjs` + tests.** Pure module: bases table,
`portsForLane`, `resolveLane`, `releaseLane`, `reserveShare`, `releaseShare`. Launcher: claim,
preflight-reap, spawn, propagate exit code and signals, release. `node --test scripts/ports.test.mjs`
covering lane arithmetic and no-overlap across 0–9, mutex-serialised stale reclaim, pid-matched
release, exhaustion error, env override, and token reserve/release including the floor-of-one path.
Registered in `structuralChecks` (`scripts/gate-commands.mjs`).

**T2 — bind sites read the lane.** `vite.config.ts` (`server.port`, `preview.port`),
`playwright.config.ts` (the port constants and every `baseURL`), `scripts/dev-fullstack.mjs`,
`scripts/serve-dist.mjs`, and the `dev:api`/`dev:auth` port arguments in `package.json`.

**T3 — non-binding consumers read the lane.** `e2e/auth-helpers.ts:9` (currently a literal 8887),
`e2e/db-helpers.ts:10` (fallback), `server/scripts/check-health.mjs`, and the auth-mode env block in
`server/package.json` `start:auth-e2e` — which moves into `scripts/e2e-server.mjs` so `PORT`,
`SMALLSASS_ACCOUNT_PUBLIC_URL` and `CAPACITYLENS_CORS_ORIGIN` are derived together. Those three must
move together: a lane-shifted web port with a lane-0 CORS origin fails at request time, not at
start. `server/src/routes/appConfig.ts:14` and `server/scripts/generate-database-fixtures.ts:38`
stay literal by classification.

**T4 — route the scripts through the launcher.** The `package.json` script list above.

**T5 — CPU budget.** The two worker-sizing consumers (`vite.config.ts`, `playwright.config.ts`),
and one lane-0 re-measurement of the CI timing budget. No server-side change: those commands are
already `--no-file-parallelism`.

**T6 — policy and documentation.** `policy:ports` asserts that the _named_ bind and consumer files
from T2/T3 import from `scripts/ports.mjs` rather than carrying a literal — a whitelist of files to
check, not a tree-wide ban on port literals, which would fail on production defaults, prose and
assertion URLs. Rewrite the `AGENTS.md` line "Run only one E2E suite at a time across worktrees
because it binds fixed ports" to describe lanes and the `e2e:oidc` exception, and update
`docs-src/reference/development.md` — then `pnpm run docs:build` and commit the regenerated `docs/`.

## Out of scope

Docker, including the dex host-port mapping. Screenshot capture stays on the fixed `:5199`
convention. Remote or distributed execution — ten lanes on one machine is the target.

## Sequencing

T0 ships immediately and alone. T1 → T2/T3 (parallel, disjoint) → T4 → T5 → T6. T5 depends on T1's
allocator but not on lanes reaching the bind sites, so it can land before T2/T3 if those slip; it
is the change that addresses "six worktrees felt slow" even when nothing collides.

## Done

- Ten concurrent `pnpm run e2e` runs in ten worktrees complete, each on its own lane, with no
  EADDRINUSE and no cross-run failures. `e2e:oidc` is excluded and single-flight by design.
- A killed run leaves no port that blocks the next run in that worktree.
- Ten concurrent `pnpm run gate` runs produce no timeout failures that pass in isolation, with
  total test processes bounded near the core count rather than at ten times it.
- Lane 0 with a full CPU reservation reproduces today's ports and worker counts exactly.
