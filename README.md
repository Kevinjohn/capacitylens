# Floaty (working title)

A local-first resource scheduler — a Float-style planner that runs in the browser.
By default there's no backend and no login: your data lives in `localStorage` and
never leaves the device. An **optional** SQLite-backed API can be switched on (see
below) when you want a shared, server-persisted dataset — the app talks to it
through the same persistence seam, so nothing else changes.

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
- **Disciplines** — groupings for resources (e.g. Design, Development).
- **Resources** — the people (or project-bound placeholders) you schedule.
- **Clients** — group projects.
- **Projects** — belong to a client.
- **Phases** — optional groupings of tasks within a project.
- **Tasks** — belong to a project (optionally a phase).
- **Allocations** — a resource × task × date-range block with hours/day + status (the core unit).
- **Time off** — per-resource unavailable ranges.

The canonical type definitions live in `shared/src/types/entities.ts`.

## The green gate

```bash
npm run gate         # tsc -b && eslint . && vitest run && vite build
npm run gate:server  # type-check + test the optional server/ workspace
npm run e2e          # Playwright (boots its own dev server)
```

The `server/` workspace is kept out of the root `gate` (it needs `--experimental-sqlite`); run it
separately with `gate:server`. CI runs all three.

## Docs map

- **`DECISIONS.md`** — slim, present-tense digest of standing decisions that constrain the code
  (read it whole; it's short).
- **`NEEDS-INPUT.md`** — open product questions to revisit with the owner.
- **`docs/decisions-log.md`** — dated, append-only build/remediation log (large — grep or tail it,
  don't read it whole).
- **`CODE_REVIEW.md`** — findings from the big review passes (referenced by the log).
- **`CLAUDE.md`** — working notes for the AI pair.
- **`user-stories/REFERENCE.md`** — routes / labels / `data-testid`s / seed data, the single source
  of truth the E2E specs lean on.
- **`server/README.md`** — how to run and reason about the optional API.
