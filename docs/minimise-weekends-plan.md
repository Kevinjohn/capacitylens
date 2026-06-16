# Plan — "Minimise weekends" (deferred Alpha feature #5)

> **Status: IMPLEMENTED** (2026-06-16, branch `minimise-weekends`) — built as designed, in the
> two reviewable commits below. `ColumnGeometry` (`src/components/scheduler/columnGeometry.ts`)
> replaced the uniform grid; the device-global pref defaults ON. See `DECISIONS.md` (UI &
> product → "Weekends minimise by default") and the decisions-log for the landing record. The
> plan below is kept as the design record.
>
> The other four Alpha items shipped in **v0.2.0**. This is the 5th, a **variable-width-column
> refactor of the scheduler's positioning AND drag-gesture core** (Size **L**) — far more than a
> CSS tweak. Built on its own branch off `main` (`minimise-weekends`).
>
> **Before you start (read current code — some of these files changed in v0.2.0):**
> `DateHeader.tsx` gained the sticky month label; `SchedulerGrid.tsx` gained the
> `disciplinesEnabled` thread + the left-column identity band; `buildSchedulerModel`'s
> signature is now `(data, origin, dayWidth, days, utilStart, utilEnd, filters, disciplinesEnabled)`.
> Re-read each file before editing — trust the code over any line numbers here.

## Goal (owner's exact ask)

A Settings toggle **"Minimise weekends"**, **default ON**. When on, the Saturday and
Sunday columns in the schedule shrink to the **bare minimum width** — wide enough only
for the two-digit date number — and their weekday label shows just **"S"** (both Sat and
Sun read "S", not "Sat"/"Sun"). The width cap should be expressed in **rem** so it scales
with the user's font size / zoom. When off, today's uniform behaviour is unchanged.

Weekends are NOT removed: people can work weekends (a resource's `workingDays` may include
Sat/Sun), allocations can start/end on a weekend, and bars span across them — so weekends
must stay as (narrow) columns and bars must still render across them with correct widths.

## Why this is hard (the load-bearing invariant)

The scheduler is a **uniform fixed-pixel grid**: a single scalar `dayWidth` (px, derived
from zoom via `resolveDayWidth`), and **every position is `index * dayWidth`**. The
pointer→date inverse is `Math.floor((clientX - laneLeft) / dayWidth)` and the drag delta is
`Math.round(deltaPx / dayWidth)`. Making weekends narrower means giving up that uniform
assumption, which ripples through the bar layout, the lane overlays, the today line, the
month/day header, the scroll-anchor, **and** the drag/resize gesture math.

Verified inventory of uniform-width sites (re-confirm against current code):

| File | What uses `index * dayWidth` / `dayWidth` scalar |
|---|---|
| `shared/src/lib/dateMath.ts` | `xForDate(date,origin,dayWidth)=dayIndex*dayWidth`; `widthForRange(start,end,dayWidth)=daysInclusive*dayWidth`. **App-only** — the server never imports these (it uses `parseDate`/`addDaysISO`/`countWorkingDays`). |
| `src/components/scheduler/schedulerModel.ts` | bar `x`/`width` and timeOff `x`/`width` via `xForDate`/`widthForRange`. Pure, unit-tested. |
| `src/components/scheduler/DateHeader.tsx` | per-day cell `width: dayWidth`; month-span `width: m.days*dayWidth`; weekend = `weekdayOf(d)===0||6`; weekday label `format(date,'EEE')`. (Also now hosts the v0.2.0 sticky month label.) |
| `src/components/scheduler/ResourceLane.tsx` | ALL overlays `left: i*dayWidth` / `width: dayWidth` (week separators, unavailable tint, over-markers, hover-"+" hint, draw ghost) **and** `indexAt(clientX)=floor((clientX-rect.left)/dayWidth)`. |
| `src/components/scheduler/AllocationBar.tsx` | `bar.x`/`bar.width`, the inset cap, and the live drag preview via `snappedBarGeometry(...,dayWidth)`. |
| `src/hooks/useDragResize.ts` | `snapDeltaToDays(dx, dayWidth)` on move AND commit. |
| `src/lib/gestureMath.ts` | `snapDeltaToDays(deltaPx,dayWidth)=Math.round(deltaPx/dayWidth)`. Pure, unit-tested. The weekend-aware DATE logic (`applyGesture`) is **unaffected** — it works on dates/working-day counts, not pixels. |
| `src/components/scheduler/allocationDrag.ts` | `snappedBarGeometry` converts snapped dates → px as `calendarDayDiff*dayWidth`. Pure, unit-tested. |
| `src/components/scheduler/SchedulerGrid.tsx` | `todayX`/`focusX` via `xForDate`; `totalWidth = days.length*dayWidth`; the zoom/resize **scroll-anchor** `el.scrollLeft=(scrollLeft/prevDayWidth)*dayWidth`; `visibleStartDate()=floor(scrollLeft/dayWidth)`. |
| `src/lib/schedulerConfig.ts` | `DAY_COLUMN_MIN_WIDTH=18` gates per-day rendering (below it the header shows week blocks — so minimise only applies at fine zoom); `WEEKDAY_LABEL_MIN_WIDTH=36`; `MIN_DAY_WIDTH=8`, `MAX_DAY_WIDTH=120`. |

## The design

### A. One `ColumnGeometry` object replaces the scalar `index * dayWidth`

New pure, unit-testable module **`src/components/scheduler/columnGeometry.ts`** — a
prefix-summed offsets array so columns can have per-day widths.

```ts
export interface ColumnGeometry {
  readonly widths: number[]    // widths[i] = px width of visible day i
  readonly offsets: number[]   // length n+1; offsets[i] = left edge of day i; offsets[n] = totalWidth
  readonly totalWidth: number
  x(index: number): number              // left edge of column i (clamped 0..n)
  widthOf(index: number): number        // widths[i] (0 out of range)
  spanWidth(startIdx: number, endIdx: number): number   // offsets[e+1]-offsets[s], >=0
  indexAt(px: number): number           // inverse of x(): pointer x (lane-relative) -> day index, clamped 0..n-1 (binary search)
  xForDateInGeom(date: ISODate): number // date -> left edge px (extrapolate full-width outside the window — see below)
  widthForDates(start: ISODate, end: ISODate): number   // inclusive [start,end] -> px width, >=0
}

export interface BuildGeometryOpts { minimiseWeekends: boolean; weekendWidth: number }
export function buildColumnGeometry(days: ISODate[], dayWidth: number, opts: BuildGeometryOpts): ColumnGeometry
```

**Formulas** (build once per render in `SchedulerGrid`, memoised on
`[days, dayWidth, minimiseWeekends, weekendWidth]`):

- `minimiseActive = opts.minimiseWeekends && dayWidth >= DAY_COLUMN_MIN_WIDTH`
  (below the per-day threshold the header is week-blocks, so minimising is meaningless —
  and `weekendWidth` could otherwise exceed `dayWidth` at extreme zoom-out).
- `widths[i] = (minimiseActive && (weekdayOf(days[i])===0 || 6)) ? Math.min(weekendWidth, dayWidth) : dayWidth`
- `offsets[0]=0; offsets[i+1]=offsets[i]+widths[i]; totalWidth=offsets[n]`
- `x(i)=offsets[clamp(i,0,n)]`; `widthOf(i)=widths[i]??0`; `spanWidth(s,e)=offsets[clamp(e+1)]-offsets[clamp(s)]` (≥0)
- `indexAt(px)`: binary search `offsets` for the segment containing `px`; clamp to `[0,n-1]`.
  **Must be the exact inverse of `x()` at boundaries** (see Risk 2).
- `xForDateInGeom(date)`: `i = dayIndex(date, days[0])`. If `i < 0` return `i*dayWidth`
  (full-width extrapolation → bar still overflows off-screen-left as today); if `i > n`
  return `offsets[n] + (i-n)*dayWidth`; else `offsets[i]`. *(`days[0] === ui.originDate`
  today — `visibleRange` starts at `ui.originDate` — so `todayX`/`focusX`, which currently
  pass `ui.originDate`, map correctly. Confirm that still holds.)*
- `widthForDates(start,end) = max(0, xForDateInGeom(addDaysISO(end,1)) - xForDateInGeom(start))`.

Add to `schedulerConfig.ts`:
```ts
// Bare-minimum weekend column = room for a 2-digit date. rem-based so it tracks font size.
export const WEEKEND_COLUMN_REM = 1.4          // ≈ a 2-digit number at text-xs + a little padding
```
…and resolve to px where the geometry is built: `weekendWidth = WEEKEND_COLUMN_REM * rootFontSizePx`,
where `rootFontSizePx = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16`
(memoise; recompute on the same ResizeObserver tick that re-measures the container). A flat
`~22px` constant is the cheap fallback if the rem read proves fiddly — the owner noted users
"in theory shouldn't" zoom, so px is acceptable, but rem is the stated preference.

### B. Threading

`SchedulerGrid` builds `geom` and passes it down (replacing scalar `dayWidth` math) to:
- `buildSchedulerModel(...)` — add a `geom` param; bar/timeOff `x`/`width` use `geom.xForDateInGeom`/`geom.widthForDates`. (Mind the current 8-arg signature with `disciplinesEnabled`.)
- `DateHeader` — per-day cell `width: geom.widthOf(i)`; month-span widths via `geom.spanWidth` over each span's index range; `totalWidth = geom.totalWidth`. Weekend label renders **"S"** (skip the `EEE` format) when `minimiseActive`; keep showing the date number. The v0.2.0 sticky month label keeps working — its widths now come from `geom`.
- `ResourceLane` — every overlay `left: geom.x(i)` / `width: geom.widthOf(i)`; draw-ghost via `geom.x(min)` + `geom.spanWidth(min,max)`; replace the local `indexAt` body with `geom.indexAt(clientX - rect.left)`; pass `geom` (and one shared `indexAt(clientX)` resolver) to `AllocationBar`.
- `AllocationBar` — `left/width` from `bar.x`/`bar.width` (already geom-derived in the model); pass an `indexAtClientX` resolver into `useDragResize`; call `snappedBarGeometry(mode, cur, deltaDays, opts, geom)`.

### C. Pointer / drag (the trickier half)

- **`useDragResize.ts`**: replace the `dayWidth` arg with an `indexAtClientX: (clientX:number)=>number`
  resolver (built in the lane from `geom` + the live lane rect, the same one the lane's
  draw-to-create uses — single inverse, no divergence). Compute
  `deltaDays = indexAtClientX(currentX) - indexAtClientX(startX)` on move and commit (each
  endpoint independently snapped to a column → correct even across narrow weekends), instead
  of `snapDeltaToDays(dx, dayWidth)`. The 4px drag-vs-click threshold stays a raw pixel test.
  Rewrite the lines ~59-62 "divide-by-zero guard" comment (there's no more divide; the guard
  moves to `geom.indexAt`, which must be total/never-NaN).
- **`allocationDrag.ts` `snappedBarGeometry`**: take `geom` instead of `(barX, dayWidth)`;
  body = `{ left: geom.xForDateInGeom(snapped.startDate), width: geom.widthForDates(snapped.startDate, snapped.endDate) }`.
  This makes the live preview pixel-identical to the committed model (both go through the
  same geometry) → no jump on release. Drop the now-unused `differenceInCalendarDays`/`daysInclusive` imports.
- **`gestureMath.snapDeltaToDays`**: now unused in production (single caller migrated).
  Remove it + its unit test (preferred — avoids two competing px→day models), or keep it dead.
  `applyGesture` and the weekend-aware logic are **unchanged**.

### D. Scroll-anchor + `visibleStartDate` (SchedulerGrid)

Both currently invert px→date with `/dayWidth` — wrong under variable widths.
- `visibleStartDate()`: `const idx = geom.indexAt(el.scrollLeft); return days[idx] ?? days[0]`.
- Zoom/resize anchor (the `el.scrollLeft = (scrollLeft/prevDayWidth)*dayWidth` effect):
  capture the **date** at the left edge under the PREVIOUS geometry, then re-locate it under
  the new one. Hold the previous geometry in a ref (`prevGeomRef`); key the effect on the
  memoised `geom` identity (it changes exactly when widths change):
  ```ts
  const leftDate = days[prevGeomRef.current.indexAt(el.scrollLeft)] ?? days[0]
  prevGeomRef.current = geom
  el.scrollLeft = geom.xForDateInGeom(leftDate)
  ```
  Keep the existing `didScroll` / `prev<=0` guards.
- `todayX = geom.xForDateInGeom(today)` (keep the `today in [start,end]` guard → null);
  `focusX = geom.xForDateInGeom(ui.focusDate)`; `totalWidth = geom.totalWidth` (also feeds the
  group-header gridcell width).

### E. The pref (device-global, default ON)

Mirror the existing single-boolean device-global pref pattern (`theme` / `sidebarOpen`):
- `src/lib/displayPrefs.ts` — `readStoredMinimiseWeekends()` / `writeStoredMinimiseWeekends()`,
  own key `floaty/minimiseWeekends`, **default `true`** (tolerant read, best-effort write —
  this is the documented "device-global non-tenant swallow" category).
- `src/store/useStore.ts` — `minimiseWeekends: boolean` state (init from the reader),
  `setMinimiseWeekends(v)` setter (write-through + `set`), and the typed setter on the interface.
- `src/components/settings/SettingsView.tsx` — a `ToggleRow` **"Minimise weekends"** (likely a
  "Schedule display" section, or beside the existing display toggles). It is **device-global**,
  NOT on the account and NOT in `AppData`/export — unlike disciplines (which is account-level).

## Files to change

**Must change**
- `src/components/scheduler/columnGeometry.ts` — **NEW** (the abstraction).
- `src/lib/schedulerConfig.ts` — `WEEKEND_COLUMN_REM` (+ doc).
- `src/lib/displayPrefs.ts` — the new pref's read/write helpers.
- `src/store/useStore.ts` — state field + setter + interface type.
- `src/components/settings/SettingsView.tsx` — the ToggleRow.
- `src/components/scheduler/SchedulerGrid.tsx` — build + thread `geom`; rework scroll-anchor, `visibleStartDate`, `todayX`/`focusX`/`totalWidth`.
- `src/components/scheduler/schedulerModel.ts` — `geom` param; bar/timeOff x/width.
- `src/components/scheduler/DateHeader.tsx` — per-day + month-span widths from `geom`; "S" weekend label.
- `src/components/scheduler/ResourceLane.tsx` — overlays + shared `indexAt` from `geom`.
- `src/components/scheduler/AllocationBar.tsx` — `indexAtClientX` resolver + `snappedBarGeometry(geom)`.
- `src/hooks/useDragResize.ts` — index-delta instead of `snapDeltaToDays`.
- `src/components/scheduler/allocationDrag.ts` — `snappedBarGeometry(geom)`.
- `src/lib/gestureMath.ts` — remove `snapDeltaToDays` (or leave dead). `applyGesture` untouched.

**Tests to add / update**
- `columnGeometry.test.ts` — **NEW**, the core safety net: prefix-sum; `indexAt(x(i))===i` round-trip at boundaries; narrow-weekend widths; ranges spanning weekends; below-threshold gating = uniform; `minimiseWeekends=false` reproduces `index*dayWidth` exactly.
- `displayPrefs.test.ts` — round-trip + default-true + tolerant read for the new key.
- `DateHeader.test.tsx` — under minimise ON, Sat/Sun show **"S"** and a narrow cell; add an OFF case keeping "Sat".
- `allocationDrag.test.ts` — geometry-based `snappedBarGeometry`; a snapped range spanning a narrow weekend.
- `gestureMath.test.ts` — drop the `snapDeltaToDays` cases if removed.
- `ResourceLane`/`AllocationBar` interaction tests — draw + drag across a narrow weekend map to the right dates; no preview-vs-commit jump.
- `SchedulerGrid` test — zoom flip preserves the left-edge date under minimise ON; `visibleStartDate` correctness.
- `schedulerModel.test.ts` — bar/timeOff x/width via geom (unchanged values with minimise OFF).
- `SettingsView.test.tsx` — the new toggle.
- E2E: a `minimise-weekends.spec.ts` — toggle off → weekend columns full width + "Sat"/"Sun"; toggle on (default) → narrow + "S"; a drag across a weekend lands on the right date. Update `user-stories/REFERENCE.md` **first** (the new Settings toggle + the "S" weekend label), then the affected stories.

**Not changed (verified):** `shared/src/lib/dateMath.ts` `xForDate`/`widthForRange` may stay (now unused by the app, still pure + tested; removal optional). No server files. `schedulingDays.ts`/`integrity.ts`/`capacity.ts`/`lanePacking.ts` untouched. No `AppData`/export schema change (the pref is device-global).

## Sequencing — two reviewable commits

1. **Mechanical, behaviour-preserving:** introduce `ColumnGeometry` and thread it everywhere,
   built with `minimiseWeekends=false` hard-wired. With the flag off `widths[i]===dayWidth`, so
   `x(i)===i*dayWidth`, `indexAt===floor(px/dayWidth)`, `totalWidth===days.length*dayWidth` —
   **byte-identical behaviour**, every existing test passes unchanged. Add `columnGeometry.test.ts` here.
2. **The feature:** add the pref (displayPrefs/store/Settings), wire `minimiseWeekends` +
   `WEEKEND_COLUMN_REM` into the builder, switch DateHeader to "S", add the feature tests.

Keep this branch **separate from any other scheduler work** — it touches the same files most
scheduler tweaks do; interleaving is the main avoidable risk.

## Highest-risk traps (and how the design avoids each)

1. **Drag preview jumping on release** — route BOTH the live preview (`snappedBarGeometry`) and
   the commit (model rebuild) through the **same** `ColumnGeometry`, so a drag crossing a narrow
   weekend lands where it previewed.
2. **Off-by-one at the weekend boundary (the inverse)** — `indexAt` must be the exact inverse of
   `x()`: a click at `offsets[i]` → `i`, at `offsets[i]-1` → `i-1`. Use one binary-search `indexAt`,
   unit-tested with the boundary round-trip, and `indexAt(curr)-indexAt(start)` (each endpoint
   snapped independently), never "sum widths along the path".
3. **Zoom scroll-anchor + fit-to-zoom coupling** — (a) the line-~125 anchor must preserve the
   left-edge **date** via the date round-trip above. (b) `resolveDayWidth=floor(avail/(weeks*7))`
   assumes 7 equal columns, so a "1-week" zoom now slightly under-fills the width (5·dayWidth +
   2·weekendWidth < 7·dayWidth). This is **cosmetic, not a correctness bug** — leave `resolveDayWidth`
   unchanged and accept the right-edge slack; a "true fit" recompute is a follow-up. Call this out
   so nobody "fixes" the fit math and destabilises the anchor.

## Verification

`npm run gate` (tsc + eslint + vitest + build) **and** `npm run e2e`, all green; plus
`npm run gate:server` is unaffected (no server change) but cheap to confirm. Screenshots are the
visual oracle — capture: minimise ON (narrow Sat/Sun, "S" labels, bars spanning weekends still
aligned) vs OFF (uniform, "Sat"/"Sun"), at a couple of zoom levels; and a drag across a weekend
landing on the intended date. Re-run `@axe-core` (light + dark).

**Size: L** (solidly large; the new code is a small pure module + a textbook pref, but the blast
radius spans ~7 scheduler files, three on the load-bearing drag/scroll/preview path).
