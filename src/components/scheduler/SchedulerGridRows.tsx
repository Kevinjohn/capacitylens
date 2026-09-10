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

function SchedulerGridItem({ props, itemIndex, position }: { props: Props; itemIndex: number; position: number }) {
  const { items, renderedIndices, layout, heights, ui, density, toggleGroup, geom, utilizationPrefs } = props;
  const item = items[itemIndex];
  if (!item) return null;
  const previousIndex = renderedIndices[position - 1];
  const previousBottom =
    previousIndex === undefined ? 0 : (layout.tops[previousIndex] ?? 0) + (heights[previousIndex] ?? 0);
  const gap = Math.max(0, (layout.tops[itemIndex] ?? 0) - previousBottom);
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
        {...props}
        key={`r-${item.row.resource.id}`}
        group={item.group}
        row={item.row}
        rowIndex={rowIndex}
      />
    );
  return (
    <Fragment key={`window-${itemIndex}`}>
      {gap > 0 && <div aria-hidden style={{ height: gap }} />}
      {rendered}
    </Fragment>
  );
}

function TrailingSpacer({ renderedIndices, layout, heights }: Pick<Props, "renderedIndices" | "layout" | "heights">) {
  const finalIndex = renderedIndices[renderedIndices.length - 1];
  if (finalIndex === undefined) return null;
  const renderedBottom = (layout.tops[finalIndex] ?? 0) + (heights[finalIndex] ?? 0);
  const gap = Math.max(0, layout.total - renderedBottom);
  return gap > 0 ? <div aria-hidden style={{ height: gap }} /> : null;
}

export function SchedulerGridRows(props: Props) {
  const { items, renderedIndices, timelineStart, timelineEnd, visibleClosures, trackedGridHeight, geom } = props;
  const firstResourceIndex = items.findIndex((item) => item.kind === "row");
  const closureLabelTop = firstResourceIndex === -1 ? 0 : (props.layout.tops[firstResourceIndex] ?? 0);
  return (
    <>
      {items.length > 0 && (
        <div role="rowgroup" className="relative min-w-max shrink-0">
          {renderedIndices.map((itemIndex, position) => (
            <SchedulerGridItem key={itemIndex} props={props} itemIndex={itemIndex} position={position} />
          ))}
          {renderedIndices.length > 0 && <TrailingSpacer {...props} />}
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
                labelTop={closureLabelTop}
              />
            ))}
        </div>
      )}
    </>
  );
}
