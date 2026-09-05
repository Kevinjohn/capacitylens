import { memo, useMemo } from "react";
import { format } from "date-fns";
import { m } from "@/i18n";
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
function monthSpans(days: string[]): Span[] {
  const spans: Span[] = [];
  days.forEach((d, i) => {
    const key = d.slice(0, 7); // YYYY-MM
    const last = spans[spans.length - 1];
    if (last && last.key === key) last.days += 1;
    else spans.push({ key, label: format(parseDate(d), "MMM yyyy"), days: 1, start: i });
  });
  return spans;
}

/** Group visible days into weeks (new block on the week-start day or at the window start). */
function weekBlocks(days: string[], weekStartsOn: 0 | 1): Span[] {
  const blocks: Span[] = [];
  days.forEach((d, i) => {
    if (i === 0 || weekdayOf(d) === weekStartsOn)
      blocks.push({ key: d, label: format(parseDate(d), "d MMM"), days: 1, start: i });
    else blocks[blocks.length - 1].days += 1;
  });
  return blocks;
}

// Memoised: its props (the memoised `days` array + the memoised `geom`) are stable
// across data mutations, so it stops re-rendering ~120 cells on every store change.
export const DateHeader = memo(function DateHeader({
  days,
  geom,
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
  const showDays = geom.perDayColumns; // per-day columns vs per-week blocks
  const showWeekday = geom.showWeekdayLabels;
  // The 1/2-week views have enough room to place labels at the visible month segment's start.
  // At compact zooms that treatment would leave too little room, so keep the bounded sticky label.
  const alignVisibleMonths = visibleWeeks <= 2 && showWeekday;
  const totalWidth = geom.totalWidth;
  // Width of a span [start, start+days-1] from the real per-column widths.
  const spanWidth = (s: Span) => geom.spanWidth(s.start, s.start + s.days - 1);
  // Month/week groupings depend only on `days` — recompute on the day set changing,
  // not on a pure dayWidth (zoom) change that only re-widths the same blocks.
  const months = useMemo(() => monthSpans(days), [days]);
  const weeks = useMemo(() => weekBlocks(days, weekStartsOn), [days, weekStartsOn]);

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
      <div className="flex shrink-0 border-b border-line">
        {months.map((mo) => {
          const width = spanWidth(mo);
          const start = geom.x(mo.start);
          return (
            <div
              key={mo.key}
              className="relative flex shrink-0 items-center border-r border-line py-0.75"
              style={{
                width,
                ["--month-start" as string]: `${start}px`,
                ["--month-width" as string]: `${width}px`,
              }}
            >
              {alignVisibleMonths ? (
                <>
                  {/* Absolute positioning must not collapse the padding-driven tier height. This
                      empty, invisible in-flow span carries the label's scalable line box. */}
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
                      {mo.label}
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
                  {mo.label}
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Week / day tier. flex-auto (basis auto, not flex-1's basis 0) so the cells'
          real height counts toward the header — otherwise the date + weekday lines
          overflow the row and get clipped — while still filling any slack height. */}
      {showDays ? (
        <div data-testid="scheduler-day-tier" className="flex flex-auto">
          {days.map((d, i) => {
            const wd = weekdayOf(d);
            const weekStart = wd === weekStartsOn;
            const weekend = wd === 0 || wd === 6;
            const isToday = d === today;
            const date = parseDate(d);
            return (
              <div
                key={d}
                data-date={d}
                className={`flex flex-col items-center justify-center py-1 text-xs leading-tight ${weekStart ? "border-l border-line" : ""} ${
                  isToday
                    ? "bg-brand-soft font-semibold text-ink shadow-[inset_0_2px_0_var(--color-brand)]"
                    : weekend
                      ? "bg-weekend text-muted-foreground"
                      : "text-muted-foreground"
                }`}
                style={{ width: geom.widthOf(i) }}
              >
                <span className="font-medium">{format(date, "d")}</span>
                {/* Narrowed weekend columns have no room for "Sat"/"Sun" — both read just "S"
                    (the date number always stays). Weekdays keep their three-letter label. */}
                {showWeekday && (
                  <span className="text-2xs uppercase">
                    {geom.minimiseActive && weekend ? m.scheduler_weekday_narrow_weekend() : format(date, "EEE")}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-auto">
          {weeks.map((b) => (
            <div
              key={b.key}
              className="flex items-center overflow-hidden border-l border-line px-1 py-1 text-2xs text-muted-foreground"
              style={{ width: spanWidth(b) }}
            >
              <span className="truncate font-medium">{b.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
