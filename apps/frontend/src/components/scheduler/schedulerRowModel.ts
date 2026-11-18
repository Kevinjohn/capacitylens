import { resolveLaneTop, packLanes, resolveRowHeightForLanes } from '@/lib/lanePacking';
import { isHalfDay } from '@capacitylens/shared/lib/capacity';
import { rangesOverlap, weekdayOf } from '@capacitylens/shared/lib/dateMath';
import { effectiveWorkingWeek } from '@capacitylens/shared/lib/effectiveWorkingWeek';
import { resolveBarColor } from '@capacitylens/shared/lib/color';
import { resolveTimeOffTypeLabel } from '@/lib/metadata';
import { isExternalResource } from '@capacitylens/shared/types/entities';
import type {
  Allocation,
  ID,
  ISODate,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities';
import { isCreationStartBlockedForEffectiveWeek } from './creationAvailability';
import { includeRenderableDateRange } from '@/lib/renderableDateRanges';
import type { createAllocationFilters } from './schedulerModelFilters';
import type { createCapacitySource } from './schedulerRowCapacity';
import type {
  BarLayout,
  CapacitySource,
  DayState,
  RowModel,
  SchedulerModelOptions,
  TimeOffBlock,
} from './schedulerModelTypes';

interface CreateRowBuilderInput {
  model: Pick<SchedulerModelOptions, 'geom' | 'days'>;
  accountWorkingDays: NonNullable<SchedulerModelOptions['preferences']['accountWorkingDays']>;
  blocksMode: boolean;
  laneLayout: NonNullable<SchedulerModelOptions['laneLayout']>;
  allocationsByResource: Map<ID, Allocation[]>;
  timeOffByResource: Map<ID, TimeOff[]>;
  // Renderable closures only, so day states and capacity omit the same invalid rows.
  closures: SchedulerModelOptions['data']['closures'];
  seriesEndByKey: Map<string, ISODate>;
  allocationFilters: ReturnType<typeof createAllocationFilters>;
  capacitySource: ReturnType<typeof createCapacitySource>;
}

type AllocationFilters = ReturnType<typeof createAllocationFilters>;
const NO_TIME_OFF_BLOCKS: TimeOffBlock[] = [];

function buildTimeOffBlock(
  timeOffEntry: TimeOff,
  geometry: SchedulerModelOptions['geom'],
): TimeOffBlock {
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
  filters: Pick<AllocationFilters, 'notTentativeHidden'>;
  matchingVisibleAllocations: Allocation[];
}): Allocation[] {
  if (!input.dimmed) return input.matchingVisibleAllocations;
  return input.allAllocations
    .filter(input.filters.notTentativeHidden)
    .filter(input.hasTimelineIntersection);
}

function buildBars(input: {
  allocations: Allocation[];
  geometry: SchedulerModelOptions['geom'];
  laneLayout: NonNullable<SchedulerModelOptions['laneLayout']>;
  seriesEndByKey: Map<string, ISODate>;
  filters: Pick<AllocationFilters, 'projectClientFor' | 'activityById' | 'colorMaps'>;
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
      label: input.filters.activityById.get(allocation.activityId)?.name ?? 'Activity',
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
  closures: CreateRowBuilderInput['closures'];
  effectiveWeek: ReturnType<typeof effectiveWorkingWeek>;
  capacity: CapacitySource;
}): Pick<RowModel, 'dayStates' | 'conflictDayCount' | 'partialCapacityDayCount'> {
  const dayStates: DayState[] = [];
  let conflictDayCount = 0;
  let partialCapacityDayCount = 0;
  for (const date of input.days) {
    // A date the server's read did not cover draws no capacity cue until its read arrives.
    const dayCapacity = input.capacity.resolveCapacityOnDay(date);
    const over = dayCapacity?.over ?? false;
    const creationBlocked = isCreationStartBlockedForEffectiveWeek({
      resource: input.resource,
      date,
      timeOff: input.capacity.listTimeOffOn(date),
      effectiveWeek: input.effectiveWeek,
      closures: input.closures,
    });
    const unavailable = (input.capacity.tracked && dayCapacity?.available === 0) || creationBlocked;
    const partialCapacity =
      input.capacity.tracked && !unavailable && isHalfDay(input.resource, weekdayOf(date));
    const hasTimeOff = input.capacity.countTimeOffOn(date) > 0;
    const timeOffConflict =
      hasTimeOff && (input.blocksMode ? input.capacity.countAllocationsOn(date) > 0 : over);
    if (over || timeOffConflict) conflictDayCount++;
    if (partialCapacity) partialCapacityDayCount++;
    dayStates.push({
      over,
      timeOffConflict,
      unavailable,
      partialCapacity,
      creationBlocked,
      hasTimeOff,
    });
  }
  return { dayStates, conflictDayCount, partialCapacityDayCount };
}

/** Builds resource rows against one shared scheduler model context. */
export function createRowBuilder({
  model: { geom: geometry, days },
  accountWorkingDays,
  blocksMode,
  laneLayout,
  allocationsByResource,
  timeOffByResource,
  closures,
  seriesEndByKey,
  allocationFilters,
  capacitySource: { capacitySourceFor, visDays: visibleDays },
}: CreateRowBuilderInput) {
  const hasTimelineIntersection = createTimelineIntersection(days);

  return function buildRow(resource: Resource): RowModel {
    const allAllocations = (allocationsByResource.get(resource.id) ?? []).filter(
      includeRenderableDateRange,
    );
    const resourceTimeOff = timeOffByResource.get(resource.id) ?? [];
    const isExternal = isExternalResource(resource);

    const effectiveWeek = effectiveWorkingWeek(resource, accountWorkingDays);
    // Determine dimming from matching bars inside the displayed timeline so hidden or off-timeline work cannot create an empty full-opacity row. Unmatched staffing rows retain their real load.
    const matchingVisibleAllocations = allAllocations
      .filter(allocationFilters.allocVisible)
      .filter(hasTimelineIntersection);
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
    const capacity = capacitySourceFor({
      resource,
      allocations: allAllocations,
      resourceTimeOff,
    });
    const daySummary = buildDayStates({
      resource,
      days,
      blocksMode,
      closures,
      effectiveWeek,
      capacity,
    });

    const personalTimeOffBlocks = resourceTimeOff
      .filter(hasTimelineIntersection)
      .map((entry) => buildTimeOffBlock(entry, geometry));
    const timeOff: TimeOffBlock[] = capacity.tracked ? personalTimeOffBlocks : NO_TIME_OFF_BLOCKS;
    // Visible utilisation sums the server's figures over the visible dates; overSoon is the server's flag. Untracked externals report neither signal.
    const utilization = capacity.resolveUtilizationOver(visibleDays);
    return {
      resource,
      rowHeight: resolveRowHeightForLanes(laneCount, laneLayout),
      bars,
      ...daySummary,
      timeOff,
      utilization,
      overSoon: capacity.overSoon,
      dimmed,
    };
  };
}
