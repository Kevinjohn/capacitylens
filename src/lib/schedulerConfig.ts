// Shared scheduler tuning — one place for the values the store and the view both
// need. (Pixel row geometry lives in components/scheduler/layout.ts, which is a
// view-only concern.)

export type Zoom = 'day' | 'week'

/** Pixel width of a single day column at each zoom level. */
export const DAY_WIDTH: Record<Zoom, number> = { day: 48, week: 20 }

/** How many days the timeline spans. */
export const DEFAULT_RANGE_DAYS = 120

/** Timeline origin = today + this offset, so a little past context shows on the left. */
export const DEFAULT_ORIGIN_OFFSET_DAYS = -7
