import { parseISOTimestamp } from "@capacitylens/shared/lib/integrity";

const MAX_CANONICAL_REVISION_MS = Date.parse("9999-12-31T23:59:59.999Z");

/** Produce a valid shared-domain revision while repairing unincrementable legacy metadata. */
export function nextServerRevision(updatedAt: unknown, now = Date.now()): string {
  const current = Math.min(Math.max(Math.trunc(now), 0), MAX_CANONICAL_REVISION_MS);
  const previous = parseISOTimestamp(updatedAt);
  if (previous === null) {
    return new Date(current).toISOString();
  }
  if (previous >= MAX_CANONICAL_REVISION_MS) {
    return new Date(current).toISOString();
  }
  return new Date(Math.max(current, previous + 1)).toISOString();
}
