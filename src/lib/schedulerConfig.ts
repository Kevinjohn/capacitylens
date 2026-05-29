// Shared scheduler tuning. The timeline shows a preset number of WEEKS; the
// day-column width is derived to fit that many weeks into the available width
// (see resolveDayWidth). Pixel row geometry lives in components/scheduler/layout.ts.

export type WeeksZoom = 1 | 2 | 4 | 6 | 8

export const ZOOM_LEVELS: WeeksZoom[] = [1, 2, 4, 6, 8]
export const DEFAULT_ZOOM: WeeksZoom = 4

export const MIN_DAY_WIDTH = 8
// Generous cap so a 1-week view genuinely fills a normal screen (only bites on ultra-wide).
export const MAX_DAY_WIDTH = 120
/** Used when the real timeline width can't be measured (tests / first paint / SSR). */
export const FALLBACK_TIMELINE_WIDTH = 1000

/** How many days the timeline spans. */
export const DEFAULT_RANGE_DAYS = 120
/** Timeline origin = today + this offset, so a little past context shows on the left. */
export const DEFAULT_ORIGIN_OFFSET_DAYS = -7

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
  if (availableWidth <= 0) return MIN_DAY_WIDTH
  const raw = Math.floor(availableWidth / (weeks * 7))
  return Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, raw))
}
