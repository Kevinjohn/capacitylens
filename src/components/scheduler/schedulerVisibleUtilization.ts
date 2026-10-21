import { applyCapacityMode, buildDayCapacity, resolveUtilizationFromCapacity } from "@/lib/capacity";
import { addDaysISO, eachDayISO, rangesOverlap } from "@capacitylens/shared/lib/dateMath";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { AppData, ISODate, Weekday } from "@capacitylens/shared/types/entities";
import type { GroupModel } from "./schedulerModelTypes";
import { packLanes, resolveLaneTop, resolveRowHeightForLanes } from "@/lib/lanePacking";
import type { LaneLayout } from "@/lib/lanePacking";
import { laneLayout as compactLaneLayout } from "./layout";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import {
  hasRenderableDateRange,
  reportInvalidScheduleDateRangeOnce,
  bucketByCoveredDate,
  groupByResourceId,
  NO_ALLOCATIONS,
  NO_TIME_OFF,
  NO_CLOSURES,
} from "./schedulerModelIndexing";

interface ApplyVisibleUtilizationInput {
  model: GroupModel[];
  data: AppData;
  start: ISODate;
  end: ISODate;
  accountWorkingDays: Weekday[];
  blocksMode?: boolean | undefined;
  laneLayout?: LaneLayout | undefined;
  partiallyExposesNextColumn?: boolean | undefined;
}

function includeRenderableDateRange<T extends { id: string; startDate: ISODate; endDate: ISODate }>(row: T): boolean {
  const renderable = hasRenderableDateRange(row);
  if (!renderable) reportInvalidScheduleDateRangeOnce(row);
  return renderable;
}

function projectVisibleLanes({
  row,
  start,
  end,
  layout,
  partiallyExposesNextColumn,
}: {
  row: GroupModel["rows"][number];
  start: ISODate;
  end: ISODate;
  layout: LaneLayout;
  partiallyExposesNextColumn: boolean;
}) {
  // The visible window is day-quantized, but a non-aligned scroll can expose the next column.
  // Pack that partial column too so its bars cannot fall through to lane 0 over visible work.
  const packingEnd = partiallyExposesNextColumn ? addDaysISO(end, 1) : end;
  const visibleBars = row.bars.filter(({ allocation }) =>
    rangesOverlap(allocation.startDate, allocation.endDate, start, packingEnd),
  );
  const { lanes, laneCount } = packLanes(visibleBars.map(({ allocation }) => allocation));
  const laneById = new Map(lanes.map(({ id, lane }) => [id, lane]));
  const bars = row.bars.map((bar) => {
    const top = resolveLaneTop(laneById.get(bar.allocation.id) ?? 0, layout);
    if (top === bar.top) return bar;
    return { ...bar, top };
  });
  const rowHeight = resolveRowHeightForLanes(laneCount, layout);
  return {
    bars: bars.some((bar, index) => bar !== row.bars[index]) ? bars : row.bars,
    rowHeight,
  };
}

/** Recompute the visible-window percentage and lane layout while retaining the expensive bar
 * geometry and timeline-day model. Horizontal scrolling changes this projection, not the static
 * schedule. Off-screen overlaps must not make the row taller than the work currently in view. */
export function applyVisibleUtilization({
  model,
  data,
  start,
  end,
  accountWorkingDays,
  blocksMode = false,
  laneLayout = compactLaneLayout,
  partiallyExposesNextColumn = false,
}: ApplyVisibleUtilizationInput): GroupModel[] {
  const days = eachDayISO(start, end);
  const allocations = groupByResourceId(data.allocations, { include: includeRenderableDateRange });
  const personalTimeOff = groupByResourceId(data.timeOff, { include: includeRenderableDateRange });
  const closuresByDate = bucketByCoveredDate(data.closures.filter(includeRenderableDateRange), days);
  return model.map((group) => {
    const rows = group.rows.map((row) => {
      const visibleLanes = projectVisibleLanes({
        row,
        start,
        end,
        layout: laneLayout,
        partiallyExposesNextColumn,
      });

      if (isExternalResource(row.resource)) {
        if (row.utilization === 0 && visibleLanes.bars === row.bars && visibleLanes.rowHeight === row.rowHeight) {
          return row;
        }
        return { ...row, ...visibleLanes, utilization: 0 };
      }
      const resourceAllocations = applyCapacityMode({
        allocations: allocations.get(row.resource.id) ?? [],
        blocksMode: blocksMode,
      });
      const resourceTimeOff = personalTimeOff.get(row.resource.id) ?? [];
      const effectiveWeek = effectiveWorkingWeek(row.resource, accountWorkingDays);
      // Bucket load once per row so scrolling does not rescan every allocation for every date. Preserve insertion order because floating-point addition is order-dependent.
      const allocationsByDate = bucketByCoveredDate(resourceAllocations, days);
      const personalTimeOffByDate = bucketByCoveredDate(resourceTimeOff, days);
      const next = resolveUtilizationFromCapacity(
        days.map((date) =>
          buildDayCapacity({
            resource: row.resource,
            date: date,
            allocations: allocationsByDate.get(date) ?? NO_ALLOCATIONS,
            timeOff: personalTimeOffByDate.get(date) ?? NO_TIME_OFF,
            effectiveWeek: effectiveWeek,
            closures: closuresByDate.get(date) ?? NO_CLOSURES,
          }),
        ),
      );
      if (next === row.utilization && visibleLanes.bars === row.bars && visibleLanes.rowHeight === row.rowHeight) {
        return row;
      }
      return { ...row, ...visibleLanes, utilization: next };
    });
    return rows.some((row, index) => row !== group.rows[index]) ? { ...group, rows } : group;
  });
}
