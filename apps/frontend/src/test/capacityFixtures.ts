import type {
  CapacityDays,
  CapacityRange,
  CapacitySection,
} from '@capacitylens/shared/lib/capacity'
import { countDaysInclusive } from '@capacitylens/shared/lib/dateMath'

/** One date's server figures. Unset fields default to nothing allocated against eight hours. */
export interface ServerDayFigures {
  allocated?: number
  /** Defaults to `allocated`. */
  confirmedAllocated?: number
  available?: number
  over?: boolean
  timeOffConflict?: boolean
}

/** Server-shaped figures for every date of `range`: each date takes `fill`, then the dates named
 * in `byDate` take their own figures. */
export function capacityDays(
  range: CapacityRange,
  fill: ServerDayFigures = {},
  byDate: Record<string, ServerDayFigures> = {}
): CapacityDays {
  const days: CapacityDays = {
    allocated: [],
    confirmedAllocated: [],
    available: [],
    over: [],
    timeOffConflict: [],
  }
  const length = countDaysInclusive(range.from, range.to)
  for (let index = 0; index < length; index++) {
    days.allocated.push(fill.allocated ?? 0)
    days.confirmedAllocated.push(fill.confirmedAllocated ?? fill.allocated ?? 0)
    days.available.push(fill.available ?? 8)
    days.over.push(fill.over ?? false)
    days.timeOffConflict.push(fill.timeOffConflict ?? false)
  }
  for (const [date, figures] of Object.entries(byDate)) {
    const index = countDaysInclusive(range.from, date) - 1
    if (index < 0 || index >= length) throw new Error(`${date} is outside the fixture range.`)
    days.allocated[index] = figures.allocated ?? 0
    days.confirmedAllocated[index] = figures.confirmedAllocated ?? figures.allocated ?? 0
    days.available[index] = figures.available ?? 8
    days.over[index] = figures.over ?? false
    days.timeOffConflict[index] = figures.timeOffConflict ?? false
  }
  return days
}

/** A capacity section with no tracked resources, for reads whose figures a test does not draw. */
export function emptyCapacity(
  window: CapacityRange = { from: '2026-01-01', to: '2026-01-01' },
  horizon: CapacityRange = window
): CapacitySection {
  return { window, horizon, resources: {} }
}

/** One resource's figures in {@link capacityOver}. */
export interface ResourceFigures {
  overSoon?: boolean
  fill?: ServerDayFigures
  byDate?: Record<string, ServerDayFigures>
}

/** A capacity section whose window and horizon are both `range`, each resource carrying the same
 * figures in both. */
export function capacityOver(
  range: CapacityRange,
  resources: Record<string, ResourceFigures>
): CapacitySection {
  return {
    window: range,
    horizon: range,
    resources: Object.fromEntries(
      Object.entries(resources).map(([id, { overSoon = false, fill, byDate }]) => {
        const days = capacityDays(range, fill, byDate)
        return [id, { overSoon, window: days, horizon: days }]
      })
    ),
  }
}

/** The same section with each resource's other range replaced by one empty date, so a reader of
 * the wrong range finds no figures for the dates under test. */
export function onlyRange(section: CapacitySection, kept: 'window' | 'horizon'): CapacitySection {
  const other = kept === 'window' ? 'horizon' : 'window'
  const elsewhere = { from: '1999-01-01', to: '1999-01-01' }
  return {
    ...section,
    [other]: elsewhere,
    resources: Object.fromEntries(
      Object.entries(section.resources).map(([id, figures]) => [
        id,
        { ...figures, [other]: capacityDays(elsewhere) },
      ])
    ),
  }
}
