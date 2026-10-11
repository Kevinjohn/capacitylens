import { daysInclusive } from "@capacitylens/shared/lib/dateMath";
import { m } from "@/i18n";
import type { ISODate } from "@capacitylens/shared/types/entities";

interface ResolveVisibleWindowInput {
  days: ISODate[];
  leftEdgeIndex: number;
  zoom: number;
  focusDate: ISODate;
}

/** Number of visible days and edge dates realized by the grid. */
export interface RealizedVisibleSpan {
  dayCount: number;
  /** Present only when the realized inclusive range is an exact whole number of weeks. */
  weekCount?: number;
}

/** Describe the range actually measured after timeline clamping, not the requested zoom preset. */
export function buildRealizedVisibleSpan(start: ISODate, end: ISODate): RealizedVisibleSpan {
  const dayCount = Math.max(1, daysInclusive(start, end));
  return dayCount % 7 === 0 ? { dayCount, weekCount: dayCount / 7 } : { dayCount };
}

/** The two phrasings of the visible span the utilisation surfaces need: `long` for the "over the
 * visible N week(s)" titles and the screen-reader summary, `compact` for the header's own label. */
export interface VisibleSpanLabels {
  long: string;
  compact: string;
}

/** Human labels for the visible span. Whole weeks read as weeks and anything else as days, so a
 * clamped range never claims a week it does not cover. */
export function buildVisibleSpanLabels(start: ISODate, end: ISODate): VisibleSpanLabels {
  const span = buildRealizedVisibleSpan(start, end);
  if (span.weekCount !== undefined) {
    const count = span.weekCount;
    const long =
      count === 1 ? m.scheduler_visible_weeks_label_one({ count }) : m.scheduler_visible_weeks_label_other({ count });
    return {
      long,
      compact: m.scheduler_visible_weeks_compact({ count }),
    };
  }
  const count = span.dayCount;
  return {
    long: count === 1 ? m.scheduler_visible_days_label_one({ count }) : m.scheduler_visible_days_label_other({ count }),
    compact: m.scheduler_visible_days_compact({ count }),
  };
}

/** Resolves the inclusive visible utilisation window from the scroll edge, clamping it to timeline dates. Before the first scroll, anchor to focusDate rather than the buffered origin so the initial view describes the requested week. */
export function resolveVisibleWindow({ days, leftEdgeIndex, zoom, focusDate }: ResolveVisibleWindowInput): {
  start: ISODate;
  end: ISODate;
} {
  const lastIndex = days.length - 1;
  const focusIndex = days.indexOf(focusDate);
  let rawIndex = leftEdgeIndex;
  if (rawIndex < 0) rawIndex = Math.max(focusIndex, 0);
  const startIndex = Math.min(Math.max(rawIndex, 0), Math.max(lastIndex, 0));
  const start = days[startIndex] ?? focusDate;
  const endIndex = Math.min(startIndex + zoom * 7 - 1, lastIndex);
  return { start, end: days[Math.max(endIndex, startIndex)] ?? start };
}
