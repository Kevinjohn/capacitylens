import { resolveLaneTop, packLanes, resolveRowHeightForLanes } from "../../lib/lanePacking";
import { isHalfDay } from "../../lib/capacity";
import { rangesOverlap, weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { resolveBarColor } from "@capacitylens/shared/lib/color";
import { resolveTimeOffTypeLabel } from "../../lib/metadata";
import {
  isExternalResource,
  type Allocation,
  type ID,
  type ISODate,
  type Resource,
  type TimeOff,
} from "@capacitylens/shared/types/entities";
import { isCreationStartBlockedForEffectiveWeek } from "./creationAvailability";
import { hasRenderableDateRange, reportInvalidScheduleDateRangeOnce } from "./schedulerModelIndexing";
import type { createAllocationFilters } from "./schedulerModelFilters";
import type { createCapacitySource } from "./schedulerRowCapacity";
import type { BarLayout, DayState, RowModel, SchedulerModelOptions, TimeOffBlock } from "./schedulerModelTypes";

interface CreateRowBuilderInput {
  model: Pick<SchedulerModelOptions, "data" | "geom" | "days">;
  accountWorkingDays: NonNullable<SchedulerModelOptions["preferences"]["accountWorkingDays"]>;
  blocksMode: boolean;
  laneLayout: NonNullable<SchedulerModelOptions["laneLayout"]>;
  allocationsByResource: Map<ID, Allocation[]>;
  timeOffByResource: Map<ID, TimeOff[]>;
  seriesEndByKey: Map<string, ISODate>;
  allocationFilters: ReturnType<typeof createAllocationFilters>;
  capacitySource: ReturnType<typeof createCapacitySource>;
}

export function createRowBuilder({
  model: { data, geom: geometry, days },
  accountWorkingDays,
  blocksMode,
  laneLayout,
  allocationsByResource,
  timeOffByResource,
  seriesEndByKey,
  allocationFilters: {
    allocVisible,
    notTentativeHidden: passesTentativeFilter,
    barVisibleByInternalPref: barVisibleByInternalPreference,
    workFilterActive,
    projectClientFor,
    activityById: activitiesById,
    colorMaps,
  },
  capacitySource: { capacitySourceFor, visDays: visibleDays, overDays },
}: CreateRowBuilderInput) {
  const includeRenderableDateRange = (row: { id: string; startDate: ISODate; endDate: ISODate }): boolean => {
    const renderable = hasRenderableDateRange(row);
    if (!renderable) reportInvalidScheduleDateRangeOnce(row);
    return renderable;
  };
  const timelineStart = days[0];
  const timelineEnd = days[days.length - 1];
  const hasTimelineIntersection = (row: { startDate: ISODate; endDate: ISODate }) =>
    timelineStart !== undefined &&
    timelineEnd !== undefined &&
    rangesOverlap(row.startDate, row.endDate, timelineStart, timelineEnd);

  const buildTimeOffBlock = (timeOffEntry: TimeOff): TimeOffBlock => ({
    id: timeOffEntry.id,
    x: geometry.xForDateInGeom(timeOffEntry.startDate),
    width: geometry.widthForDates(timeOffEntry.startDate, timeOffEntry.endDate),
    label: resolveTimeOffTypeLabel(timeOffEntry.type),
    ...(timeOffEntry.note ? { note: timeOffEntry.note } : {}),
  });
  const NO_TIME_OFF_BLOCKS: TimeOffBlock[] = [];

  return function buildRow(resource: Resource): RowModel {
    // This resource's data, pre-grouped above; capacity then scans only its own
    // allocations/time-off, not the whole dataset per day (was O(res×days×allocs)).
    const allAllocations = (allocationsByResource.get(resource.id) ?? []).filter(includeRenderableDateRange);
    const resourceTimeOff = timeOffByResource.get(resource.id) ?? [];
    const isExternal = isExternalResource(resource);
    // Resolve the company/personal intersection once for the whole row. Capacity, creation
    // blocking, visible utilisation and overSoon all reuse this discriminated result.
    const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
    // A row is "dimmed" when a work filter (client/project OR the activity lens) is active and
    // this resource has NO MATCHING BAR in the displayed timeline — we still show their full
    // real load (so you can see who's free to staff), just visually de-emphasised. Deriving this
    // from the exact matching bar set means off-timeline and otherwise hidden matches cannot
    // create a full-opacity, zero-bar "ghost" row that escapes the show-unmatched filter.
    const matchingVisibleAllocations = allAllocations
      .filter(allocVisible)
      .filter(hasTimelineIntersection)
      .filter(barVisibleByInternalPreference);
    const dimmed = workFilterActive && matchingVisibleAllocations.length === 0;
    const visibleAllocations = dimmed
      ? allAllocations
          .filter(passesTentativeFilter)
          .filter(hasTimelineIntersection)
          // BAR-ONLY internal-work hide (see barVisibleByInternalPref). Applied here, after the
          // capacity path has already taken `allAllocations`, so hiding an internal bar never changes
          // the resource's utilisation/capacity — only which bars render.
          .filter(barVisibleByInternalPreference)
      : matchingVisibleAllocations;
    const { lanes, laneCount } = packLanes(visibleAllocations);
    const laneIndicesByAllocationId = new Map(lanes.map((lane) => [lane.id, lane.lane]));
    const bars: BarLayout[] = visibleAllocations.map((allocation) => {
      const { project, client } = projectClientFor(allocation);
      const seriesEnd = allocation.seriesId
        ? seriesEndByKey.get(`${allocation.accountId}\u0000${allocation.seriesId}`)
        : undefined;
      return {
        allocation: allocation,
        x: geometry.xForDateInGeom(allocation.startDate),
        width: geometry.widthForDates(allocation.startDate, allocation.endDate),
        top: resolveLaneTop(laneIndicesByAllocationId.get(allocation.id) ?? 0, laneLayout),
        color: resolveBarColor(allocation, colorMaps),
        label: activitiesById.get(allocation.activityId)?.name ?? "Activity",
        ...(project ? { project: project.name } : {}),
        ...(client ? { client: client.name } : {}),
        ...(seriesEnd ? { seriesEnd } : {}),
        external: isExternal,
      };
    });
    const capacity = capacitySourceFor({ resource, allocations: allAllocations, resourceTimeOff, effectiveWeek });
    const dayStates: DayState[] = [];
    let conflictDayCount = 0;
    let partialCapacityDayCount = 0;
    for (const date of days) {
      const dayCapacity = capacity.getCapacityOnDay(date);
      // Company-closed dates still receive the shared unavailable tint on EVERY row, starved
      // or not, because allocation creation is blocked there for everyone. The per-date
      // bucket keeps this O(coverage) instead of rescanning the full row list each day.
      const creationBlocked = isCreationStartBlockedForEffectiveWeek({
        resource,
        date,
        timeOff: capacity.listTimeOffOn(date),
        effectiveWeek,
        closures: data.closures,
      });
      const unavailable = (capacity.tracked && dayCapacity.available === 0) || creationBlocked;
      const partialCapacity = capacity.tracked && !unavailable && isHalfDay(resource, weekdayOf(date));
      const hasTimeOff = capacity.getTimeOffCountOn(date) > 0;
      // Blocks carry placement but zero hourly load. Their date-range overlap with time
      // off is therefore an explicit conflict signal rather than fabricated capacity.
      // Hours/Days retain their existing working-day-aware `cap.over` semantics.
      const timeOffConflict = hasTimeOff && (blocksMode ? capacity.getAllocationCountOn(date) > 0 : dayCapacity.over);
      if (dayCapacity.over || timeOffConflict) conflictDayCount++;
      if (partialCapacity) partialCapacityDayCount++;
      dayStates.push({
        over: dayCapacity.over,
        timeOffConflict,
        unavailable,
        partialCapacity,
        creationBlocked,
        hasTimeOff,
      });
    }
    // Starved rows draw no blocks (see CapacitySource); tracked rows share the company
    // array and reuse one side untouched when the other is empty, same as mergeTimeOff.
    const personalTimeOffBlocks = resourceTimeOff.filter(hasTimelineIntersection).map(buildTimeOffBlock);
    const timeOff: TimeOffBlock[] = capacity.tracked ? personalTimeOffBlocks : NO_TIME_OFF_BLOCKS;
    // The DISPLAYED utilisation % runs over the VISIBLE window [visStart, visEnd]; the
    // `overSoon` red flag runs over the FIXED forward window [overStart, overEnd] — two
    // deliberately separate signals (see the param doc above). Utilisation ignores zero-capacity
    // days in its denominator; overSoon follows the strict per-day allocated > available rule, so
    // a time-off day or an opted-in weekend can trip it while a merely-spanned weekend still cannot
    // (weekend-aware allocated hours are zero). Starved rows answer 0 / never over.
    const utilization = capacity.resolveUtilizationOver(visibleDays);
    const overSoon = capacity.isOverOn(overDays);
    return {
      resource,
      rowHeight: resolveRowHeightForLanes(laneCount, laneLayout),
      bars,
      dayStates,
      conflictDayCount,
      partialCapacityDayCount,
      timeOff,
      utilization,
      overSoon,
      dimmed,
    };
  };
}
