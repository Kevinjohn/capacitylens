import { resolveUtilisationFromCapacity } from '@capacitylens/shared/lib/capacity'
import type { CapacitySection, DayCapacity } from '@capacitylens/shared/lib/capacity'
import {
  bucketByCoveredDate,
  calculateDayIndex,
  listDaysISO,
} from '@capacitylens/shared/lib/dateMath'
import { isExternalResource } from '@capacitylens/shared/types/entities'
import type { Closure, ISODate, Resource, TimeOff } from '@capacitylens/shared/types/entities'
import { NO_TIME_OFF } from './schedulerModelIndexing'
import type { CapacitySource, SchedulerModelOptions } from './schedulerModelTypes'

interface CreateCapacitySourceInput {
  days: ISODate[]
  visibleWindow: SchedulerModelOptions['visibleWindow']
  capacity: SchedulerModelOptions['capacity']
  closures: Closure[]
}

interface ResourceCapacitySourceInput {
  resource: Resource
  resourceTimeOff: TimeOff[]
}

interface CapacityContext {
  days: ISODate[]
  capacity: CapacitySection | null
  closuresByDate: Map<ISODate, Closure[]>
}

/** The capacity figures for one resource on one date of its window. Undefined when the window
 * did not cover the date, as when the grid has moved and the read for its new window is pending. */
export function readServerDayCapacity(
  capacity: CapacitySection | null,
  resourceId: string,
  date: ISODate
): DayCapacity | undefined {
  const days = capacity?.resources[resourceId]?.window
  if (!capacity || !days) return undefined
  const index = calculateDayIndex(date, capacity.window.from)
  const allocated = days.allocated[index]
  const available = days.available[index]
  const over = days.over[index]
  if (allocated === undefined || available === undefined || over === undefined) return undefined
  return { date, allocated, available, over }
}

/** One of the per-day capacity flags for a resource; undefined when the window did not cover the date. */
function readServerDayFlag(
  capacity: CapacitySection | null,
  resourceId: string,
  date: ISODate,
  flag: 'timeOffConflict'
): boolean | undefined {
  const days = capacity?.resources[resourceId]?.window
  if (!capacity || !days) return undefined
  return days[flag][calculateDayIndex(date, capacity.window.from)]
}

/** Visible utilisation summed from the capacity figures; dates the window did not cover are left out. */
export function resolveServerUtilisation(
  capacity: CapacitySection | null,
  resourceId: string,
  dates: ISODate[]
): number {
  return resolveUtilisationFromCapacity(
    dates.flatMap((date) => readServerDayCapacity(capacity, resourceId, date) ?? [])
  )
}

function createUntrackedCapacitySource(): CapacitySource {
  return {
    tracked: false,
    listTimeOffOn: () => NO_TIME_OFF,
    resolveCapacityOnDay: () => undefined,
    countTimeOffOn: () => 0,
    hasTimeOffConflictOn: () => false,
    resolveUtilisationOver: () => 0,
    overSoon: false,
  }
}

function createTrackedCapacitySource(
  { resource, resourceTimeOff }: ResourceCapacitySourceInput,
  { days, capacity, closuresByDate }: CapacityContext
): CapacitySource {
  const personalTimeOffByDate = bucketByCoveredDate(resourceTimeOff, days)
  const listTimeOffOn = (date: ISODate) => personalTimeOffByDate.get(date) ?? NO_TIME_OFF
  return {
    tracked: true,
    listTimeOffOn,
    resolveCapacityOnDay: (date) => readServerDayCapacity(capacity, resource.id, date),
    countTimeOffOn: (date) => listTimeOffOn(date).length + (closuresByDate.get(date)?.length ?? 0),
    hasTimeOffConflictOn: (date) =>
      readServerDayFlag(capacity, resource.id, date, 'timeOffConflict') ?? false,
    resolveUtilisationOver: (dates) => resolveServerUtilisation(capacity, resource.id, dates),
    overSoon: capacity?.resources[resource.id]?.overSoon ?? false,
  }
}

/** Reads each resource's capacity cues from the capacity figures and its dated exceptions. */
export function createCapacitySource({
  days,
  visibleWindow,
  capacity,
  closures,
}: CreateCapacitySourceInput) {
  const context = { days, capacity, closuresByDate: bucketByCoveredDate(closures, days) }
  const createResourceCapacitySource = (input: ResourceCapacitySourceInput): CapacitySource =>
    isExternalResource(input.resource)
      ? createUntrackedCapacitySource()
      : createTrackedCapacitySource(input, context)

  return {
    capacitySourceFor: createResourceCapacitySource,
    visDays: visibleWindow ? listDaysISO(visibleWindow.start, visibleWindow.end) : [],
  }
}
