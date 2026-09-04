import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import type { Allocation, Closure, ID, ISODate, TimeOff } from "@capacitylens/shared/types/entities";

const reportedInvalidScheduleRows = new WeakSet<object>();

/** Fail visibly but once for a stable row object, then keep corrupt dates out of every scheduler path. */
export function hasRenderableDateRange(row: { id: string; startDate: ISODate; endDate: ISODate }): boolean {
  const valid = isValidISODate(row.startDate) && isValidISODate(row.endDate) && row.startDate <= row.endDate;
  if (!valid && !reportedInvalidScheduleRows.has(row)) {
    reportedInvalidScheduleRows.add(row);
    console.error(`Scheduler omitted ${row.id}: invalid date range.`);
  }
  return valid;
}

// Reused for a bucket miss so a day with no allocations / no time off doesn't allocate a throwaway
// array per resource-day (this runs days × resources times on every model rebuild).
export const NO_ALLOCATIONS: Allocation[] = [];
export const NO_TIME_OFF: TimeOff[] = [];
export const NO_CLOSURES: Closure[] = [];

/** Index of the first entry of the sorted, de-duplicated `dates` that is >= `target`
 *  (`dates.length` when every entry is earlier). Date-only ISO strings are zero-padded, so
 *  lexicographic order IS chronological order and a plain string compare is a valid ordering. */
export function firstDateAtOrAfter(dates: ISODate[], target: ISODate): number {
  let lo = 0;
  let hi = dates.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Bucket date-ranged rows (allocations, time off) onto the dates the model will actually ask about:
 *  each row is listed under every queried date its [startDate, endDate] covers. A per-day capacity
 *  lookup then passes only the handful of rows that touch that day instead of rescanning the
 *  resource's whole list, making the day loop O(dates + coverage) rather than O(dates × rows) — the
 *  same trick `capacityAdvisory` documents in capacity.ts. Insertion order inside each bucket follows
 *  `rows`, so the hours capacity.ts sums are added in the SAME order as a full scan and the result is
 *  bit-for-bit identical (float addition is not associative). */
export function bucketByCoveredDate<T extends { startDate: ISODate; endDate: ISODate }>(
  rows: T[],
  dates: ISODate[],
): Map<ISODate, T[]> {
  const byDate = new Map<ISODate, T[]>();
  for (const row of rows) {
    for (let i = firstDateAtOrAfter(dates, row.startDate); i < dates.length; i++) {
      const date = dates[i]!;
      if (date > row.endDate) break;
      const list = byDate.get(date);
      if (list) list.push(row);
      else byDate.set(date, [row]);
    }
  }
  return byDate;
}

/** Index rows (allocations, time off) by the resource they belong to, so building a row is a Map
 *  lookup instead of a full-array scan per resource. `include` avoids an intermediate filtered
 *  array, while `visit` observes every source row before filtering. Insertion order inside each
 *  bucket follows `rows`, which the capacity sums below depend on (float addition is not
 *  associative). */
export function groupByResourceId<T extends { resourceId: ID }>(
  rows: T[],
  options: {
    include?: (row: T) => boolean;
    visit?: (row: T) => void;
  } = {},
): Map<ID, T[]> {
  const byResource = new Map<ID, T[]>();
  for (const row of rows) {
    options.visit?.(row);
    if (options.include && !options.include(row)) continue;
    const list = byResource.get(row.resourceId);
    if (list) list.push(row);
    else byResource.set(row.resourceId, [row]);
  }
  return byResource;
}
