# Floaty (working title)

A local-first resource scheduler — a Float-style planner that runs in the browser.
By default there's no backend and no login: your data lives in `localStorage` and
never leaves the device. An **optional** SQLite-backed API can be switched on (see
below) when you want a shared, server-persisted dataset — the app talks to it
through the same persistence seam, so nothing else changes.

**Deliberately small.** Floaty replaces the resourcing spreadsheet: a helicopter view of
who's busy, who's free, who's overworked — week by week, for small agencies with a few
staff and rotating freelancers. It is intentionally **not** feature-rich: no budgets,
no timesheets, no hour-level tracking. One tool, one problem, done well. Day-to-day
navigation is keyboard-friendly: **Enter** submits any dialog, **⌘K / Ctrl+K** opens a
command palette (jump to a person, project, client, page, or date), **⌘Z** undoes.
Each company account sets its own calendar in Settings (timezone, default GMT; week
start, default Monday) and can turn disciplines on or off for the whole team.

See **[CHANGELOG.md](CHANGELOG.md)** for release notes (currently **v0.9.1**).

## Run it

```bash
npm install
npm run dev
```

Open **the URL Vite prints** (`http://127.0.0.1:5173/`) and pick **Studio North** at the
account picker to land on the seeded demo data. The dev server binds IPv4 loopback with a
**strict port**: if 5173 is already taken (a stale server, or a sibling repo — floaty-schedule
and delivery-diary claim the same port), Vite exits with an error instead of silently starting
on 5174 — kill the squatter (`lsof -nP -iTCP:5173 -sTCP:LISTEN`) rather than browsing a port
nothing answers; that mismatch looks like a blank white page with an empty console.

If the page instead sticks on **"Loading… / JavaScript isn't running"**, the browser is
blocking scripts for the site (per-site JavaScript setting or a content-blocker extension —
both also apply in private windows when allowed there). Enable JavaScript for the site and
reload; the whole app is JS-rendered.

## Tech

React + TypeScript + Vite. Zustand for state, Tailwind for styling, React Router
for navigation. Vitest + Testing Library for unit/component tests, Playwright for
E2E. Organised as an npm workspace:

- **(root)** — the web app (`src/`).
- **`shared/`** — `@floaty/shared`: the pure, environment-agnostic domain core
  (types, validation, integrity, cascade, import remap, migrate, seed) shared by the
  app and the server.
- **`server/`** — an optional Node + `node:sqlite` REST API behind the same
  `PersistenceAdapter` seam. Off by default; see `server/README.md`. Enable it with
  `VITE_FLOATY_API=http://localhost:8787 npm run dev`.

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
npm run gate         # tsc -b && eslint . && vitest run && vite build
npm run gate:server  # type-check + test the optional server/ workspace
npm run e2e          # Playwright on Chromium (boots its own dev server)
npm run e2e:webkit   # the core specs on Safari/WebKit (opt-in; Vite-only, no Node 24)
npm run e2e:firefox  # the core specs on Firefox/Gecko (opt-in; Vite-only, no Node 24)
npm run e2e:browsers # the core specs on ALL 3 engines: Chromium + WebKit + Firefox (Vite-only, no Node 24)
npm run e2e:all      # e2e:browsers PLUS the Chromium-only db/auth server specs (needs the servers + Node 24)
```

The `server/` workspace is kept out of the root `gate` (it needs Node's `node:sqlite`, no
browser build); run it separately with `gate:server`. Run all three locally before pushing — hosted CI is
optional and not enabled here. Node 24+ (`.nvmrc`).

`e2e` is Chromium by default (the fast inner loop). Cross-engine coverage of the core localStorage
specs is opt-in: `e2e:webkit` / `e2e:firefox` run a single engine, and **`e2e:browsers` runs the
core specs on all three** (Chromium + WebKit, then Firefox). All of these boot **only** the Vite dev
server, so they need neither the SQLite/auth servers nor Node 24 and run anywhere the app builds.
`e2e:all` is the superset — `e2e:browsers` plus the Chromium-only db/auth server specs (so it needs
the servers + Node 24). In both `e2e:browsers` and `e2e:all`, WebKit runs first and Firefox second,
both always run, and the run fails if either engine fails. The db-backed/auth-backed specs stay
Chromium-only (they exercise server round-trips, not cross-engine rendering).

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
- **`server/README.md`** — how to run and reason about the optional API.
