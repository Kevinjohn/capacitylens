# CapacityLens

A server-backed resource scheduler — an agency resource & capacity planner that runs in the browser.
By default it talks to a same-origin SQLite-backed API for a shared, server-persisted dataset; even
with no `VITE_CAPACITYLENS_API` set, the build runs in server mode (the client calls a relative
`/api`). The in-browser **demo** build is an explicit opt-in (`VITE_CAPACITYLENS_DEMO=1`): zero setup,
no database and no login, with your data living in `localStorage` and never leaving the device. Both
modes talk through the same persistence seam, so nothing else about the app changes.

> ⚠️ **Deploying without a backend? Build with `VITE_CAPACITYLENS_DEMO=1`.** The default build is
> server mode and expects a backend at the **same-origin `/api`** — empty env does NOT fall back to
> localStorage. A plain `vite build` (or `vite preview`) served on a static host with no `/api`
> backend boots straight into a "can't reach the server" screen. For any backend-less deploy (static
> host, `vite preview`, a demo link), build the localStorage demo: `VITE_CAPACITYLENS_DEMO=1 vite build`.

**Deliberately small.** CapacityLens replaces the resourcing spreadsheet: a helicopter view of
who's busy, who's free, who's overworked — week by week, for small agencies with a few
staff and rotating freelancers. It is intentionally **not** feature-rich: no budgets,
no timesheets, no hour-level tracking. One tool, one problem, done well. Day-to-day
navigation is keyboard-friendly: **Enter** submits any dialog, **⌘K / Ctrl+K** opens a
command palette (jump to a person, project, client, page, or date), **⌘Z** undoes.
Each company account sets its own calendar in Settings (timezone, default GMT; week
start, default Monday) and can turn disciplines on or off for the whole team.

See **[CHANGELOG.md](CHANGELOG.md)** for release notes.

## Run it

```bash
pnpm install
pnpm run dev        # FULL-STACK: SQLite API (:8787) + Vite (:5173) via a dev /api proxy
```

> **`pnpm run dev` needs Node 24.** It is now a full-stack launcher: it boots the `node:sqlite`
> SQLite API on **:8787** alongside Vite on **:5173** and wires a Vite dev proxy so the app talks to
> a same-origin `/api` (exactly like production behind nginx). Node's built-in `node:sqlite` is the
> hard floor — on Node < 24 the API fails to start (and `pnpm run dev` refuses to come up half-stack).
> If you just want a zero-setup preview with **no backend and no Node 24**, use:
>
> ```bash
> pnpm run dev:demo   # Vite-only localStorage DEMO build (VITE_CAPACITYLENS_DEMO=1)
> ```
>
> A third script, `pnpm run dev:web`, is Vite-only **server mode** (the old `dev`) — it talks to a
> same-origin or explicit API you run yourself.

Open **the URL Vite prints** (`http://127.0.0.1:5173/`) and pick **Studio North** at the
account picker to land on the seeded data. On `pnpm run dev` that seed comes from **SQLite** (the
server seeds a fresh DB on its first boot); the `dev:demo` build seeds `localStorage` instead. The
dev server binds IPv4 loopback with a **strict port**: if 5173 is already taken (a stale server, or a
sibling repo — floaty-schedule and delivery-diary claim the same port), Vite exits with an error
instead of silently starting on 5174 — kill the squatter (`lsof -nP -iTCP:5173 -sTCP:LISTEN`) rather
than browsing a port nothing answers; that mismatch looks like a blank white page with an empty
console. (The full-stack launcher likewise refuses to start if **:8787** is already held.)

If the page instead sticks on **"Loading… / JavaScript isn't running"**, the browser is
blocking scripts for the site (per-site JavaScript setting or a content-blocker extension —
both also apply in private windows when allowed there). Enable JavaScript for the site and
reload; the whole app is JS-rendered.

## Tech

React + TypeScript + Vite. Zustand for state, Tailwind for styling, React Router
for navigation. Vitest + Testing Library for unit/component tests, Playwright for
E2E. Organised as a pnpm workspace:

- **(root)** — the web app (`src/`).
- **`shared/`** — `@capacitylens/shared`: the pure, environment-agnostic domain core
  (types, validation, integrity, cascade, import remap, migrate, seed) shared by the
  app and the server.
- **`server/`** — the **default** backend: a Node + `node:sqlite` REST API behind the same
  `PersistenceAdapter` seam, started automatically by `pnpm run dev` (see `server/README.md`).
  A build with no `VITE_CAPACITYLENS_API` talks to it at a same-origin `/api`;
  `VITE_CAPACITYLENS_API=<origin>` only **overrides the backend origin** (e.g. a remote API) — it's
  not an on-switch, since the server is already the default.

## Data model

The single source of truth is a normalized store, multi-tenant by **Account**
(every other entity is scoped to one account):

- **Accounts** — tenants/companies; you pick one, and the whole dataset is scoped to it.
  Carries the team-wide calendar config (`timezone`, `weekStartsOn`), `schedulingMode`, and
  whether disciplines are used (`disciplinesEnabled`, default on).
- **Disciplines** — optional groupings for resources (e.g. Design, Development); a company
  that doesn't use them can switch them off in Settings (they then vanish from the UI, data kept).
- **Resources** — the people (or project-bound placeholders) you schedule.
- **Clients** — group projects.
- **Projects** — belong to a client.
- **Phases** — optional groupings of activities within a project.
- **Activities** — belong to a project (optionally a phase), or are project-less (internal / repeatable).
- **Allocations** — a resource × activity × date-range block with hours/day + status (the core unit).
- **Time off** — per-resource unavailable ranges.

The canonical type definitions live in `shared/src/types/entities.ts`.

## The green gate

```bash
pnpm run gate         # paraglide:compile && tsc -b && eslint . && vitest run && vite build
pnpm run gate:server  # type-check + test the server/ workspace (the default backend)
pnpm run e2e          # Chromium: core + db-backed + auth-backed specs; boots 3 Vite + 2 API servers, needs Node 24
pnpm run e2e:webkit   # the core specs on Safari/WebKit (opt-in; Vite-only, no Node 24)
pnpm run e2e:firefox  # the core specs on Firefox/Gecko (opt-in; Vite-only, no Node 24)
pnpm run e2e:browsers # the core specs on ALL 3 engines: Chromium + WebKit + Firefox (Vite-only, no Node 24)
pnpm run e2e:all      # e2e:browsers PLUS the Chromium-only db/auth server specs (needs the servers + Node 24)
```

The `server/` workspace is kept out of the root `gate` (it needs Node's `node:sqlite`, no
browser build); run it separately with `gate:server`. **There is no automated CI** — the green gate
is enforced locally by contributors and again at review, so run all three locally and push only with
them green. Node 24+ (`.nvmrc`).

`e2e` is Chromium by default (the fast inner loop) — but a plain `pnpm run e2e` (no `--project`
filter) runs **all three** Chromium-flavoured projects at once: `chromium` (the core specs),
`db-backed`, and `auth-backed`. That boots three Vite dev servers plus the SQLite and auth API
servers, so it needs **Node 24** even though "Chromium" is the headline. The core specs run
against the **demo/localStorage build** (Vite-only, via `dev:demo`); the db-backed/auth-backed
specs exercise real server round-trips. Cross-engine coverage of the **core specs only** is
opt-in: `e2e:webkit` / `e2e:firefox` run a single engine, and **`e2e:browsers` runs the core specs
on all three** (Chromium + WebKit, then Firefox). All of these boot **only** the Vite dev server,
so they need neither the SQLite/auth servers nor Node 24 and run anywhere the app builds.
`e2e:all` is the superset — `e2e:browsers` plus the Chromium-only db/auth server specs (so it needs
the servers + Node 24, same as plain `pnpm run e2e`). In both `e2e:browsers` and `e2e:all`, WebKit
runs first and Firefox second, both always run, and the run fails if either engine fails. The
db-backed/auth-backed specs stay Chromium-only (they exercise server round-trips, not cross-engine
rendering).

> **Stop `pnpm run dev` before running `pnpm run e2e`.** Both bind **:5173**, and e2e deliberately does
> NOT reuse a running dev server (`reuseExistingServer: false`) — a reused server-mode dev server
> would corrupt the demo/localStorage specs — so it boots its own. With `pnpm run dev` still holding
> the strict port, `pnpm run e2e` fails to start. Kill the dev server first.

## Docs map

- **`DECISIONS.md`** — slim, present-tense digest of standing decisions that constrain the code
  (read it whole; it's short).
- **`DEFENSIVE-CODING.md`** — the defensive-coding & commenting standard for contributors:
  surface-never-swallow, the error model, where `try/catch` belongs vs. is harmful, and the
  TSDoc/why-comment bar. Read it before sending a change.
- **`NEEDS-INPUT.md`** — open product questions to revisit with the owner.
- **`docs/decisions-log.md`** — dated, append-only build/remediation log (large — grep or tail it,
  don't read it whole).
- **`CODE_REVIEW.md`** — findings from the big review passes (referenced by the log).
- **`CLAUDE.md`** — working notes for the AI pair.
- **`user-stories/REFERENCE.md`** — routes / labels / `data-testid`s / seed data, the single source
  of truth the E2E specs lean on.
- **`server/README.md`** — how to run and reason about the default backend.
- **`docs/self-hosting.md`, `docs/runbook.md`, `docs/deploy.md`, `docs/production-{plan,posture}.md`,
  `docs/privacy.md`** — running & operating a self-hosted (server-backed) instance.
