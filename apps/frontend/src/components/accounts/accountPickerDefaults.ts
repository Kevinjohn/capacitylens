import { m } from "@/i18n";
import { DEFAULT_TIME_ZONE } from "@/lib/timezones";

// The create-company form sets the language, week start, and time zone fields that the server
// freezes after creation. Defaults are always concrete, and Settings does not edit them. Company
// colour uses the default preset. Option labels are getters so they resolve at render time after a
// locale change rather than at module import.
/** Choices for the account calendar week start. */
export const WEEK_START_OPTIONS: { value: 0 | 1; label: () => string }[] = [
  { value: 1, label: () => m.picker_week_monday() },
  { value: 0, label: () => m.picker_week_sunday() },
];
/** Default account week start is Monday. */
export const DEFAULT_WEEK_STARTS_ON = 1 as const;
/** Default timezone for a newly created account. */
export const DEFAULT_TIMEZONE = DEFAULT_TIME_ZONE;
/** Default language for a newly created account. */
export const DEFAULT_LANGUAGE = "en";
