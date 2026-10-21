import type { AppData, Entity } from "@capacitylens/shared/types/entities";

/** Create matching creation and update timestamps from the current clock. */
export const stamp = () => {
  const now = new Date().toISOString();
  return { createdAt: now, updatedAt: now };
};
/** Return the current ISO timestamp for entity updates. */
export const touch = () => new Date().toISOString();
const MAX_DATE_MS = 8_640_000_000_000_000;
/**
 * Advance a millisecond timestamp beyond a persisted ISO timestamp.
 *
 * @param next - Candidate timestamp in milliseconds since the Unix epoch.
 * @throws When the persisted value is the maximum representable date.
 */
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
// Whole-account callers pass one timestamp per row; keeping them in an array avoids spreading a
// large account into function arguments. Small callers can use the variadic touchAfter wrapper.
/**
 * Return an ISO timestamp later than every supplied timestamp.
 *
 * @throws When any supplied timestamp has no representable successor.
 */
export const touchAfterAll = (timestamps: Array<string | undefined>): string => {
  let next = Date.now();
  for (const value of timestamps) next = advancePast(value, next);
  return new Date(next).toISOString();
};
/**
 * Return an ISO timestamp later than the supplied entity timestamps.
 *
 * @throws When any supplied timestamp has no representable successor.
 */
export const touchAfter = (...timestamps: Array<string | undefined>): string => touchAfterAll(timestamps);
// Reduce each account table directly so reading a tenant revision does not allocate an intermediate
// array of every row's timestamp.
/**
 * Return a millisecond timestamp later than every entity update timestamp.
 *
 * @param next - Candidate timestamp in milliseconds since the Unix epoch.
 * @throws When an entity timestamp has no representable successor.
 */
export const advanceOverData = (data: AppData, next: number): number => {
  let result = next;
  for (const rows of Object.values(data) as Entity[][]) {
    for (const row of rows) result = advancePast(row.updatedAt, result);
  }
  return result;
};
/**
 * Return the next ISO data timestamp for persistence metadata.
 *
 * @throws When an entity timestamp has no representable successor.
 */
export const readNextDataRevision = (data: AppData): string =>
  new Date(advanceOverData(data, Date.now())).toISOString();
