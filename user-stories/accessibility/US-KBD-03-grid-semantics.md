# US-KBD-03 — Scheduler grid semantics & row summary

**Area:** Keyboard & accessibility · **Persona:** Screen-reader user · **Linked E2E:** `e2e/accessibility.spec.ts` → "the scheduler exposes grid roles and an sr-only per-row capacity summary"

## Goal
Have the schedule expose proper grid structure to assistive tech, and give each
resource row a spoken summary of its capacity state that doesn't rely on colour.

## Why
The timeline communicates a lot through colour and position — over-allocation tints,
time-off hatching, bar placement — none of which a screen reader can convey. Exposing
`role=grid/row/rowheader/gridcell` lets assistive tech navigate the schedule as a grid,
and an `sr-only` per-row summary translates the colour-only cues into words, so a
screen-reader user learns a person is overbooked or off without seeing the tints.

## How (end-to-end)
**Precondition:** Seeded app open at Schedule (`/`). The capacity wording is
time-relative (it keys off *today*'s 14-day forward window). Running near the seed
dates, *Tyler Nix*'s 3–4 June over-allocation falls inside that window; otherwise the
"Overbooked…" phrase may not apply, but the summary still renders.
1. Open the accessibility tree (DevTools → Accessibility pane, or a screen reader).
2. Confirm the scrollable schedule container has `role="grid"` (labelled "Resource
   schedule").
3. Within it, confirm discipline group headers and resource rows are `role="row"`, the
   sticky left cells are `role="rowheader"`, and the lane cells are `role="gridcell"`.
4. Inspect *Tyler Nix*'s row header — it contains an `sr-only` summary that reads (near
   the seed dates): **"Overbooked in the next two weeks. 1 time-off period.
   2 allocations."**
5. Inspect a row with no over-allocation and no time off — its summary omits those
   clauses and just states the allocation count (e.g. "N allocations.").

## Acceptance criteria
- ✅ The grid container has `role="grid"`.
- ✅ Rows expose `role="row"`; left-column cells `role="rowheader"`; lane cells
  `role="gridcell"`.
- ✅ Each resource row's header contains an `sr-only` capacity summary in the form
  "Overbooked in the next two weeks. N time-off periods. M allocations." (the
  "Overbooked…" and "…time-off period(s)." clauses appear only when they apply).
- ✅ The summary's overbooked/time-off clauses are colour-independent — they convey in
  text what the over-marker tint and time-off hatch convey visually.
