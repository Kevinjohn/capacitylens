// Shared scheduler tuning. The timeline shows a preset number of WEEKS; the
// day-column width is derived to fit that many weeks into the available width
// (see resolveDayWidth). Pixel row geometry lives in components/scheduler/layout.ts.

export type WeeksZoom = 1 | 2 | 4 | 6 | 8

export const ZOOM_LEVELS: WeeksZoom[] = [1, 2, 4, 6, 8]
export const DEFAULT_ZOOM: WeeksZoom = 2

export const MIN_DAY_WIDTH = 8
// Generous cap so a 1-week view genuinely fills a normal screen (only bites on ultra-wide).
export const MAX_DAY_WIDTH = 120
/** Used when the real timeline width can't be measured (tests / first paint / SSR). */
export const FALLBACK_TIMELINE_WIDTH = 1000

// Density thresholds shared by the header and the lanes so they flip together as
// you zoom (avoids the old 18-vs-20 mismatch where weekend tint vanished a step
// before the per-day columns did).
/** At/above this day width the header shows per-day columns and lanes paint weekend/unavailable tint. */
export const DAY_COLUMN_MIN_WIDTH = 18
/** At/above this day width the header also shows weekday letters (Mon/Tue…). */
export const WEEKDAY_LABEL_MIN_WIDTH = 36

/** How many days the timeline spans FORWARD from the focus date. */
export const DEFAULT_RANGE_DAYS = 120
/** Scrollable history kept to the LEFT of the focus date (default view, Today,
 *  jump-to-date, account switch). The view still opens scrolled to the focus date —
 *  the buffer exists so a leftward swipe PANS into the past instead of overscrolling
 *  the left edge, which macOS treats as browser back-navigation. A whole number of
 *  weeks, so the origin stays on the same weekday as the focused Monday. */
export const PAST_BUFFER_DAYS = 28

/**
 * The per-resource utilisation % is a near-term overbooking radar, not a
 * whole-timeline average: it's computed over a fixed forward window from TODAY
 * (not the 120-day range, and not the zoom level), so a person slammed this week
 * actually reads as overbooked instead of being diluted by an idle next month.
 * Per-day over-markers still flag every over-allocated day across the timeline.
 */
export const UTILIZATION_WINDOW_DAYS = 14

/** Day-column width (px) that fits `weeks` weeks into `availableWidth`, clamped legible. */
export function resolveDayWidth(availableWidth: number, weeks: WeeksZoom): number {
  // `availableWidth` comes from a measured DOM rect, which can be NaN (unmeasured / detached
  // element). Treat non-finite the same as <= 0: a NaN would slip past the `<= 0` check
  // (NaN <= 0 is false) and Math.floor(NaN/…) → NaN → Math.min/max(NaN) → NaN, propagating a
  // NaN width into layout. Fall back to the minimum legible width instead.
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) return MIN_DAY_WIDTH
  const raw = Math.floor(availableWidth / (weeks * 7))
  return Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, raw))
}
