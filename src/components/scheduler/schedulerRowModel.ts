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

type AllocationFilters = ReturnType<typeof createAllocationFilters>;
type CapacitySource = ReturnType<ReturnType<typeof createCapacitySource>["capacitySourceFor"]>;
const NO_TIME_OFF_BLOCKS: TimeOffBlock[] = [];

function includeRenderableDateRange(row: { id: string; startDate: ISODate; endDate: ISODate }): boolean {
  const renderable = hasRenderableDateRange(row);
  if (!renderable) reportInvalidScheduleDateRangeOnce(row);
  return renderable;
}

function buildTimeOffBlock(timeOffEntry: TimeOff, geometry: SchedulerModelOptions["geom"]): TimeOffBlock {
  return {
    id: timeOffEntry.id,
    x: geometry.xForDateInGeom(timeOffEntry.startDate),
    width: geometry.widthForDates(timeOffEntry.startDate, timeOffEntry.endDate),
    label: resolveTimeOffTypeLabel(timeOffEntry.type),
    ...(timeOffEntry.note ? { note: timeOffEntry.note } : {}),
  };
}

function createTimelineIntersection(days: ISODate[]) {
  const timelineStart = days[0];
  const timelineEnd = days[days.length - 1];
  return (row: { startDate: ISODate; endDate: ISODate }) =>
    timelineStart !== undefined &&
    timelineEnd !== undefined &&
    rangesOverlap(row.startDate, row.endDate, timelineStart, timelineEnd);
}

function listVisibleAllocations(input: {
  allAllocations: Allocation[];
  dimmed: boolean;
  hasTimelineIntersection: (row: { startDate: ISODate; endDate: ISODate }) => boolean;
  filters: Pick<AllocationFilters, "notTentativeHidden" | "barVisibleByInternalPref">;
  matchingVisibleAllocations: Allocation[];
}): Allocation[] {
  if (!input.dimmed) return input.matchingVisibleAllocations;
  return input.allAllocations
    .filter(input.filters.notTentativeHidden)
    .filter(input.hasTimelineIntersection)
    .filter(input.filters.barVisibleByInternalPref);
}

function buildBars(input: {
  allocations: Allocation[];
  geometry: SchedulerModelOptions["geom"];
  laneLayout: NonNullable<SchedulerModelOptions["laneLayout"]>;
  seriesEndByKey: Map<string, ISODate>;
  filters: Pick<AllocationFilters, "projectClientFor" | "activityById" | "colorMaps">;
  external: boolean;
}): { bars: BarLayout[]; laneCount: number } {
  const { lanes, laneCount } = packLanes(input.allocations);
  const laneIndicesByAllocationId = new Map(lanes.map((lane) => [lane.id, lane.lane]));
  const bars = input.allocations.map((allocation) => {
    const { project, client } = input.filters.projectClientFor(allocation);
    const seriesEnd = allocation.seriesId
      ? input.seriesEndByKey.get(`${allocation.accountId}\u0000${allocation.seriesId}`)
      : undefined;
    return {
      allocation,
      x: input.geometry.xForDateInGeom(allocation.startDate),
      width: input.geometry.widthForDates(allocation.startDate, allocation.endDate),
      top: resolveLaneTop(laneIndicesByAllocationId.get(allocation.id) ?? 0, input.laneLayout),
      color: resolveBarColor(allocation, input.filters.colorMaps),
      label: input.filters.activityById.get(allocation.activityId)?.name ?? "Activity",
      ...(project ? { project: project.name } : {}),
      ...(client ? { client: client.name } : {}),
      ...(seriesEnd ? { seriesEnd } : {}),
      external: input.external,
    };
  });
  return { bars, laneCount };
}

function buildDayStates(input: {
  resource: Resource;
  days: ISODate[];
  blocksMode: boolean;
  closures: CreateRowBuilderInput["model"]["data"]["closures"];
  effectiveWeek: ReturnType<typeof effectiveWorkingWeek>;
  capacity: CapacitySource;
}): Pick<RowModel, "dayStates" | "conflictDayCount" | "partialCapacityDayCount"> {
  const dayStates: DayState[] = [];
  let conflictDayCount = 0;
  let partialCapacityDayCount = 0;
  for (const date of input.days) {
    const dayCapacity = input.capacity.getCapacityOnDay(date);
    const creationBlocked = isCreationStartBlockedForEffectiveWeek({
      resource: input.resource,
      date,
      timeOff: input.capacity.listTimeOffOn(date),
      effectiveWeek: input.effectiveWeek,
      closures: input.closures,
    });
    const unavailable = (input.capacity.tracked && dayCapacity.available === 0) || creationBlocked;
    const partialCapacity = input.capacity.tracked && !unavailable && isHalfDay(input.resource, weekdayOf(date));
    const hasTimeOff = input.capacity.getTimeOffCountOn(date) > 0;
    const timeOffConflict =
      hasTimeOff && (input.blocksMode ? input.capacity.getAllocationCountOn(date) > 0 : dayCapacity.over);
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
  return { dayStates, conflictDayCount, partialCapacityDayCount };
}

export function createRowBuilder({
  model: { data, geom: geometry, days },
  accountWorkingDays,
  blocksMode,
  laneLayout,
  allocationsByResource,
  timeOffByResource,
  seriesEndByKey,
  allocationFilters,
  capacitySource: { capacitySourceFor, visDays: visibleDays, overDays },
}: CreateRowBuilderInput) {
  const hasTimelineIntersection = createTimelineIntersection(days);

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
      .filter(allocationFilters.allocVisible)
      .filter(hasTimelineIntersection)
      .filter(allocationFilters.barVisibleByInternalPref);
    const dimmed = allocationFilters.workFilterActive && matchingVisibleAllocations.length === 0;
    const visibleAllocations = listVisibleAllocations({
      allAllocations,
      dimmed,
      hasTimelineIntersection,
      filters: allocationFilters,
      matchingVisibleAllocations,
    });
    const { bars, laneCount } = buildBars({
      allocations: visibleAllocations,
      geometry,
      laneLayout,
      seriesEndByKey,
      filters: allocationFilters,
      external: isExternal,
    });
    const capacity = capacitySourceFor({ resource, allocations: allAllocations, resourceTimeOff, effectiveWeek });
    const daySummary = buildDayStates({ resource, days, blocksMode, closures: data.closures, effectiveWeek, capacity });
    // Starved rows draw no blocks (see CapacitySource); tracked rows share the company
    // array and reuse one side untouched when the other is empty, same as mergeTimeOff.
    const personalTimeOffBlocks = resourceTimeOff
      .filter(hasTimelineIntersection)
      .map((entry) => buildTimeOffBlock(entry, geometry));
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
      ...daySummary,
      timeOff,
      utilization,
      overSoon,
      dimmed,
    };
  };
}
