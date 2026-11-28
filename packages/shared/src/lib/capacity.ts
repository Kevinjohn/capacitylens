import { normalizeCompanyWorkingDays } from './companyWorkingDays.js'
import {
  addDaysISO,
  bucketByCoveredDate,
  getWeekday,
  hasRangeOverlap,
  listDaysISO,
  startOfWeekISO,
} from './dateMath.js'
import { resolveEffectiveWorkingWeek } from './effectiveWorkingWeek.js'
import type { EffectiveWorkingWeek } from './effectiveWorkingWeek.js'
import {
  CAPACITY_OVERVIEW_HORIZON_WEEKS,
  DEFAULT_RANGE_DAYS,
  PAST_BUFFER_DAYS,
  UTILISATION_WINDOW_DAYS,
} from './planningWindows.js'
import { isCapacityTracked } from '../types/entities.js'
import type {
  Allocation,
  AppData,
  Closure,
  Company,
  ISODate,
  Resource,
  TimeOff,
} from '../types/entities.js'
import {
  resolveAllocatedHoursForWeekday,
  resolveAllocationLoadForWeekday,
  resolveAvailableHoursForWeekday,
} from './capacity/availability.js'
import type {
  CapacityDays,
  CapacityRange,
  CapacitySection,
  ResourceCapacity,
} from './capacity/section.js'

export * from './capacity/availability.js'
export * from './capacity/advisory.js'

export * from './capacity/primitives.js'
export type * from './capacity/section.js'
import { applyCapacityMode, hasOverCapacity } from './capacity/primitives.js'

interface BuildDayCapacityInput {
  resource: Resource
  date: ISODate
  allocations: Allocation[]
  timeOff: TimeOff[]
  effectiveWeek: EffectiveWorkingWeek
  closures: Closure[]
}

interface BuildCapacityWindowInput {
  resource: Resource
  allocations: Allocation[]
  timeOff: TimeOff[]
  start: ISODate
  end: ISODate
  effectiveWeek: EffectiveWorkingWeek
  closures: Closure[]
}

/** Available and allocated capacity values for one date. */
export interface DayCapacity {
  date: ISODate
  allocated: number
  available: number
  over: boolean
}

/** Allocated and available hours for one resource-day; over means allocated exceeds capacity beyond numeric tolerance.
 * @remarks Requires finite non-negative hours, as documented in capacity/primitives.ts.
 */
export function buildDayCapacity({
  resource,
  date,
  allocations,
  timeOff,
  effectiveWeek,
  closures,
}: BuildDayCapacityInput): DayCapacity {
  // One parseISO for the whole resource-day: the availability and load halves each need the
  // weekday (twice over, for the working-week and half-day tests), and this runs per resource ×
  // per visible day on every model rebuild.
  const weekday = getWeekday(date)
  const available = resolveAvailableHoursForWeekday({
    resource,
    date,
    timeOff,
    closures,
    weekday,
    effectiveWeek,
  })
  const load = resolveAllocationLoadForWeekday({
    resource,
    date,
    allocations,
    weekday,
    effectiveWeek,
  })
  return {
    date,
    allocated: load.hours,
    available,
    over: hasOverCapacity(load.components, available),
  }
}

/** Whole-window capacity, one entry per calendar day, derived straight from the inputs.
 * The render path does not come through here: buildSchedulerModel walks the same window for every
 * resource, so it builds the day array once, buckets each resource's allocations and time off by
 * covered date (`bucketByCoveredDate`), and memoises `buildDayCapacity` per date. This stays the
 * straight-line definition those optimisations are checked against. */
export function buildCapacityWindow({
  resource,
  allocations,
  timeOff,
  start,
  end,
  effectiveWeek,
  closures,
}: BuildCapacityWindowInput): DayCapacity[] {
  return listDaysISO(start, end).map((day) =>
    buildDayCapacity({
      resource,
      date: day,
      allocations,
      timeOff,
      effectiveWeek,
      closures,
    })
  )
}

/** Reduce already-computed resource-day capacity into the visible-window utilisation ratio. */
export function resolveUtilisationFromCapacity(days: Iterable<DayCapacity>): number {
  let allocated = 0
  let available = 0
  for (const day of days) {
    // Skip days with no available capacity so neither their availability nor their booked hours enter visible utilisation.
    if (day.available === 0) continue
    allocated += day.allocated
    available += day.available
  }
  return available === 0 ? 0 : allocated / available
}

interface BuildCapacitySectionInput {
  /** The active rows of one company, as its reader receives them in the planning read. */
  data: AppData
  company: Company | undefined
  /** The company's calendar date, as the server sent it with the planning read. */
  today: ISODate
  /** The scheduler's materialised window; the default window for `today` when absent. */
  window?: CapacityRange | undefined
}

/** The window the scheduler materialises for today: four weeks before the current week, 148 days. */
function buildDefaultCapacityWindow(today: ISODate, weekStartsOn: 0 | 1): CapacityRange {
  const from = addDaysISO(startOfWeekISO(today, weekStartsOn), -PAST_BUFFER_DAYS)
  return { from, to: addDaysISO(from, PAST_BUFFER_DAYS + DEFAULT_RANGE_DAYS - 1) }
}

function groupByResource<T extends { resourceId: string }>(rows: T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>()
  for (const row of rows) {
    const list = grouped.get(row.resourceId)
    if (list) list.push(row)
    else grouped.set(row.resourceId, [row])
  }
  return grouped
}

/**
 * Per-day capacity for every capacity-tracked resource over the window and the Capacity Overview
 * horizon. The browser derives it from the planning read's rows and `today`, so moving the window
 * needs no request; computed from the rows the reader received, it reveals nothing they cannot
 * already see.
 */
export function buildCapacitySection({
  data,
  company,
  today,
  window,
}: BuildCapacitySectionInput): CapacitySection {
  const weekStartsOn = company?.weekStartsOn ?? 1
  const companyWorkingDays = normalizeCompanyWorkingDays(company?.workingDays, weekStartsOn)
  const blocksMode = company?.schedulingMode === 'blocks'
  const range = window ?? buildDefaultCapacityWindow(today, weekStartsOn)
  const horizon = {
    from: today,
    to: addDaysISO(
      startOfWeekISO(today, weekStartsOn),
      CAPACITY_OVERVIEW_HORIZON_WEEKS['12-weeks'] * 7 - 1
    ),
  }
  // The window and the horizon may overlap, so each date is computed once, in date order, and
  // each range is a slice. The overSoon days lie inside the horizon, which runs at least 11 weeks
  // past today.
  const dates = Array.from(
    new Set([...listDaysISO(range.from, range.to), ...listDaysISO(horizon.from, horizon.to)])
  ).sort()
  const buildBounds = ({ from, to }: CapacityRange) =>
    [dates.indexOf(from), dates.indexOf(to) + 1] as const
  const windowBounds = buildBounds(range)
  const horizonBounds = buildBounds(horizon)
  const overSoonBounds = buildBounds({
    from: today,
    to: addDaysISO(today, UTILISATION_WINDOW_DAYS - 1),
  })
  // Only rows that reach a computed date can count, then each is indexed under the dates it covers.
  const first = range.from < horizon.from ? range.from : horizon.from
  const last = range.to > horizon.to ? range.to : horizon.to
  const isInWindow = (row: { startDate: ISODate; endDate: ISODate }) =>
    hasRangeOverlap(row.startDate, row.endDate, first, last)
  const allocationsByResource = groupByResource(data.allocations.filter(isInWindow))
  const timeOffByResource = groupByResource(data.timeOff.filter(isInWindow))
  const closuresByDate = bucketByCoveredDate(data.closures.filter(isInWindow), dates)

  const resources: Record<string, ResourceCapacity> = {}
  for (const resource of data.resources.filter(isCapacityTracked)) {
    const allocationsByDate = bucketByCoveredDate(
      applyCapacityMode({
        allocations: allocationsByResource.get(resource.id) ?? [],
        blocksMode,
      }),
      dates
    )
    const timeOffByDate = bucketByCoveredDate(timeOffByResource.get(resource.id) ?? [], dates)
    const effectiveWeek = resolveEffectiveWorkingWeek(resource, companyWorkingDays)
    const all: CapacityDays = {
      allocated: [],
      confirmedAllocated: [],
      available: [],
      over: [],
      timeOffConflict: [],
    }
    for (const date of dates) {
      const allocations = allocationsByDate.get(date) ?? []
      const timeOff = timeOffByDate.get(date) ?? []
      const closures = closuresByDate.get(date) ?? []
      const day = buildDayCapacity({
        resource,
        date,
        allocations,
        timeOff,
        effectiveWeek,
        closures,
      })
      // Availability does not depend on status, so only the confirmed load is summed again.
      const confirmed = allocations.some((allocation) => allocation.status === 'tentative')
        ? resolveAllocatedHoursForWeekday({
            resource,
            date,
            allocations: allocations.filter((allocation) => allocation.status !== 'tentative'),
            weekday: getWeekday(date),
            effectiveWeek,
          })
        : day.allocated
      all.allocated.push(day.allocated)
      all.confirmedAllocated.push(confirmed)
      all.available.push(day.available)
      all.over.push(day.over)
      all.timeOffConflict.push(
        timeOff.length + closures.length > 0 && (blocksMode ? allocations.length > 0 : day.over)
      )
    }
    const sliceDays = ([start, end]: readonly [number, number]): CapacityDays => ({
      allocated: all.allocated.slice(start, end),
      confirmedAllocated: all.confirmedAllocated.slice(start, end),
      available: all.available.slice(start, end),
      over: all.over.slice(start, end),
      timeOffConflict: all.timeOffConflict.slice(start, end),
    })
    resources[resource.id] = {
      overSoon: all.over.slice(...overSoonBounds).some(Boolean),
      window: sliceDays(windowBounds),
      horizon: sliceDays(horizonBounds),
    }
  }
  return { window: range, horizon, resources }
}
