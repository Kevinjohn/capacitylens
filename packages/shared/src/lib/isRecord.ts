/** True for a non-null, non-array object: the shape of a decoded JSON object before its fields are checked. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
