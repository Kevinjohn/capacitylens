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
/** Aligns date labels and capacity columns with the schedule grid. */
export function SchedulerGridHeader({
  headerRef,
  utilizationPrefs: utilizationPreferences,
  visibleWeeksLabel,
  visibleSpanCompact,
  overallUtil,
  days,
  geom: geometry,
  ui,
  calendarWeekStartsOn,
  today,
}: Props) {
  return (
    <>
      {/* Content-width sizing keeps the header and rows spanning the full timeline; stretch sizing would clamp the flex item to the viewport and clip its paint. */}
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
          {utilizationPreferences.showTotal && (
            <>
              <span
                className="text-2xs font-medium uppercase tracking-wide text-faint"
                title={m.scheduler_total_util_title({
                  span: visibleWeeksLabel,
                })}
              >
                {m.scheduler_total_util_label({ span: visibleSpanCompact })}
              </span>
              <span data-testid="overall-utilization" className="text-sm font-semibold">
                {overallUtil}%
              </span>
            </>
          )}
        </div>
        <DateHeader
          days={days}
          geom={geometry}
          visibleWeeks={ui.zoom}
          weekStartsOn={calendarWeekStartsOn}
          today={today}
        />
      </div>
    </>
  );
}
