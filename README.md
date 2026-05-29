# Floaty

A small, **local-only** resource scheduler for a tiny creative agency — a lightweight clone of
[Float](https://www.float.com). Runs entirely in the browser (data in `localStorage`); no
server, no accounts, no per-seat pricing.

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

## Project docs
- **`DECISIONS.md`** — running log of design and judgement calls (incl. the grumpy multi-agent
  review and the bug / DX / UX / perf / a11y passes that followed).
- **`ZOOM_PLAN.md`** — the original plan for the multi-week timeline zoom *(shipped)*.
