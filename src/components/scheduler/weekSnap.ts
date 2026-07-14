import { startOfWeekISO } from '@capacitylens/shared/lib/dateMath'
import type { ColumnGeometry } from './columnGeometry'
import type { ISODate } from '@capacitylens/shared/types/entities'

// The "snap to week start" floor, extracted as a pure function so the scroll-idle behaviour in
// SchedulerGrid is unit-testable without a measured DOM (in jsdom the grid container is never laid
// out — clientWidth === 0 — so the component's onScroll snap normally early-returns). The component
// (Feature 2's scroll-idle snap) calls this; the geometry is built by the exhaustively-tested
// buildColumnGeometry, so the px↔day↔date round-trip is exact at integer boundaries.
//
// FLOOR, never forward — by design. Forward weeks are reached via Prev/Next; a free scroll only ever
// settles BACKWARD onto its own week start. And it converges in ONE step: a programmatic scroll
// (zoom / recenter, Feature 1) has already landed on a week start, so target ≈ scrollLeft, the
// epsilon guard returns null, and the caller no-ops — no feedback loop where the snap re-triggers
// itself.

/**
 * Floor `scrollLeft` to the px offset of the week start of the day currently at the left edge.
 *
 * @param geom         the column geometry for `days` (from {@link buildColumnGeometry}); supplies
 *                     the exact px↔day inverse (`indexAt`) and date→px (`xForDateInGeom`).
 * @param days         the visible day window (one validated `ISODate` per column).
 * @param scrollLeft   the container's current horizontal scroll position, in px.
 * @param weekStartsOn 0 = Sunday, 1 = Monday (ISO-style) — the account's calendar week start.
 * @param epsilon      convergence band in px (default 0.5): the browser stores `scrollLeft` as a
 *                     whole number, so a target within half a pixel is already aligned.
 * @returns the target `scrollLeft` px to floor-snap to, or `null` when already within `epsilon`
 *   of the week start (a no-op — the caller must NOT write, or the snap re-arms itself).
 *
 * PURE. Never throws and never returns NaN: an out-of-range left-edge index falls back to
 * `days[0]`, and `xForDateInGeom` returns 0 (not NaN) for an unparseable date, so a bad window
 * degrades to a harmless `0` target rather than corrupting the scroll position.
 *
 * SUB-PIXEL ROUNDING: we resolve the left-edge day from `Math.round(scrollLeft)`, not the raw
 * value. Column offsets are integers and a settled scrollLeft is *meant* to be integer, but a HiDPI
 * browser (Firefox in particular, devicePixelRatio > 1) can store scrollLeft as a fraction just
 * *below* an integer column boundary (e.g. `mondayOffset - 0.4`). `indexAt` floors strictly (largest
 * i with `offsets[i] <= px`), so without rounding that fraction resolves to the PREVIOUS day — under
 * minimised weekends the narrow Sunday — and `startOfWeekISO` of *that* day is the PREVIOUS week's
 * start, so the floor-snap would jump the view back a whole week. The 0.5px convergence guard below
 * does NOT catch this: the computed target is a week away, far outside epsilon. Rounding first makes
 * a sub-pixel-below-boundary position resolve to the column it's essentially already at. The
 * convergence check still compares the RAW `scrollLeft` to `target` — it measures the real distance
 * the caller must move, which is what the no-op decision turns on.
 */
export function weekStartSnapTarget(
  geom: ColumnGeometry,
  days: ISODate[],
  scrollLeft: number,
  weekStartsOn: 0 | 1,
  epsilon = 0.5,
): number | null {
  // `?? days[0]` covers an out-of-range index (and an empty window resolves days[0] to undefined,
  // which startOfWeekISO would reject — but the window is never empty on a scrollable grid, and a
  // 0-width geometry early-returns at the call site before we get here).
  const leftDay = days[geom.indexAt(Math.round(scrollLeft))] ?? days[0]
  const target = geom.xForDateInGeom(startOfWeekISO(leftDay, weekStartsOn))
  // Already aligned (within the sub-pixel band) → null so the caller no-ops. Math.abs, not a signed
  // compare, so a (never-expected) forward target also converges rather than oscillates.
  return Math.abs(target - scrollLeft) <= epsilon ? null : target
}
