import type { AppData, Entity } from "@capacitylens/shared/types/entities";

export const stamp = () => {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
};
export const touch = () => new Date().toISOString();
const MAX_DATE_MS = 8_640_000_000_000_000;
// Take an ARRAY, not rest args: the whole-tenant callers (nextDataRevision, prepareHistoryTarget)
// pass one timestamp per row, and spreading tens of thousands of rows as function arguments can
// overflow the engine's argument limit (RangeError), failing an undo/redo or cascade-delete
// outright. Iterating an array is unbounded-safe. `touchAfter` keeps the ergonomic variadic shape
// for the many few-arg callers by delegating here.
export const advancePast = (value: string | undefined, next: number): number => {
  if (!value) return next;
  const parsed = Date.parse(value);
  // The maximum representable Date is valid ISO input but has no representable successor. Refuse
  // the write explicitly; publishing Date.now() here would silently move its revision backwards.
  if (parsed === MAX_DATE_MS) {
    throw new Error("Cannot update data whose revision has no representable successor.");
  }
  return Number.isFinite(parsed) && parsed >= next ? parsed + 1 : next;
};
export const touchAfterAll = (timestamps: Array<string | undefined>): string => {
  let next = Date.now();
  for (const value of timestamps) next = advancePast(value, next);
  return new Date(next).toISOString();
};
export const touchAfter = (...timestamps: Array<string | undefined>): string => touchAfterAll(timestamps);
// Fold a WHOLE tenant's revisions into the running maximum in ONE pass. Materialising the
// timestamps first would allocate an array per table (tens of thousands of strings on a large
// account) for a value only ever reduced to a single number.
export const advanceOverData = (data: AppData, next: number): number => {
  let result = next;
  for (const rows of Object.values(data) as Entity[][]) {
    for (const row of rows) result = advancePast(row.updatedAt, result);
  }
  return result;
};
export const nextDataRevision = (data: AppData): string => new Date(advanceOverData(data, Date.now())).toISOString();
