import { daysInclusive } from "@capacitylens/shared/lib/dateMath";
import { m } from "@/i18n";
import type { ISODate } from "@capacitylens/shared/types/entities";

interface ResolveVisibleWindowInput {
  days: ISODate[];
  leftEdgeIndex: number;
  zoom: number;
  focusDate: ISODate;
}

export interface RealizedVisibleSpan {
  days: number;
  /** Present only when the realized inclusive range is an exact whole number of weeks. */
  weeks?: number;
}

/** Describe the range actually measured after timeline clamping, not the requested zoom preset. */
export function buildRealizedVisibleSpan(start: ISODate, end: ISODate): RealizedVisibleSpan {
  const days = Math.max(1, daysInclusive(start, end));
  return days % 7 === 0 ? { days, weeks: days / 7 } : { days };
}

/** The two phrasings of the visible span the utilisation surfaces need: `long` for the "over the
 *  visible N week(s)" titles and the screen-reader summary, `compact` for the header's own label. */
export interface VisibleSpanLabels {
  long: string;
  compact: string;
}

/** Human labels for the visible span. Whole weeks read as weeks and anything else as days, so a
 *  clamped range never claims a week it does not cover. */
export function buildVisibleSpanLabels(start: ISODate, end: ISODate): VisibleSpanLabels {
  const span = buildRealizedVisibleSpan(start, end);
  if (span.weeks !== undefined) {
    const count = span.weeks;
    return {
      long:
        count === 1 ? m.scheduler_visible_weeks_label_one({ count }) : m.scheduler_visible_weeks_label_other({ count }),
      compact: m.scheduler_visible_weeks_compact({ count }),
    };
  }
  const count = span.days;
  return {
    long: count === 1 ? m.scheduler_visible_days_label_one({ count }) : m.scheduler_visible_days_label_other({ count }),
    compact: m.scheduler_visible_days_compact({ count }),
  };
}

/** The window the DISPLAYED utilisation % runs over: `zoom * 7` inclusive calendar days anchored at
 *  the scroll left-edge day. The inclusive end is `+ (zoom*7 - 1)` — a 1-week view is [L, L+6], not
 *  8 days — and is CLAMPED to the last timeline day so the window never reads past `days`.
 *
 *  Before the first scroll settles (`leftEdgeIndex === -1`) it anchors at `focusDate` (today by
 *  default), NOT days[0]: that is the PAST_BUFFER_DAYS origin BEHIND today, which would open the
 *  schedule on a window nobody asked about. */
export function resolveVisibleWindow({ days, leftEdgeIndex, zoom, focusDate }: ResolveVisibleWindowInput): {
  start: ISODate;
  end: ISODate;
} {
  const lastIndex = days.length - 1;
  const focusIndex = days.indexOf(focusDate);
  const rawIndex = leftEdgeIndex >= 0 ? leftEdgeIndex : focusIndex >= 0 ? focusIndex : 0;
  const startIndex = Math.min(Math.max(rawIndex, 0), Math.max(lastIndex, 0));
  const start = days[startIndex] ?? focusDate;
  const endIndex = Math.min(startIndex + zoom * 7 - 1, lastIndex);
  return { start, end: days[Math.max(endIndex, startIndex)] ?? start };
}
