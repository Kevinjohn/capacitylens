import { resolveUtilisationFromCapacity } from '@capacitylens/shared/lib/capacity';
import type { CapacitySection, DayCapacity } from '@capacitylens/shared/lib/capacity';
import { bucketByCoveredDate, dayIndex, eachDayISO } from '@capacitylens/shared/lib/dateMath';
import { isExternalResource } from '@capacitylens/shared/types/entities';
import type {
  Allocation,
  Closure,
  ISODate,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities';
import { NO_TIME_OFF } from './schedulerModelIndexing';
import type { CapacitySource, SchedulerModelOptions } from './schedulerModelTypes';

interface CreateCapacitySourceInput {
  days: ISODate[];
  visibleWindow: SchedulerModelOptions['visibleWindow'];
  capacity: SchedulerModelOptions['capacity'];
  closures: Closure[];
}

interface ResourceCapacitySourceInput {
  resource: Resource;
  allocations: Allocation[];
  resourceTimeOff: TimeOff[];
}

interface CapacityContext {
  days: ISODate[];
  capacity: CapacitySection | null;
  closuresByDate: Map<ISODate, Closure[]>;
}

/** The server's figures for one resource on one date of its read window. Undefined when the read
 * did not cover the date, as when the grid has moved and the read for its new window is pending. */
export function readServerDayCapacity(
  capacity: CapacitySection | null,
  resourceId: string,
  date: ISODate,
): DayCapacity | undefined {
  const days = capacity?.resources[resourceId]?.window;
  if (!capacity || !days) return undefined;
  const index = dayIndex(date, capacity.window.from);
  const allocated = days.allocated[index];
  const available = days.available[index];
  const over = days.over[index];
  if (allocated === undefined || available === undefined || over === undefined) return undefined;
  return { date, allocated, available, over };
}

/** Visible utilisation summed from the server's figures; dates the read did not cover are left out. */
export function resolveServerUtilisation(
  capacity: CapacitySection | null,
  resourceId: string,
  dates: ISODate[],
): number {
  return resolveUtilisationFromCapacity(
    dates.flatMap((date) => readServerDayCapacity(capacity, resourceId, date) ?? []),
  );
}

function createUntrackedCapacitySource(): CapacitySource {
  return {
    tracked: false,
    listTimeOffOn: () => NO_TIME_OFF,
    resolveCapacityOnDay: () => undefined,
    countAllocationsOn: () => 0,
    countTimeOffOn: () => 0,
    resolveUtilisationOver: () => 0,
    overSoon: false,
  };
}

function createTrackedCapacitySource(
  { resource, allocations, resourceTimeOff }: ResourceCapacitySourceInput,
  { days, capacity, closuresByDate }: CapacityContext,
): CapacitySource {
  const allocationsByDate = bucketByCoveredDate(allocations, days);
  const personalTimeOffByDate = bucketByCoveredDate(resourceTimeOff, days);
  const listTimeOffOn = (date: ISODate) => personalTimeOffByDate.get(date) ?? NO_TIME_OFF;
  return {
    tracked: true,
    listTimeOffOn,
    resolveCapacityOnDay: (date) => readServerDayCapacity(capacity, resource.id, date),
    countAllocationsOn: (date) => allocationsByDate.get(date)?.length ?? 0,
    countTimeOffOn: (date) => listTimeOffOn(date).length + (closuresByDate.get(date)?.length ?? 0),
    resolveUtilisationOver: (dates) => resolveServerUtilisation(capacity, resource.id, dates),
    overSoon: capacity?.resources[resource.id]?.overSoon ?? false,
  };
}

/** Reads each resource's capacity cues from the server's figures and its dated exceptions. */
export function createCapacitySource({
  days,
  visibleWindow,
  capacity,
  closures,
}: CreateCapacitySourceInput) {
  const context = { days, capacity, closuresByDate: bucketByCoveredDate(closures, days) };
  const createResourceCapacitySource = (input: ResourceCapacitySourceInput): CapacitySource =>
    isExternalResource(input.resource)
      ? createUntrackedCapacitySource()
      : createTrackedCapacitySource(input, context);

  return {
    capacitySourceFor: createResourceCapacitySource,
    visDays: visibleWindow ? eachDayISO(visibleWindow.start, visibleWindow.end) : [],
  };
}
