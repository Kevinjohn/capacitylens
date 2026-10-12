import { applyCapacityMode, buildDayCapacity, resolveUtilizationFromCapacity } from "@/lib/capacity";
import type { DayCapacity } from "@/lib/capacity";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { isExternalResource } from "@capacitylens/shared/types/entities";
import type { Allocation, Closure, ISODate, Resource, TimeOff } from "@capacitylens/shared/types/entities";
import { bucketByCoveredDate, NO_ALLOCATIONS, NO_TIME_OFF, NO_CLOSURES } from "./schedulerModelIndexing";
import type { CapacitySource, SchedulerModelOptions } from "./schedulerModelTypes";

interface CreateCapacitySourceInput {
  days: ISODate[];
  visibleWindow: SchedulerModelOptions["visibleWindow"];
  overSoonWindow: SchedulerModelOptions["overSoonWindow"];
  closures: Closure[];
  blocksMode: boolean;
}

interface ResourceCapacitySourceInput {
  resource: Resource;
  allocations: Allocation[];
  resourceTimeOff: TimeOff[];
  effectiveWeek: EffectiveWorkingWeek;
}

interface CapacityContext {
  capacityDates: ISODate[];
  capacityDateSet: Set<ISODate>;
  closures: Closure[];
  closuresByDate: Map<ISODate, Closure[]>;
  blocksMode: boolean;
}

const buildEmptyDayCapacity = (date: ISODate): DayCapacity => ({ date, allocated: 0, available: 0, over: false });

function createUntrackedCapacitySource(): CapacitySource {
  return {
    tracked: false,
    listTimeOffOn: () => NO_TIME_OFF,
    resolveCapacityOnDay: buildEmptyDayCapacity,
    countAllocationsOn: () => 0,
    countTimeOffOn: () => 0,
    resolveUtilizationOver: () => 0,
    isOverOn: () => false,
  };
}

function createTrackedCapacitySource(input: ResourceCapacitySourceInput, context: CapacityContext): CapacitySource {
  const { resource, allocations, resourceTimeOff, effectiveWeek } = input;
  const { capacityDates, capacityDateSet, closures, closuresByDate, blocksMode } = context;
  const capacityAllocations = applyCapacityMode({ allocations, blocksMode });
  const allocationsByDate = bucketByCoveredDate(capacityAllocations, capacityDates);
  const personalTimeOffByDate = bucketByCoveredDate(resourceTimeOff, capacityDates);
  const capacityByDate = new Map<ISODate, DayCapacity>();
  const resolveCapacityOnDay = (date: ISODate): DayCapacity => {
    const cached = capacityByDate.get(date);
    if (cached) return cached;
    const computed = buildDayCapacity({
      resource,
      date,
      allocations: capacityDateSet.has(date) ? (allocationsByDate.get(date) ?? NO_ALLOCATIONS) : capacityAllocations,
      timeOff: capacityDateSet.has(date) ? (personalTimeOffByDate.get(date) ?? NO_TIME_OFF) : resourceTimeOff,
      effectiveWeek,
      closures: capacityDateSet.has(date) ? (closuresByDate.get(date) ?? NO_CLOSURES) : closures,
    });
    capacityByDate.set(date, computed);
    return computed;
  };
  const listTimeOffOn = (date: ISODate) =>
    capacityDateSet.has(date) ? (personalTimeOffByDate.get(date) ?? NO_TIME_OFF) : resourceTimeOff;
  const countTimeOffOn = (date: ISODate) => {
    const closureCount = capacityDateSet.has(date)
      ? (closuresByDate.get(date)?.length ?? 0)
      : closures.filter((closure) => closure.startDate <= date && closure.endDate >= date).length;
    return listTimeOffOn(date).length + closureCount;
  };
  return {
    tracked: true,
    listTimeOffOn,
    resolveCapacityOnDay,
    countAllocationsOn: (date) => allocationsByDate.get(date)?.length ?? 0,
    countTimeOffOn,
    resolveUtilizationOver: (dates) => resolveUtilizationFromCapacity(dates.map(resolveCapacityOnDay)),
    isOverOn: (dates) => dates.some((date) => resolveCapacityOnDay(date).over),
  };
}

/** Combines resource availability and dated exceptions for capacity calculations. */
export function createCapacitySource({
  days,
  visibleWindow: { start: visibleStart, end: visibleEnd },
  overSoonWindow: { start: overStart, end: overEnd },
  closures,
  blocksMode,
}: CreateCapacitySourceInput) {
  // Build visible, timeline and forward-warning date sets once per model. The forward window can lie outside the scrollable timeline, so it must not be derived by slicing timeline indices.
  const visibleDays = eachDayISO(visibleStart, visibleEnd);
  const overDays = eachDayISO(overStart, overEnd);
  // Index the sorted union of all queried date windows once per model so each resource needs only one ordered coverage bucket. ISO-date lexical order is chronological order.
  const capacityDates = Array.from(new Set([...days, ...visibleDays, ...overDays])).sort();
  const capacityDateSet = new Set(capacityDates);
  const closuresByDate = bucketByCoveredDate(closures, capacityDates);

  const context = { capacityDates, capacityDateSet, closures, closuresByDate, blocksMode };
  const createResourceCapacitySource = ({
    resource,
    allocations,
    resourceTimeOff,
    effectiveWeek,
  }: ResourceCapacitySourceInput): CapacitySource => {
    if (isExternalResource(resource)) return createUntrackedCapacitySource();
    // Capacity reads the resource's complete load even when filters hide work. Per-date buckets avoid repeated scans while preserving that truthful load.
    return createTrackedCapacitySource({ resource, allocations, resourceTimeOff, effectiveWeek }, context);
  };

  return { capacitySourceFor: createResourceCapacitySource, visDays: visibleDays, overDays };
}
