import type { ISODate } from '../../types/entities.js'

/** An inclusive date range. */
export interface CapacityRange {
  from: ISODate
  to: ISODate
}

/** One resource's figures over a range, one entry per date from `from` to `to`. */
export interface CapacityDays {
  allocated: number[]
  /** Allocated hours with tentative allocations left out. */
  confirmedAllocated: number[]
  available: number[]
  over: boolean[]
  /** Time off or a company closure on a day that is over capacity or, in Blocks mode, carries any
   * allocation. */
  timeOffConflict: boolean[]
}

/** One capacity-tracked resource's figures. */
export interface ResourceCapacity {
  /** Whether a day from today to today + 13 is over capacity. */
  overSoon: boolean
  window: CapacityDays
  horizon: CapacityDays
}

/** Per-day capacity for every capacity-tracked resource, built by `buildCapacitySection` from the
 * planning read's rows. */
export interface CapacitySection {
  /** The scheduler's materialised window. */
  window: CapacityRange
  /** Today to the end of the Capacity Overview's 12-week horizon. */
  horizon: CapacityRange
  /** Keyed by resource id; external parties have no entry. */
  resources: Record<string, ResourceCapacity>
}
