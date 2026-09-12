import { memo, useMemo } from "react";
import { format } from "date-fns";
import { m } from "@/i18n";
import { formatDayMonth, formatMonthYear } from "@/lib/dateDisplay";
import { parseDate, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { type WeeksZoom } from "../../lib/schedulerConfig";
import { LAYOUT } from "./layout";
import type { ColumnGeometry } from "./columnGeometry";

interface Span {
  key: string;
  label: string;
  days: number;
  /** Index of the span's first day in `days` — lets the width come from `geom.spanWidth`
   *  (so a span containing narrowed weekend columns is sized from their real widths). */
  start: number;
}

/** Group visible days into calendar-month spans. */
function buildMonthSpans(days: string[]): Span[] {
  const spans: Span[] = [];
  days.forEach((day, i) => {
    const key = day.slice(0, 7); // YYYY-MM
    const last = spans[spans.length - 1];
    if (last && last.key === key) last.days += 1;
    else spans.push({ key, label: formatMonthYear(day), days: 1, start: i });
  });
  return spans;
}

/** Group visible days into weeks (new block on the week-start day or at the window start). */
function buildWeekBlocks(days: string[], weekStartsOn: 0 | 1): Span[] {
  const blocks: Span[] = [];
  days.forEach((day, i) => {
    if (i === 0 || weekdayOf(day) === weekStartsOn)
      blocks.push({ key: day, label: formatDayMonth(day), days: 1, start: i });
    else {
      const currentBlock = blocks[blocks.length - 1];
      if (currentBlock) currentBlock.days += 1;
    }
  });
  return blocks;
}

function resolveDayClass(weekStart: boolean, isToday: boolean, weekend: boolean): string {
  let stateClass = "text-muted-foreground";
  if (isToday) stateClass = "bg-brand-soft font-semibold text-ink shadow-[inset_0_2px_0_var(--color-brand)]";
  else if (weekend) stateClass = "bg-weekend text-muted-foreground";
  return `flex flex-col items-center justify-center py-1 text-xs leading-tight ${weekStart ? "border-l border-line" : ""} ${stateClass}`;
}

function DateDayTier({
  days,
  geometry,
  weekStartsOn,
  today,
}: {
  days: string[];
  geometry: ColumnGeometry;
  weekStartsOn: 0 | 1;
  today: string;
}) {
  return (
    <div data-testid="scheduler-day-tier" className="flex flex-auto">
      {days.map((day, index) => {
        const weekday = weekdayOf(day);
        const weekend = weekday === 0 || weekday === 6;
        const date = parseDate(day);
        return (
          <div
            key={day}
            data-date={day}
            className={resolveDayClass(weekday === weekStartsOn, day === today, weekend)}
            style={{ width: geometry.widthOf(index) }}
          >
            <span className="font-medium">{format(date, "d")}</span>
            {geometry.showWeekdayLabels && (
              <span className="text-2xs uppercase">
                {geometry.minimiseActive && weekend ? m.scheduler_weekday_narrow_weekend() : format(date, "EEE")}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

interface DateMonthTierProps {
  months: Span[];
  geometry: ColumnGeometry;
  alignVisibleMonths: boolean;
}

function DateMonthTier({ months, geometry, alignVisibleMonths }: DateMonthTierProps) {
  return (
    <div className="flex shrink-0 border-b border-line">
      {months.map((month) => {
        const width = geometry.spanWidth(month.start, month.start + month.days - 1);
        const start = geometry.x(month.start);
        return (
          <div
            key={month.key}
            className="relative flex shrink-0 items-center border-r border-line py-0.75"
            style={{ width, ["--month-start" as string]: `${start}px`, ["--month-width" as string]: `${width}px` }}
          >
            {alignVisibleMonths ? (
              <>
                <span
                  aria-hidden="true"
                  className="invisible inline-block px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide"
                >
                  &nbsp;
                </span>
                <div
                  data-month-placement="visible-segment"
                  className="absolute inset-y-0 flex items-center justify-start overflow-hidden"
                  style={{
                    left: "clamp(0px, calc(var(--sched-scroll-left, 0px) - var(--month-start)), var(--month-width))",
                    right:
                      "clamp(0px, calc(var(--month-start) + var(--month-width) - var(--sched-scroll-left, 0px) - var(--sched-visible-width, 100%)), var(--month-width))",
                  }}
                >
                  <span
                    data-month-label
                    className="inline-block max-w-full truncate px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-faint"
                  >
                    {month.label}
                  </span>
                </div>
              </>
            ) : (
              <span
                data-month-label
                data-month-placement="sticky-start"
                className="sticky inline-block max-w-full truncate bg-scheduler-header px-2 py-0.5 text-2xs font-semibold uppercase tracking-wide text-faint"
                style={{ left: LAYOUT.leftColWidth }}
              >
                {month.label}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Memoised: its props (the memoised `days` array + the memoised `geom`) are stable
// across data mutations, so it stops re-rendering ~120 cells on every store change.
export const DateHeader = memo(function DateHeader({
  days,
  geom: geometry,
  visibleWeeks,
  weekStartsOn,
  today,
}: {
  days: string[];
  // Per-column geometry: cell/month/week widths come from here so they track the
  // (possibly narrowed) weekend columns instead of a single scalar.
  geom: ColumnGeometry;
  visibleWeeks: WeeksZoom;
  weekStartsOn: 0 | 1;
  today: string;
}) {
  const showDays = geometry.perDayColumns; // per-day columns vs per-week blocks
  const showWeekday = geometry.showWeekdayLabels;
  // The 1/2-week views have enough room to place labels at the visible month segment's start.
  // At compact zooms that treatment would leave too little room, so keep the bounded sticky label.
  const alignVisibleMonths = visibleWeeks <= 2 && showWeekday;
  const totalWidth = geometry.totalWidth;
  // Width of a span [start, start+days-1] from the real per-column widths.
  const resolveSpanWidth = (span: Span) => geometry.spanWidth(span.start, span.start + span.days - 1);
  // Month/week groupings depend only on `days` — recompute on the day set changing,
  // not on a pure dayWidth (zoom) change that only re-widths the same blocks.
  const months = useMemo(() => buildMonthSpans(days), [days]);
  const weeks = useMemo(() => buildWeekBlocks(days, weekStartsOn), [days, weekStartsOn]);

  return (
    /* Column 2 of the scheduler grid: the timeline date header (col 1 is the sticky utilisation
       column header in SchedulerGrid). aria-colindex=2 matches the gridcells/rowheaders below so the
       grid's declared 2-column structure (aria-colcount=2) is consistent (WCAG 1.3.1). */
    <div
      role="columnheader"
      aria-colindex={2}
      aria-label={m.scheduler_dates_aria()}
      className="relative flex h-full shrink-0 flex-col"
      style={{ width: totalWidth }}
    >
      {/* Month tier — padding-driven height (not a fixed px) so it scales with font size.
          Wide 1/2-week views position an absolute wrapper over the intersection of the month
          and visible timeline. useSchedulerViewport publishes scrollLeft as a CSS variable,
          letting the browser track that wrapper without a React render per scroll pixel.
          Compact zooms retain the bounded sticky label: no overflow-hidden ancestor in that
          branch, because it would trap position:sticky. */}
      <DateMonthTier months={months} geometry={geometry} alignVisibleMonths={alignVisibleMonths} />

      {/* Week / day tier. flex-auto (basis auto, not flex-1's basis 0) so the cells'
          real height counts toward the header — otherwise the date + weekday lines
          overflow the row and get clipped — while still filling any slack height. */}
      {showDays ? (
        <DateDayTier days={days} geometry={geometry} weekStartsOn={weekStartsOn} today={today} />
      ) : (
        <div className="flex flex-auto">
          {weeks.map((span) => (
            <div
              key={span.key}
              className="flex items-center overflow-hidden border-l border-line px-1 py-1 text-2xs text-muted-foreground"
              style={{ width: resolveSpanWidth(span) }}
            >
              <span className="truncate font-medium">{span.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
