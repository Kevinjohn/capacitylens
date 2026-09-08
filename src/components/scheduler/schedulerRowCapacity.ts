import {
  applyCapacityMode,
  buildDayCapacity,
  resolveUtilizationFromCapacity,
  type DayCapacity,
} from "../../lib/capacity";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import type { EffectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import {
  isExternalResource,
  type Allocation,
  type Closure,
  type ISODate,
  type Resource,
  type TimeOff,
} from "@capacitylens/shared/types/entities";
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
    getCapacityOnDay: buildEmptyDayCapacity,
    getAllocationCountOn: () => 0,
    getTimeOffCountOn: () => 0,
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
  const getCapacityOnDay = (date: ISODate): DayCapacity => {
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
  const getTimeOffCountOn = (date: ISODate) => {
    const closureCount = capacityDateSet.has(date)
      ? (closuresByDate.get(date)?.length ?? 0)
      : closures.filter((closure) => closure.startDate <= date && closure.endDate >= date).length;
    return listTimeOffOn(date).length + closureCount;
  };
  return {
    tracked: true,
    listTimeOffOn,
    getCapacityOnDay,
    getAllocationCountOn: (date) => allocationsByDate.get(date)?.length ?? 0,
    getTimeOffCountOn,
    resolveUtilizationOver: (dates) => resolveUtilizationFromCapacity(dates.map(getCapacityOnDay)),
    isOverOn: (dates) => dates.some((date) => getCapacityOnDay(date).over),
  };
}

export function createCapacitySource({
  days,
  visibleWindow: { start: visibleStart, end: visibleEnd },
  overSoonWindow: { start: overStart, end: overEnd },
  closures,
  blocksMode,
}: CreateCapacitySourceInput) {
  // The [visibleStart, visibleEnd] and [overStart, overEnd] windows are RESOURCE-INVARIANT — every row in
  // this model reads the exact same two windows. Building their day arrays here ONCE avoids resources
  // × (visibleDays + 14) redundant eachDayISO calls per model rebuild (this fires on every scroll-day
  // change, zoom, filter keystroke and edit). Each row separately caches its computed resource-day
  // results below, so dates shared by the timeline, visible window and fixed overSoon window scan
  // that resource's allocations/time off only once. Not sliced from `days`: `days` covers the
  // SCROLLABLE timeline, while overStart/overEnd
  // is a FIXED window anchored on today that can fall outside it (and visibleStart/visibleEnd, though always
  // within `days` in practice, isn't worth a fragile index-based slice to save one extra pair of calls).
  const visibleDays = eachDayISO(visibleStart, visibleEnd);
  const overDays = eachDayISO(overStart, overEnd);
  // Every per-day capacity lookup below asks for a date drawn from one of those three arrays, so
  // their sorted, de-duplicated union is the COMPLETE set of dates any row can query. Bucketing a
  // resource's allocations / time off onto it once (see bucketByCoveredDate) is what turns the
  // per-row day loop from O(days × allocations) into O(days + coverage). Resource-invariant, so it
  // is built here once rather than per row. ISO dates sort lexicographically = chronologically.
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
    // Bucket this resource's load and time off by the days they cover, ONCE, so each of the
    // ~150 timeline days hands capacity.ts only the rows that actually touch that day instead
    // of making it rescan every allocation (and every time-off row) per day.
    // Capacity reflects ALL the resource's allocations (truthful load), not the filtered view.
    return createTrackedCapacitySource({ resource, allocations, resourceTimeOff, effectiveWeek }, context);
  };

  return { capacitySourceFor: createResourceCapacitySource, visDays: visibleDays, overDays };
}
