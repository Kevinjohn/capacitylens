/** A plain object: non-null, not an array. The one record guard for every untrusted-input check. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
