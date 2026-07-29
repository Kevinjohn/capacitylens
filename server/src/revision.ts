import { isIsoInstant } from "@capacitylens/shared/account/types";

const MAX_CANONICAL_REVISION_MS = Date.parse("9999-12-31T23:59:59.999Z");

/** Produce a valid shared-domain revision while repairing unincrementable legacy metadata. */
export function nextServerRevision(updatedAt: unknown, now = Date.now()): string {
  const current = Math.min(Math.max(Math.trunc(now), 0), MAX_CANONICAL_REVISION_MS);
  if (!isIsoInstant(updatedAt)) {
    return new Date(current).toISOString();
  }
  const previous = Date.parse(updatedAt);
  if (!Number.isFinite(previous) || previous >= MAX_CANONICAL_REVISION_MS) {
    return new Date(current).toISOString();
  }
  return new Date(Math.max(current, previous + 1)).toISOString();
}
