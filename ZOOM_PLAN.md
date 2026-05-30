> **STATUS: SHIPPED.** Historical pre-implementation plan; see `DECISIONS.md` and the
> source for the current behaviour.

# Plan — multi-week scheduler zoom (1 / 2 / 4 / 6 / 8 weeks)

## Context / goal
Today the scheduler has a binary `zoom: 'day' | 'week'` that only shrinks the day-column
width (still rendered as per-day columns with per-day headers). Replace it with **preset
zoom levels expressed in weeks visible** — 1, 2, 4, 6, 8 — where the timeline sizes its
day columns so that *that many weeks fit the visible area*, and the header switches to a
two-tier **month + week** layout (Float-style). Geometry already runs on integer day
indices × `dayWidth`, so bars/lanes/capacity need no math changes — only the column width,
the header, and the background gridlines change.

Done = the zoom control offers 1w/2w/4w/6w/8w; picking a level fits ~that many weeks to the
visible width; the header shows month spans + week-start markers; and the full gate is green
(tsc, eslint, unit + E2E, build).

## Key decision: responsive day width (fit N weeks to the viewport)
`dayWidth = clamp(floor((timelineWidth − leftCol) / (weeks × 7)), MIN, MAX)`, recomputed on
zoom change and on container resize (ResizeObserver). This makes "N-week view" literally show
N weeks. Clamp with `MIN_DAY_WIDTH ≈ 8` (8-week view stays legible) and `MAX_DAY_WIDTH ≈ 56`
(1-week view doesn't get absurdly wide on big screens). Extract the calc as a **pure**
`resolveDayWidth(availableWidth, weeks)` so it's unit-testable without a DOM.

## What currently references the things that change (migration map)
- `src/lib/schedulerConfig.ts` — `Zoom = 'day'|'week'`, `DAY_WIDTH`. → becomes `WeeksZoom = 1|2|4|6|8`, `ZOOM_LEVELS`, `resolveDayWidth()`, width clamps. Keep `DEFAULT_RANGE_DAYS`/origin (widen range to ~26 weeks so coarse zooms can still scroll).
- `src/store/useStore.ts` — `SchedulerUI.zoom`, `ui.dayWidth`, `setZoom`, `defaultUI`. → `zoom: WeeksZoom`; **remove `ui.dayWidth`** (now derived in the grid from measurement); `setZoom(weeks)`. Re-export `WeeksZoom`.
- `src/components/scheduler/SchedulerToolbar.tsx` — Day/Week segmented buttons. → 1w/2w/4w/6w/8w segmented control (`aria-pressed`).
- `src/components/scheduler/SchedulerGrid.tsx` — reads `ui.dayWidth`, threads it to `DateHeader`/`ResourceLane`/`buildSchedulerModel`. → measure scroll container width (ref + ResizeObserver), compute `dayWidth = resolveDayWidth(width, ui.zoom)`, thread *that* down. Recompute `todayX`/scroll on dayWidth change.
- `src/components/scheduler/DateHeader.tsx` — single per-day row. → two tiers (months top, weeks bottom); day numbers only when `dayWidth ≥ ~24`.
- `src/components/scheduler/ResourceLane.tsx` — per-day background cells + weekend tint. → week-boundary separators always; per-day weekend tint only when `dayWidth ≥ ~20` (fewer nodes at coarse zoom).
- Tests referencing the old shape: `src/store/selectors.test.ts` (SchedulerUI literal — drop `dayWidth`, set `zoom`), `src/store/useStore.test.ts` (`setZoom('week')`/dayWidth assertions), `src/components/scheduler/SchedulerGrid.test.tsx` (`setZoom('day')` → numeric), `src/components/scheduler/SchedulerToolbar.test.tsx` (zoom buttons), `e2e/*` (`{ name: 'Day' }` → `1w`/`8w`). The render tests that pass an explicit `dayWidth` to `DateHeader` keep working.

## New `lib/dateMath` helpers (pure, tested)
- `startOfWeekISO(date, weekStartsOn = 1)` — Monday-start week start.
- `monthLabel(date)` / month-span grouping for the header (or compute spans in `DateHeader` from `eachDayISO`).
- (Reuse `eachDayISO`, `weekdayOf`, `addDaysISO`, `format`.)

## Header design (two tiers)
- **Month row (top):** group the visible days by calendar month; each span width = (days in month within window) × dayWidth; label `MMM yyyy` (or just `MMMM`). Sticky under the corner.
- **Week row (bottom):** a marker at each week start (Monday) with label = week-start `d MMM` (e.g. "1 Jun"); at `dayWidth ≥ 24` also render small day numbers per column. Today column highlighted as now.
- Weekend tint in the header only at fine zoom.

## Background gridlines (ResourceLane)
- Always draw a slightly stronger vertical separator at each **week boundary**.
- Draw the existing per-day cell borders + weekend `bg-base` tint **only** when `dayWidth ≥ 20`.
- Keep `data-testid="unavailable-day"` / `over-marker` semantics (capacity overlay unchanged); when day cells aren't rendered at coarse zoom, still render over-markers/time-off blocks by date position.

## Milestones (each behaviour-preserving where possible; gate after each)
- **MZ1 — config + store.** `schedulerConfig`: `WeeksZoom`, `ZOOM_LEVELS = [1,2,4,6,8]`, `MIN/MAX_DAY_WIDTH`, pure `resolveDayWidth(availableWidth, weeks)` (+ unit tests). Store: `zoom: WeeksZoom` default `4`, drop `ui.dayWidth`, `setZoom(weeks)`. Fix the SchedulerUI test literals + store tests.
- **MZ2 — grid measurement.** SchedulerGrid measures its scroll container (ref + ResizeObserver, with a sane default for tests), derives `dayWidth`, threads it everywhere it used `ui.dayWidth`. Verify existing scheduler render/interaction tests still pass (they pass dayWidth explicitly or via the grid).
- **MZ3 — header + gridlines.** Two-tier `DateHeader`; week-separator background + conditional weekend tint in `ResourceLane`. Render tests for month/week tiers at 1w and 8w.
- **MZ4 — toolbar.** Replace Day/Week with 1w/2w/4w/6w/8w (`aria-pressed`); update toolbar test.
- **MZ5 — E2E + gate.** E2E: switch to 8w → many more day columns visible + a month label present; switch to 1w → wide columns. Then full gate (tsc, eslint, unit, build, E2E) green; capture light screenshots at 1w and 8w to verify visually (screenshots are the oracle).

## Risks / watch-list
- **jsdom has no layout** — ResizeObserver/`clientWidth` are 0 in tests. Give SchedulerGrid a fallback width (e.g. default to a constant when measured width is 0) so unit tests get a usable `dayWidth`; keep `resolveDayWidth` pure-tested for the real math.
- **Node count** at coarse zoom — gate per-day cells behind the `dayWidth ≥ 20` check so 8-week × many rows doesn't explode the DOM.
- **Tiny bars** at 8w — keep min label truncation; resize grips stay 6px (still grabbable). Drag/resize math unchanged (snap is per-`dayWidth`).
- **Today scroll** — recompute on `dayWidth` change; don't fight the user after first scroll.

## Verification
`npx tsc -b` · `npm run lint` · `npm test` (+ new unit tests) · `npm run build` · `npm run e2e`
(+ the new zoom E2E), then light screenshots at 1-week and 8-week to confirm the header tiers
and column density on screen.
