// Accept second-precision names so retention still includes existing snapshots.
// UTC names use their timestamp; legacy local names use publication mtime to handle repeated local hours.
/** Matches published snapshot filenames accepted by retention and collision checks. */
export const SNAPSHOT_RE = /^capacitylens-(?:utc-)?\d{8}-\d{6}(-\d{3})?\.db$/
/** Matches snapshot filenames whose embedded timestamps are UTC. */
export const UTC_SNAPSHOT_RE = /^capacitylens-utc-\d{8}-\d{6}(-\d{3})?\.db$/

/**
 * Builds the UTC-stamped filename used to publish a database snapshot.
 */
export function buildSnapshotName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  const date = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`
  const time = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`
  const ms = String(now.getUTCMilliseconds()).padStart(3, '0')
  return `capacitylens-utc-${date}-${time}-${ms}.db`
}
/** Parse a snapshot filename back to an epoch floor. New names are unambiguous UTC; legacy local
 * names retain their historical interpretation for the collision-seeding fallback. */
export function parseSnapshotTimestamp(name: string): number {
  const m =
    /^capacitylens-(utc-)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d{3}))?\.db$/.exec(name)
  if (!m) return 0
  const [, utcMarker, year, month, day, hour, minute, second, milliseconds] = m
  if (!year || !month || !day || !hour || !minute || !second) return 0
  const parts = [
    +year,
    +month - 1,
    +day,
    +hour,
    +minute,
    +second,
    milliseconds ? +milliseconds : 0,
  ] as const
  return utcMarker ? Date.UTC(...parts) : new Date(...parts).getTime()
}
