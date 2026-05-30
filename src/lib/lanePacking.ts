import { dayIndex } from './dateMath'
import type { ID, ISODate } from '../types/entities'

// Greedy first-fit interval partitioning, per resource. Produces the minimum
// number of vertical lanes needed so that overlapping allocations never share a
// lane. Ends are INCLUSIVE, so an item ending on day X overlaps one starting on
// day X — hence the strict `<` in the free-lane test.

export interface Interval {
  id: ID
  startDate: ISODate // inclusive
  endDate: ISODate // inclusive
}

export interface LaneItem {
  id: ID
  lane: number
}

export interface PackResult {
  lanes: LaneItem[]
  laneCount: number
}

export function packLanes(items: Interval[]): PackResult {
  if (items.length === 0) return { lanes: [], laneCount: 0 }

  // ISO "YYYY-MM-DD" strings sort lexicographically as dates.
  const sorted = [...items].sort((a, b) => {
    if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1
    if (a.endDate !== b.endDate) return a.endDate < b.endDate ? -1 : 1
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  // Origin = the first non-empty start (a bad/empty record sorts first but must
  // not become the origin, or it would NaN-poison every other item's day-index).
  const origin = sorted.find((it) => it.startDate)?.startDate ?? sorted[0].startDate
  const laneEnds: number[] = [] // inclusive endDay of the last item placed in each lane
  const lanes: LaneItem[] = []

  for (const it of sorted) {
    const s = dayIndex(it.startDate, origin)
    const e = dayIndex(it.endDate, origin)
    // A record with an unparseable date can't be positioned; drop it into lane 0
    // without touching laneEnds so it can't corrupt overlap detection for the row.
    if (!Number.isFinite(s) || !Number.isFinite(e)) {
      lanes.push({ id: it.id, lane: 0 })
      continue
    }
    let lane = laneEnds.findIndex((end) => end < s) // first lane free strictly before this starts
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(e)
    } else {
      laneEnds[lane] = e
    }
    lanes.push({ id: it.id, lane })
  }

  return { lanes, laneCount: laneEnds.length }
}

export interface LaneLayout {
  barHeight: number
  laneGap: number
  rowPadding: number
}

/** Pixel height of a resource row given how many lanes it needs (min 1 lane tall). */
export function rowHeightForLanes(laneCount: number, layout: LaneLayout): number {
  const lanes = Math.max(1, laneCount)
  return lanes * layout.barHeight + (lanes - 1) * layout.laneGap + layout.rowPadding * 2
}

/** Pixel top offset of a given lane within a resource row. */
export function laneTop(lane: number, layout: LaneLayout): number {
  return layout.rowPadding + lane * (layout.barHeight + layout.laneGap)
}
