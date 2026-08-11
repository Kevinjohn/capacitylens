// Shared scheduler tuning. The timeline shows a preset number of WEEKS; the
// day-column width is derived to fit that many weeks into the available width
// (see resolveColumnFit). Pixel row geometry lives in components/scheduler/layout.ts.

export type WeeksZoom = 1 | 2 | 4 | 6 | 8;

export const ZOOM_LEVELS: WeeksZoom[] = [1, 2, 4, 6, 8];
export const DEFAULT_ZOOM: WeeksZoom = 2;

export const MIN_DAY_WIDTH = 8;
/** Used when the real timeline width can't be measured (tests / first paint / SSR). */
export const FALLBACK_TIMELINE_WIDTH = 1000;

// Density thresholds shared by the header and the lanes so they flip together as
// you zoom (avoids the old 18-vs-20 mismatch where weekend tint vanished a step
// before the per-day columns did).
/** At/above this day width the header shows per-day columns and lanes paint weekend/unavailable tint. */
export const DAY_COLUMN_MIN_WIDTH = 18;
/** At/above this day width the header also shows weekday letters (Mon/Tue…). */
export const WEEKDAY_LABEL_MIN_WIDTH = 36;

/** Bare-minimum width of a Sat/Sun column when "minimise weekends" is on — just room for a
 *  two-digit date. Expressed in REM (not px) so it tracks the user's font size / zoom; it's
 *  resolved to px against the root font size where the ColumnGeometry is built. Only applies at
 *  fine zoom (dayWidth >= DAY_COLUMN_MIN_WIDTH); buildColumnGeometry also caps it at dayWidth. */
export const WEEKEND_COLUMN_REM = 1.4; // ≈ a 2-digit number at text-xs + a little padding

/** Idle delay (ms) after a FREE horizontal scroll settles before the "snap to week start" pref
 *  floors the left edge back to the current week's first day — long enough that a continuous drag
 *  isn't fought mid-gesture, short enough to feel immediate once the user lets go. */
export const WEEK_SNAP_IDLE_MS = 120;

/** How many days the timeline spans FORWARD from the focus date. */
export const DEFAULT_RANGE_DAYS = 120;
/** Scrollable history kept to the LEFT of the focus date (default view, Today,
 *  jump-to-date, account switch). The view still opens scrolled to the focus date —
 *  the buffer exists so a leftward swipe PANS into the past instead of overscrolling
 *  the left edge, which macOS treats as browser back-navigation. A whole number of
 *  weeks, so the origin stays on the same weekday as the focused Monday. */
export const PAST_BUFFER_DAYS = 28;

/**
 * Window (days, forward from TODAY) for the `overSoon` red flag ONLY — the near-term, zoom/pan-
 * INDEPENDENT "over soon" overbooking radar, so a person slammed this week reads as overbooked
 * regardless of the visible range. This is deliberately SEPARATE from the DISPLAYED utilisation %
 * (per-person / per-discipline avg / overall), which since the visible-window change is computed
 * over the currently VISIBLE span (the zoom toggle's `zoom * 7` days at the scroll left edge) so
 * "63% utilisation" answers "over the weeks I'm looking at". A third signal — the per-day
 * over-marker — still flags every over-allocated day across the whole timeline. Three distinct
 * over/utilisation signals, kept apart (CLAUDE.md / DECISIONS.md).
 */
export const UTILIZATION_WINDOW_DAYS = 14;

/**
 * Integer column fit for one of the scheduler's week zooms.
 *
 * `weekendWidth` (optional) is the px width of a minimised Sat/Sun column. When given, the fit
 * accounts for the narrowed weekends — a week of viewport is then 5 weekday columns + 2 narrow
 * weekend columns, so the weekday columns are widened to fill `weeks` weeks (otherwise the
 * narrow weekends leave the right edge under-filled and a "1-week" view shows ~1.5 weeks). The
 * caller passes it ONLY when minimise is actually narrowing (weekday width > weekendWidth);
 * omit it (or pass a non-positive / non-finite value) for the uniform 7-equal-columns fit.
 *
 * `dayWidth` is the base width. ColumnGeometry distributes the remainder up to `weekWidth`
 * across individual columns, keeping every offset on an integer pixel without leaving enough
 * slack to reveal the following date.
 */
export function resolveColumnFit(
  availableWidth: number,
  weeks: WeeksZoom,
  weekendWidth?: number,
): { dayWidth: number; weekWidth: number } {
  // `availableWidth` comes from a measured DOM rect, which can be NaN (unmeasured / detached
  // element). Treat non-finite the same as <= 0: a NaN would slip past the `<= 0` check
  // (NaN <= 0 is false) and Math.ceil(NaN/…) → NaN, propagating a
  // NaN width into layout. Fall back to the minimum legible width instead.
  if (!Number.isFinite(availableWidth) || availableWidth <= 0) {
    return { dayWidth: MIN_DAY_WIDTH, weekWidth: MIN_DAY_WIDTH * 7 };
  }
  // Each calendar week gets an integer target. Across the selected span this can exceed the
  // viewport by at most `weeks - 1` pixels, so the final selected column remains visible while
  // the next column begins beyond the right edge.
  const weekWidth = Math.ceil(availableWidth / weeks);
  const uniformRaw = Math.floor(weekWidth / 7);
  const weekendAwareRaw =
    Number.isFinite(weekendWidth) && (weekendWidth as number) > 0
      ? // 5 weekday columns + 2 weekend columns per week fill `availableWidth`:
        // 5·dayWidth + 2·weekendWidth = weekWidth.
        Math.floor((weekWidth - 2 * (weekendWidth as number)) / 5)
      : null;
  // Geometry narrows weekends only at the per-day-column threshold. Below it, use the same
  // uniform fit geometry will render; otherwise the fit assumes narrow weekends that are later
  // refused, which can overflow and even make the timeline shrink as the viewport widens.
  const raw = weekendAwareRaw !== null && weekendAwareRaw >= DAY_COLUMN_MIN_WIDTH ? weekendAwareRaw : uniformRaw;
  // Do not cap wide one-week views: a maximum would deliberately under-fill the viewport and
  // reveal later dates, contradicting the selected zoom.
  return { dayWidth: Math.max(MIN_DAY_WIDTH, raw), weekWidth };
}
