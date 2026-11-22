import type { Closure, ID, TimeOff } from '@capacitylens/shared/types/entities';

// Reused for a bucket miss so a day with no time off doesn't allocate a throwaway array per
// resource-day (this runs days × resources times on every model rebuild).
/** Stable empty time-off list shared by rows with no time off. */
export const NO_TIME_OFF: TimeOff[] = [];
/** Stable empty closure list shared by rows with no closures. */
export const NO_CLOSURES: Closure[] = [];

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
