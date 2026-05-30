# Floaty

A small, **local-only**, **multi-company** resource scheduler for a tiny creative agency — a
lightweight clone of [Float](https://www.float.com). Runs entirely in the browser (data in
`localStorage`); no server, no backend, no per-seat pricing. Pick a company on launch (the
account picker) and every screen is scoped to it.

## What it does
- Manage **resources** (people **and** unnamed placeholders) grouped by **discipline**,
  **clients → projects → phases → tasks**, and **time off**.
- A **timeline scheduler**: draw / drag / resize allocations, lane-stacking, per-day
  **capacity** with over-allocation flags, a near-term **load %** (red when overbooked in the
  next two weeks), time-off blocks, a today line, **collapsible** discipline groups,
  **drag-between-rows** reassignment (with a drop-target highlight and a toast when a move is
  rejected), and a **hover/focus detail popover** on each bar.
- **Multi-week zoom** (1 / 2 / 4 / 6 / 8 weeks), a **jump-to-date** picker, a **Today**
  re-centre, and a **Work / Time-off draw mode** so you can draw time off on the timeline too.
- **Keyboard & screen-reader support**: bars are focusable (Enter edits, arrows move, Shift+arrow
  resizes), the grid exposes row/cell semantics with per-row capacity summaries, labels meet
  WCAG AA contrast, and an axe check guards it (`e2e/a11y.spec.ts`).
- **Filters** (discipline / client / project / search / hide-tentative), **undo/redo**,
  **JSON import/export**, and automatic **dark mode**.

## Stack
React 19 + Vite + TypeScript · Tailwind v4 · Zustand · date-fns · Vitest + Testing Library ·
Playwright.

## Scripts
| Command | What |
|---|---|
| `npm run dev` | Dev server at http://localhost:5173 |
| `npm test` | Unit / component tests (Vitest + RTL) |
| `npm run coverage` | Tests with a V8 coverage report |
| `npm run e2e` | Playwright end-to-end tests |
| `npm run lint` | ESLint |
| `npm run build` | Type-check + production build |

## Architecture
- **Pure domain layer** (`src/lib`) — date math, lane packing, capacity, integrity, gesture
  math, colour. No React; fully unit-tested. Geometry uses integer **day-indices × dayWidth**
  (never millisecond `Date` math) so it's DST/timezone-safe.
- **State** (`src/store`) — a Zustand store of normalized entities + UI state, separate from
  rendering. Mutations flow through one path that also powers **undo/redo**.
- **Persistence** (`src/data`) — `localStorage` behind a swappable async `PersistenceAdapter`;
  the persisted blob is **versioned** with a `migrate()` step.
- **Single sources of truth** — enum labels/options (`lib/metadata.ts`), colour defaults
  (`lib/palette.ts`), scheduler config (`lib/schedulerConfig.ts`). The scheduler's view-model
  is a pure, tested builder (`components/scheduler/schedulerModel.ts`); the component renders it.
- **Design tokens** in `src/index.css` (`@theme` + CSS custom properties) drive light/dark.

## Testing & quality
- **Unit / component** — Vitest + Testing Library across the pure domain layer, the store, and
  components (`npm test`; `npm run coverage` for a report).
- **End-to-end** — Playwright drives the real app across **every** feature: full per-entity
  CRUD, the allocation editor, drag / resize / draw / reassign, zoom / pan / today / jump,
  filters, undo/redo, time-off, import/export, keyboard & nav (`npm run e2e`). Each spec maps
  to a user story (see below).
- **Accessibility** — `@axe-core/playwright` runs against the scheduler (light **and** dark) and a
  form modal, failing on any serious/critical WCAG 2.1 AA violation (`e2e/a11y.spec.ts`).
- **CI** — `.github/workflows/ci.yml` runs type-check → lint → unit → build → E2E on every push
  and PR.
- **Working principle:** automated checks prove behaviour and structure; **screenshots are the
  visual oracle and axe is the a11y oracle** — a passing `toBeVisible`/`getByRole` is necessary,
  not sufficient (see `DECISIONS.md`).

## Project docs
- **`user-stories/`** — one end-to-end user story per capability (88 across 13 areas):
  goal → why → how → checkable acceptance criteria, runnable by a human as a test script and
  each mapped to its automated coverage. Start at [`user-stories/README.md`](user-stories/README.md).
- **`DECISIONS.md`** — running log of design and judgement calls (incl. the grumpy multi-agent
  review and the bug / DX / UX / perf / a11y passes that followed, plus the xhigh review-findings
  remediation pass).
- **`ZOOM_PLAN.md`** — the original plan for the multi-week timeline zoom *(shipped)*.
