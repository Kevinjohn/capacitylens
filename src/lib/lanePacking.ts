import { differenceInCalendarDays, parseISO } from "date-fns";
import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import type { ID, ISODate } from "@capacitylens/shared/types/entities";

// Greedy first-fit interval partitioning, per resource. Produces the minimum
// number of vertical lanes needed so that overlapping allocations never share a
// lane. Ends are inclusive, so an item ending on day X overlaps one starting on
// day X, hence the strict `<` in the free-lane test.

/** Date interval and stable identifier supplied to the lane packer. */
export interface Interval {
  id: ID;
  /** Inclusive calendar start. */
  startDate: ISODate;
  /** Inclusive calendar end. */
  endDate: ISODate;
}

/** Packed interval with its assigned lane index. */
export interface LaneItem {
  id: ID;
  lane: number;
}

/** Packed lane assignments and the number of lanes required. */
export interface PackResult {
  lanes: LaneItem[];
  laneCount: number;
}

function compareIntervals(a: Interval, b: Interval): number {
  if (a.startDate !== b.startDate) return a.startDate < b.startDate ? -1 : 1;
  if (a.endDate !== b.endDate) return a.endDate < b.endDate ? -1 : 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** Assigns overlapping date intervals to separate lanes. */
export function packLanes(items: Interval[]): PackResult {
  if (items.length === 0) return { lanes: [], laneCount: 0 };

  // ISO "YYYY-MM-DD" strings sort lexicographically as dates.
  const sorted = [...items].sort(compareIntervals);

  // Use a valid start when available so one malformed date cannot invalidate every interval offset.
  const origin = sorted.find((interval) => isValidISODate(interval.startDate))?.startDate ?? sorted[0]?.startDate;
  if (origin === undefined) return { lanes: [], laneCount: 0 };
  // Parse the shared origin once. An unparseable origin makes offsets non-finite, so records use lane 0.
  const originDate = parseISO(origin);
  // Inclusive end day of the last valid interval placed in each lane.
  const laneEnds: number[] = [];
  const lanes: LaneItem[] = [];

  for (const interval of sorted) {
    const startIndex = differenceInCalendarDays(parseISO(interval.startDate), originDate);
    const endIndex = differenceInCalendarDays(parseISO(interval.endDate), originDate);
    // A record with an unparseable date can't be positioned; drop it into lane 0
    // without touching laneEnds so it can't corrupt overlap detection for the row.
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) {
      lanes.push({ id: interval.id, lane: 0 });
      continue;
    }
    let lane = laneEnds.findIndex((end) => end < startIndex);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endIndex);
    } else {
      laneEnds[lane] = endIndex;
    }
    lanes.push({ id: interval.id, lane });
  }

  return { lanes, laneCount: laneEnds.length };
}

/** Pixel geometry for rows and bars in a packed lane group. */
export interface LaneLayout {
  barHeight: number;
  laneGap: number;
  rowPadding: number;
}

/** Pixel height of a resource row given how many lanes it needs (min 1 lane tall). */
export function resolveRowHeightForLanes(laneCount: number, layout: LaneLayout): number {
  const lanes = Math.max(1, laneCount);
  return lanes * layout.barHeight + (lanes - 1) * layout.laneGap + layout.rowPadding * 2;
}

/** Pixel top offset of a given lane within a resource row. */
export function resolveLaneTop(lane: number, layout: LaneLayout): number {
  return layout.rowPadding + lane * (layout.barHeight + layout.laneGap);
}
