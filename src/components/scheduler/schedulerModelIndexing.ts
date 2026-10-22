import { isValidISODate } from "@capacitylens/shared/lib/integrity";
import type { Allocation, Closure, ID, ISODate, TimeOff } from "@capacitylens/shared/types/entities";

const reportedInvalidScheduleRows = new WeakSet<object>();

/** Return whether a schedule row's range can safely enter date indexing and layout paths. */
export function hasRenderableDateRange(row: { id: string; startDate: ISODate; endDate: ISODate }): boolean {
  return isValidISODate(row.startDate) && isValidISODate(row.endDate) && row.startDate <= row.endDate;
}

/** Report an omitted corrupt row once for its stable object identity. */
export function reportInvalidScheduleDateRangeOnce(row: { id: string }): void {
  if (reportedInvalidScheduleRows.has(row)) return;
  reportedInvalidScheduleRows.add(row);
  console.error(`Scheduler omitted ${row.id}: invalid date range.`);
}

/** Filter predicate that keeps renderable rows and reports each corrupt row once. */
export function includeRenderableDateRange(row: { id: string; startDate: ISODate; endDate: ISODate }): boolean {
  const renderable = hasRenderableDateRange(row);
  if (!renderable) reportInvalidScheduleDateRangeOnce(row);
  return renderable;
}

// Reused for a bucket miss so a day with no allocations / no time off doesn't allocate a throwaway
// array per resource-day (this runs days × resources times on every model rebuild).
/** Stable empty allocation list shared by rows with no allocations. */
export const NO_ALLOCATIONS: Allocation[] = [];
/** Stable empty time-off list shared by rows with no absences. */
export const NO_TIME_OFF: TimeOff[] = [];
/** Stable empty closure list shared by rows with no closures. */
export const NO_CLOSURES: Closure[] = [];

/** Index of the first entry of the sorted, de-duplicated `dates` that is >= `target`
 * (`dates.length` when every entry is earlier). Date-only ISO strings are zero-padded, so
 * lexicographic order is chronological order and a plain string compare is a valid ordering. */
export function resolveFirstDateIndexAtOrAfter(dates: ISODate[], target: ISODate): number {
  let lowerIndex = 0;
  let upperIndex = dates.length;
  while (lowerIndex < upperIndex) {
    const middleIndex = (lowerIndex + upperIndex) >> 1;
    const middleDate = dates[middleIndex];
    if (middleDate !== undefined && middleDate < target) lowerIndex = middleIndex + 1;
    else upperIndex = middleIndex;
  }
  return lowerIndex;
}

/** Indexes each row under the queried dates it covers so capacity lookup reads only overlapping rows. Preserve source insertion order because floating-point sums depend on it. */
export function bucketByCoveredDate<T extends { startDate: ISODate; endDate: ISODate }>(
  rows: T[],
  dates: ISODate[],
): Map<ISODate, T[]> {
  const byDate = new Map<ISODate, T[]>();
  for (const row of rows) {
    for (let i = resolveFirstDateIndexAtOrAfter(dates, row.startDate); i < dates.length; i++) {
      const date = dates[i];
      if (date === undefined) continue;
      if (date > row.endDate) break;
      const list = byDate.get(date);
      if (list) list.push(row);
      else byDate.set(date, [row]);
    }
  }
  return byDate;
}

/** Indexes rows by resource, preserving input order. The visit callback sees each source row before inclusion filtering, so diagnostics are not lost. */
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
