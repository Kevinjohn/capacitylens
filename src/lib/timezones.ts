import { m } from "@/i18n";

/** The account default, and the only zone with bespoke display copy (see timeZoneOptionLabel). */
export const DEFAULT_TIME_ZONE = "Etc/GMT";

// The engine's zone list is fixed for the lifetime of the page, so it is built once on first use
// and reused. `undefined` means "not built yet" — a lazy `let` rather than a module-scope call
// because the fallback path below constructs a list we would rather not pay for at import.
let cachedZones: readonly string[] | undefined;

/**
 * The IANA time-zone list offered wherever an account's `timezone` is chosen — the
 * create-company form (AccountPicker) and Settings. Extracted so both share one source.
 *
 * Prefers the engine's full `Intl.supportedValuesOf('timeZone')`, ensuring 'Etc/GMT'
 * (the app's default) is present; falls back to a small hand-list on older engines that
 * lack the API. Rendered through {@link timeZoneOptionLabel}, which owns the display copy.
 *
 * The returned array is FROZEN and shared between callers — read it, do not sort or splice it.
 */
export function supportedTimeZones(): readonly string[] {
  cachedZones ??= Object.freeze(buildSupportedTimeZones());
  return cachedZones;
}

function buildSupportedTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone") as string[];
    if (!zones.includes(DEFAULT_TIME_ZONE)) return [DEFAULT_TIME_ZONE, ...zones];
    return zones;
  } catch {
    // Fallback for older engines
    return [
      DEFAULT_TIME_ZONE,
      "UTC",
      "Europe/London",
      "Europe/Paris",
      "America/New_York",
      "America/Los_Angeles",
      "Asia/Tokyo",
      "Australia/Sydney",
    ];
  }
}

// One Intl.DateTimeFormat per zone: constructing a formatter is the expensive part (the offset
// lookup itself is cheap), and a formatter stays valid for every instant, so this cache never
// goes stale. Deliberately NOT caching the resulting label — a zone's offset changes with the
// date, and a time-based cache has to reason about transitions that can land mid-hour (Lord
// Howe's half-hour DST step) for a saving the formatter cache already delivers.
const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

function offsetFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = offsetFormatters.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
  offsetFormatters.set(timeZone, formatter);
  return formatter;
}

/** Return the current UTC offset for an IANA zone in a compact, unambiguous form. */
export function timeZoneOffsetLabel(timeZone: string, date = new Date()): string {
  try {
    const value = offsetFormatter(timeZone)
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;

    if (!value || value === "GMT" || value === "UTC") return "UTC+00:00";
    const match = value.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return value.replace(/^GMT/, "UTC");
    const [, sign, hours, minutes = "00"] = match;
    return `UTC${sign}${hours.padStart(2, "0")}:${minutes}`;
  } catch {
    // The zone list itself is validated by supportedTimeZones(); this is only a defensive
    // fallback for an older Intl implementation or an unexpected persisted value.
    return "UTC+00:00";
  }
}

/** Render an option label with both the zone's display name and its current numeric offset.
 *  'Etc/GMT' — the app default — reads as the localised "GMT" rather than its IANA identifier,
 *  which is the one piece of display copy this list needs; every other zone shows its identifier.
 *  Resolved at CALL time (never at module scope) so the label follows the active locale. */
export function timeZoneOptionLabel(
  timeZone: string,
  displayName = timeZone === DEFAULT_TIME_ZONE ? m.settings_timezone_gmt() : timeZone,
  date = new Date(),
): string {
  return `${displayName} (${timeZoneOffsetLabel(timeZone, date)})`;
}
