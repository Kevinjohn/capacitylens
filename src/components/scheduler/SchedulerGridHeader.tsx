import type { Ref } from "react";
import { m } from "@/i18n";
import { LAYOUT } from "./layout";
import { DateHeader } from "./DateHeader";
import type { useSchedulerViewport } from "./useSchedulerViewport";
import type { useSchedulerGridModel, useSchedulerGridPreferences } from "./useSchedulerGridModel";

type Props = Pick<ReturnType<typeof useSchedulerViewport>, "days" | "geom"> &
  Pick<ReturnType<typeof useSchedulerGridModel>, "today" | "visibleWeeksLabel" | "visibleSpanCompact" | "overallUtil"> &
  Pick<ReturnType<typeof useSchedulerGridPreferences>, "ui" | "utilizationPrefs"> & {
    headerRef: Ref<HTMLDivElement>;
    calendarWeekStartsOn: 0 | 1;
  };
export function SchedulerGridHeader({
  headerRef,
  utilizationPrefs,
  visibleWeeksLabel,
  visibleSpanCompact,
  overallUtil,
  days,
  geom,
  ui,
  calendarWeekStartsOn,
  today,
}: Props) {
  return (
    <>
      {/* min-w-max: this is a flex item of the flex-col scroll container, so the
            default align-items:stretch would clamp its width to the container's cross
            size (the viewport), leaving the wide DateHeader to overflow and only the
            first ~2 weeks painted. Sizing to content makes header + rows span the full
            timeline and scroll together. Same reason on the rowgroup below. */}
      <div
        ref={headerRef}
        role="row"
        aria-rowindex={1}
        className="sticky top-0 z-20 flex min-w-max shrink-0 border-b border-line-soft bg-scheduler-header"
        style={{ minHeight: LAYOUT.headerHeight }}
      >
        <div
          data-testid="scheduler-resource-header"
          role="columnheader"
          aria-colindex={1}
          aria-label={m.scheduler_resources_column()}
          className="sticky left-0 z-30 flex shrink-0 flex-col justify-center border-r border-line bg-scheduler-header px-3"
          style={{ width: LAYOUT.leftColWidth }}
        >
          {utilizationPrefs.showTotal && (
            <>
              <span
                className="text-2xs font-medium uppercase tracking-wide text-faint"
                title={m.scheduler_total_util_title({
                  span: visibleWeeksLabel,
                })}
              >
                {/* The headline % follows the VISIBLE range, so the label tracks the selected zoom
                      span (1/2/4/6/8 weeks) rather than naming a fixed "next 2w". */}
                {m.scheduler_total_util_label({ span: visibleSpanCompact })}
              </span>
              <span data-testid="overall-utilization" className="text-sm font-semibold">
                {overallUtil}%
              </span>
            </>
          )}
        </div>
        <DateHeader days={days} geom={geom} visibleWeeks={ui.zoom} weekStartsOn={calendarWeekStartsOn} today={today} />
      </div>
    </>
  );
}
