const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/;

/** Parse the route's narrow UTC-instant format without accepting Date.parse calendar rollover. */
export function parseStrictIsoInstant(value: string): number | null {
  const match = ISO_INSTANT_RE.exec(value);
  if (!match) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;

  const [, year, month, day, hour, minute, second, fraction] = match;
  const instant = new Date(parsed);
  const milliseconds = Number((fraction ?? "").padEnd(3, "0") || "0");
  if (
    instant.getUTCFullYear() !== Number(year) ||
    instant.getUTCMonth() + 1 !== Number(month) ||
    instant.getUTCDate() !== Number(day) ||
    instant.getUTCHours() !== Number(hour) ||
    instant.getUTCMinutes() !== Number(minute) ||
    instant.getUTCSeconds() !== Number(second) ||
    instant.getUTCMilliseconds() !== milliseconds
  )
    return null;
  return parsed;
}
