import { memo, useMemo } from "react";
import { format } from "date-fns";
import { m } from "@/i18n";
import { formatDayMonth, formatMonthYear } from "@/lib/dateDisplay";
import { useDateStyle } from "@/store/useDateStyle";
import { parseDate, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import type { WeeksZoom } from "@/lib/schedulerConfig";
import { LAYOUT } from "./layout";
import type { ColumnGeometry } from "./columnGeometry";
import { buildVisibleSpanInsets } from "./visibleSpanInsets";

const MONTH_LABEL_INSETS = buildVisibleSpanInsets("x", "var(--month-start)", "var(--month-width)");

interface Span {
  key: string;
  label: string;
  days: number;
  /** Index of the span's first day in `days`, lets the width come from `geom.spanWidth`
   * (so a span containing narrowed weekend columns is sized from their real widths). */
  start: number;
}

function buildMonthSpans(days: string[]): Span[] {
  const spans: Span[] = [];
  days.forEach((day, i) => {
    const key = day.slice(0, 7);
    const last = spans[spans.length - 1];
    if (last && last.key === key) last.days += 1;
    else spans.push({ key, label: formatMonthYear(day), days: 1, start: i });
  });
  return spans;
}

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

type ResolveDayClassOptions = { weekStart: boolean; isToday: boolean; weekend: boolean };
function resolveDayClass({ weekStart, isToday, weekend }: ResolveDayClassOptions): string {
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
            className={resolveDayClass({
              weekStart: weekday === weekStartsOn,
              isToday: day === today,
              weekend: weekend,
            })}
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
                  style={{ left: MONTH_LABEL_INSETS.leading, right: MONTH_LABEL_INSETS.trailing }}
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

/** Renders date and week labels for the visible schedule columns. */
export const DateHeader = memo(function DateHeader({
  days,
  geom: geometry,
  visibleWeeks,
  weekStartsOn,
  today,
}: {
  days: string[];

  geom: ColumnGeometry;
  visibleWeeks: WeeksZoom;
  weekStartsOn: 0 | 1;
  today: string;
}) {
  const showDays = geometry.perDayColumns;
  const showWeekday = geometry.showWeekdayLabels;
  // The 1/2-week views have enough room to place labels at the visible month segment's start.
  // At compact zooms that treatment would leave too little room, so keep the bounded sticky label.
  const alignVisibleMonths = visibleWeeks <= 2 && showWeekday;
  const totalWidth = geometry.totalWidth;

  const resolveSpanWidth = (span: Span) => geometry.spanWidth(span.start, span.start + span.days - 1);
  // Month grouping depends on visible dates, while formatted week labels also depend on date style. The style subscription wakes this memoized header for account-format changes.
  const dateStyle = useDateStyle();
  const months = useMemo(() => buildMonthSpans(days), [days]);
  // `buildWeekBlocks` formats its labels through `formatDayMonth`, which reads the active style
  // from a module-level mirror rather than an argument, so the linter cannot see the dependency.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the style is a real input to the labels
  const weeks = useMemo(() => buildWeekBlocks(days, weekStartsOn), [days, weekStartsOn, dateStyle]);

  return (
    // The date header uses column index 2 to match the timeline cells and the grid's two-column accessibility model.
    <div
      role="columnheader"
      aria-colindex={2}
      aria-label={m.scheduler_dates_aria()}
      className="relative flex h-full shrink-0 flex-col"
      style={{ width: totalWidth }}
    >
      {/* Month labels follow scroll offsets through CSS variables so scrolling does not rerender them. Compact labels must avoid overflow-hidden ancestors, which would trap sticky positioning. */}
      <DateMonthTier months={months} geometry={geometry} alignVisibleMonths={alignVisibleMonths} />

      {/* Use flex-auto so weekday content contributes to header height instead of overflowing a zero-basis row. */}
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
