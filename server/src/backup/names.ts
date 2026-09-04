// The optional `-mmm` millisecond group keeps pre-v0.15 second-precision snapshots inside the
// retention window (they'd otherwise pile up forever); mixed-format names still sort
// chronologically except within a single second, which retention doesn't care about.
export const SNAPSHOT_RE = /^capacitylens-(?:utc-)?\d{8}-\d{6}(-\d{3})?\.db$/;
export const UTC_SNAPSHOT_RE = /^capacitylens-utc-\d{8}-\d{6}(-\d{3})?\.db$/;

// In-progress writes go to `<snapshot>.tmp` and are renamed on success, so a crash mid-write
// can never leave a torn file behind a valid snapshot name. Deliberately does NOT match
// SNAPSHOT_RE (no `.db$`), so prune() and the stamp seeding both ignore temp files.
export const TMP_RE =
  /^(?:capacitylens-(?:utc-)?\d{8}-\d{6}(?:-\d{3})?\.db|capacitylens-pre-migration-v\d+-to-v\d+\.db)\.tmp$/;
export function stampName(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}`;
  const time = `${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  const ms = String(now.getUTCMilliseconds()).padStart(3, "0");
  return `capacitylens-utc-${date}-${time}-${ms}.db`;
}
/** Parse a snapshot filename back to an epoch floor. New names are unambiguous UTC; legacy local
 * names retain their historical interpretation for the collision-seeding fallback. */
export function stampMs(name: string): number {
  const m = /^capacitylens-(utc-)?(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})(?:-(\d{3}))?\.db$/.exec(name);
  if (!m) return 0;
  const parts = [+m[2], +m[3] - 1, +m[4], +m[5], +m[6], +m[7], m[8] ? +m[8] : 0] as const;
  return m[1] ? Date.UTC(...parts) : new Date(...parts).getTime();
}
