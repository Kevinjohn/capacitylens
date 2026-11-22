// The date ranges the scheduler and the Capacity Overview cover. The browser lays out its views with
// them and the server computes the planning read's capacity section over the same ranges.

/** How many days the timeline spans forward from the focus date. */
export const DEFAULT_RANGE_DAYS = 120;
/** Scrollable history kept to the left of the focus date (default view, Today,
 * go to date, company switch). The view still opens scrolled to the focus date,
 * the buffer exists so a leftward swipe pans into the past instead of overscrolling
 * the left edge, which macOS treats as browser back-navigation. A whole number of
 * weeks, so the origin stays on the same weekday as the focused Monday. */
export const PAST_BUFFER_DAYS = 28;

/** Forward day window for the zoom-independent overSoon signal. Visible utilisation
 * uses the current zoom and scroll window; per-day conflict markers cover the
 * materialized timeline. These windows remain independent.
 */
export const UTILISATION_WINDOW_DAYS = 14;

/** Supported fixed horizons for the capacity overview. */
export type CapacityOverviewHorizon = '4-weeks' | '8-weeks' | '12-weeks';

/** Week columns each Capacity Overview horizon displays: the current week and the ones after it. */
export const CAPACITY_OVERVIEW_HORIZON_WEEKS: Record<CapacityOverviewHorizon, number> = {
  '4-weeks': 4,
  '8-weeks': 8,
  '12-weeks': 12,
};
