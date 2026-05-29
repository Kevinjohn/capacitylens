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

/** Day-column width (px) that fits `weeks` weeks into `availableWidth`, clamped legible. */
export function resolveDayWidth(availableWidth: number, weeks: WeeksZoom): number {
  if (availableWidth <= 0) return MIN_DAY_WIDTH
  const raw = Math.floor(availableWidth / (weeks * 7))
  return Math.min(MAX_DAY_WIDTH, Math.max(MIN_DAY_WIDTH, raw))
}
