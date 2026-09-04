import { Fragment } from "react";
import { LAYOUT } from "./layout";
import { ClosureBand } from "./ClosureBand";
import { SchedulerGridRow, type SchedulerGridRowProps } from "./SchedulerGridRow";
import { SchedulerGridGroupHeader } from "./SchedulerGridGroupHeader";
import type { SchedulerUI } from "../../store/useStore";
import type { useSchedulerGridVirtualization } from "./useSchedulerGridVirtualization";

type Props = ReturnType<typeof useSchedulerGridVirtualization> &
  Omit<SchedulerGridRowProps, "group" | "row" | "rowIndex" | "ui"> & {
    ui: SchedulerUI;
    toggleGroup: (key: string) => void;
  };
export function SchedulerGridRows({
  items,
  renderedIndices,
  layout,
  heights,
  timelineStart,
  timelineEnd,
  visibleClosures,
  trackedGridHeight,
  ui,
  density,
  toggleGroup,
  geom,
  utilizationPrefs,
  visibleWeeksLabel,
  canEdit,
  visibleStartDate,
  setModal,
  days,
  todayX,
  dayWidth,
  calendarWeekStartsOn,
  handleEdit,
  handleDraw,
}: Props) {
  return (
    <>
      {items.length > 0 && (
        <div role="rowgroup" className="relative min-w-max shrink-0">
          {renderedIndices.map((itemIndex, position) => {
            const item = items[itemIndex];
            if (!item) return null;
            const previousIndex = renderedIndices[position - 1];
            const previousBottom =
              previousIndex === undefined ? 0 : (layout.tops[previousIndex] ?? 0) + (heights[previousIndex] ?? 0);
            const gap = Math.max(0, (layout.tops[itemIndex] ?? 0) - previousBottom);
            // aria-rowindex is 1-based and global: header is 1, so items start at 2.
            const rowIndex = itemIndex + 2;
            const rendered =
              item.kind === "group" ? (
                <SchedulerGridGroupHeader
                  key={`g-${item.group.key}`}
                  group={item.group}
                  rowIndex={rowIndex}
                  ui={ui}
                  density={density}
                  toggleGroup={toggleGroup}
                  geom={geom}
                  utilizationPrefs={utilizationPrefs}
                />
              ) : (
                <SchedulerGridRow
                  key={`r-${item.row.resource.id}`}
                  group={item.group}
                  row={item.row}
                  rowIndex={rowIndex}
                  ui={ui}
                  density={density}
                  utilizationPrefs={utilizationPrefs}
                  visibleWeeksLabel={visibleWeeksLabel}
                  canEdit={canEdit}
                  visibleStartDate={visibleStartDate}
                  setModal={setModal}
                  days={days}
                  todayX={todayX}
                  dayWidth={dayWidth}
                  geom={geom}
                  calendarWeekStartsOn={calendarWeekStartsOn}
                  handleEdit={handleEdit}
                  handleDraw={handleDraw}
                />
              );
            return (
              <Fragment key={`window-${itemIndex}`}>
                {gap > 0 && <div aria-hidden style={{ height: gap }} />}
                {rendered}
              </Fragment>
            );
          })}
          {renderedIndices.length > 0 &&
            (() => {
              const finalIndex = renderedIndices[renderedIndices.length - 1];
              const renderedBottom = (layout.tops[finalIndex] ?? 0) + (heights[finalIndex] ?? 0);
              const gap = Math.max(0, layout.total - renderedBottom);
              return gap > 0 ? <div aria-hidden style={{ height: gap }} /> : null;
            })()}
          {timelineStart &&
            timelineEnd &&
            visibleClosures.map((closure) => (
              <ClosureBand
                key={closure.id}
                closure={closure}
                visibleStart={timelineStart}
                visibleEnd={timelineEnd}
                geom={geom}
                leftOffset={LAYOUT.leftColWidth}
                height={trackedGridHeight}
              />
            ))}
        </div>
      )}
    </>
  );
}
