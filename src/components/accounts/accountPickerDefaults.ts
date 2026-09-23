import { m } from "@/i18n";
import { DEFAULT_TIME_ZONE } from "../../lib/timezones";

// The create-company form sets the language, week start, and time zone fields that the server
// freezes after creation. Defaults are always concrete, and Settings does not edit them. Company
// colour uses the default preset. Option labels are getters so they resolve at render time after a
// locale change rather than at module import.
export const WEEK_START_OPTIONS: { value: 0 | 1; label: () => string }[] = [
  { value: 1, label: () => m.picker_week_monday() },
  { value: 0, label: () => m.picker_week_sunday() },
];
export const DEFAULT_WEEK_STARTS_ON = 1 as const;
export const DEFAULT_TIMEZONE = DEFAULT_TIME_ZONE;
export const DEFAULT_LANGUAGE = "en";

/** Validate the UNTRUSTED 2xx body of POST /api/orgs — same stance as useAccountSummaries'
 *  `toSummary` (the server is external input; never trust an `as` cast). Returns null when the
 *  body is unusable (not an object, or id/name missing/empty) — the caller must then treat the
 *  create as "succeeded, but id unknown", NOT as a failure (see createOrgOnServer). */
export function parseCreatedAccount(body: unknown): { id: string; name: string } | null {
  if (typeof body !== "object" || body === null) return null;
  const bodyRecord = body as { id?: unknown; name?: unknown };
  if (typeof bodyRecord.id !== "string" || bodyRecord.id.trim().length === 0) return null;
  if (typeof bodyRecord.name !== "string" || bodyRecord.name.trim().length === 0) return null;
  return { id: bodyRecord.id, name: bodyRecord.name };
}
