import { cleanText } from "../strings";
import { parseISOTimestamp } from "../integrity";
import { normalizeCodeName, privateCodeNameFallback } from "../../domain/privateNames";
import { defaultAccountWorkingDays } from "../accountWorkingDays";
import { clampHoursPerDay, clampWorkingHoursPerDay, FULL_DAY_HOURS, type Weekday } from "../../types/entities";

export const VALID_STATUS = ["confirmed", "tentative", "completed"] as const;
export const VALID_KIND = ["person", "placeholder", "external"] as const;
export const VALID_ACTIVITY_KIND = ["project", "internal", "repeatable"] as const;
export const VALID_EMPLOYMENT = ["permanent", "freelancer", "contractor"] as const;
export const VALID_ENGAGEMENT = ["studio", "supplementary"] as const;
export const VALID_TIMEOFF = ["holiday", "sick", "unpaid", "other"] as const;

export const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === "string" && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;

// A RESOURCE's working day must be POSITIVE (a 0-hour working day has no capacity) — route
// it through the SHARED clampWorkingHoursPerDay so import and the store resource path agree
// (a finite value clamps to (0,24]; junk / <= 0 / a non-number falls back to a normal 8h day).
export const clampHours = (v: unknown): number => (typeof v === "number" ? clampWorkingHoursPerDay(v) : FULL_DAY_HOURS);

// Allocation hours/day, unlike a resource's working day, may legitimately be 0 (a
// "blocks"-mode booking persists hoursPerDay: 0 — the span counts but the load doesn't).
// Route a finite value through the SHARED clampHoursPerDay so import and the store write
// boundary can never drift (a negative clamps to 0, not the fallback); only a missing /
// non-numeric / NaN value falls back to a normal 8h day.
export const clampAllocHours = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isFinite(v) ? clampHoursPerDay(v) : fallback;

export const safeInt = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isSafeInteger(v) ? v : fallback;

// Repair a sloppily-formatted date to the canonical zero-padded "YYYY-MM-DD". The whole
// app relies on dates being zero-padded so they sort chronologically as strings (see
// isWithin), and the forms guarantee that — but a hand-edited import might carry
// "2026-6-1". Pad it so the record is KEPT (the alternative — validateDateRange dropping
// it — silently loses real data). A value that isn't a recognizable Y-M-D is left as-is
// for validateDateRange to reject. Real-calendar validity (e.g. month 13) is still its job.
export const normalizeISODate = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim());
  if (!m) return v;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
};

// DE-DUPLICATE: the scheduling math keys weekend-awareness on workingDays.length (a
// length-7 array means "works every calendar day"), so a duplicated set like
// [1,1,1,1,1,1,1] would otherwise reach length 7 and model a Monday-only resource as a
// 7-day worker. Collapse to the distinct sorted weekdays so length reflects real coverage.
// NOTE this deliberately does NOT reuse normalizeAccountWorkingDays: that one REJECTS a whole
// selection containing any junk, while a RESOURCE's week is repaired by FILTERING the junk out and
// keeping whatever real weekdays remain. Only the default they fall back to is shared.
export const safeWorkingDays = (v: unknown): Weekday[] => {
  if (!Array.isArray(v)) return defaultAccountWorkingDays();
  const days = v.filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6);
  const unique = [...new Set(days)].sort((a, b) => a - b);
  return unique.length ? unique : defaultAccountWorkingDays();
};

/** Repair half days to distinct weekdays that also occur in the resource's working week. */
export const safeHalfDays = (v: unknown, workingDays: Weekday[]): Weekday[] => {
  if (!Array.isArray(v)) return [];
  const working = new Set(workingDays);
  return [...new Set(v.filter((d): d is Weekday => Number.isInteger(d) && d >= 0 && d <= 6 && working.has(d)))].sort(
    (a, b) => a - b,
  );
};

// Strip emoji / control / zero-width junk from a free-text field in place (the forms
// reject it; import can't, so it repairs). No-op on a missing/non-string field.
export const cleanField = (rec: Record<string, unknown>, field: string, multiline = false): void => {
  if (rec[field] === undefined) return;
  if (typeof rec[field] !== "string") {
    delete rec[field];
    return;
  }
  rec[field] = cleanText(rec[field] as string, { multiline });
};

// Like cleanField, but for a REQUIRED text column (the server schema marks these NOT NULL).
// Cleaning a hand-edited value can collapse it to empty (e.g. an emoji-only name), and a
// missing value is empty too — either would survive in memory (which has no NOT NULL constraint)
// yet be REJECTED by the server, diverging the two import paths. Fall back to a placeholder
// so a required column is never empty and both paths accept the record identically.
export const cleanRequiredField = (rec: Record<string, unknown>, field: string, fallback: string): void => {
  const cleaned = typeof rec[field] === "string" ? cleanText(rec[field] as string) : "";
  rec[field] = cleaned.length > 0 ? cleaned : fallback;
};

/** Keep the two optional privacy fields coherent. Public is represented by absence; malformed
 * private imports fail closed to a neutral code name rather than exposing the real name. */
export const normalizePrivateNameFields = (rec: Record<string, unknown>): void => {
  if (rec.isPrivate !== true) {
    delete rec.isPrivate;
    delete rec.codeName;
    return;
  }
  const cleaned = typeof rec.codeName === "string" ? normalizeCodeName(cleanText(rec.codeName)) : "";
  rec.codeName = cleaned || privateCodeNameFallback(rec.id);
};

/** Normalize lifecycle tombstones through the state machine's stored invariants. Invalid values
 * become absent; deletion without prior archival, or deletion before archival, is repaired back to
 * the nearest valid non-deleted state. This prevents hidden rows whose timestamps can never satisfy
 * the purge clock. */
export const normalizeLifecycleFields = (rec: Record<string, unknown>): void => {
  const timestamp = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const text = value.trim();
    if (text === "") return null;
    const milliseconds = parseISOTimestamp(text);
    return milliseconds === null ? null : new Date(milliseconds).toISOString();
  };

  const archivedAt = timestamp(rec.archivedAt);
  const deletedAt = timestamp(rec.deletedAt);
  if (archivedAt === null) delete rec.archivedAt;
  else rec.archivedAt = archivedAt;

  if (deletedAt === null || archivedAt === null || deletedAt < archivedAt) delete rec.deletedAt;
  else rec.deletedAt = deletedAt;
};
