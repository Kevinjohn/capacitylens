import { m } from "@/i18n";

/** The account default, and the only zone with bespoke display copy (see resolveTimeZoneOptionLabel). */
export const DEFAULT_TIME_ZONE = "Etc/GMT";

/** Common choices stay near the detected local zone in onboarding. */
export const LIKELY_TIME_ZONES = [
  DEFAULT_TIME_ZONE,
  "UTC",
  "Europe/London",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Tokyo",
] as const;

// The engine's zone list is fixed for the lifetime of the page, so it is built once on first use
// and reused. `undefined` means "not built yet" — a lazy `let` rather than a module-scope call
// because the fallback path below constructs a list we would rather not pay for at import.
let cachedZones: readonly string[] | undefined;

const warnedRuntimeFallbacks = new Set<string>();
const MAX_RUNTIME_FALLBACK_WARNINGS = 8;

function warnRuntimeFallback(message: string, error?: unknown): void {
  if (warnedRuntimeFallbacks.has(message) || warnedRuntimeFallbacks.size >= MAX_RUNTIME_FALLBACK_WARNINGS) return;
  warnedRuntimeFallbacks.add(message);
  if (error === undefined) {
    console.warn(message);
  } else {
    console.warn(message, error);
  }
}

/**
 * The IANA time-zone list offered wherever an account's `timezone` is chosen — the
 * create-company form (AccountPicker) and Settings. Extracted so both share one source.
 *
 * Prefers the engine's full `Intl.supportedValuesOf('timeZone')`, ensuring the app's default
 * `Etc/GMT` and the useful `UTC` alias are present; falls back to a small hand-list on older
 * engines that lack the API. Rendered through {@link resolveTimeZoneOptionLabel}, which owns the
 * display copy.
 *
 * The returned array is FROZEN and shared between callers — read it, do not sort or splice it.
 */
export function listSupportedTimeZones(): readonly string[] {
  cachedZones ??= Object.freeze(buildSupportedTimeZones());
  return cachedZones;
}

/** Return the browser's validated IANA zone, or the stable app default when unavailable. */
export function resolveBrowserTimeZone(supportedZones = listSupportedTimeZones()): string {
  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof timeZone === "string" && supportedZones.includes(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  } catch (error) {
    warnRuntimeFallback("timezones: browser zone detection failed; using Etc/GMT", error);
    return DEFAULT_TIME_ZONE;
  }
}

function buildSupportedTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf("timeZone");
    const aliases = [DEFAULT_TIME_ZONE, "UTC"].filter((zone) => !zones.includes(zone));
    return aliases.length > 0 ? [...aliases, ...zones] : zones;
  } catch (error) {
    // Fallback for older engines
    warnRuntimeFallback("timezones: supported zone list unavailable; using hand-list", error);
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
const offsetFormattersByTimeZone = new Map<string, Intl.DateTimeFormat>();
const abbreviationFormattersByTimeZone = new Map<string, Intl.DateTimeFormat>();

function resolveOffsetFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = offsetFormattersByTimeZone.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
  offsetFormattersByTimeZone.set(timeZone, formatter);
  return formatter;
}

function resolveAbbreviationFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = abbreviationFormattersByTimeZone.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, timeZoneName: "short" });
  abbreviationFormattersByTimeZone.set(timeZone, formatter);
  return formatter;
}

/** Return the current short time-zone name, such as GMT or BST for Europe/London. */
export function resolveTimeZoneAbbreviation(timeZone: string, date = new Date()): string {
  try {
    return (
      resolveAbbreviationFormatter(timeZone)
        .formatToParts(date)
        .find((part) => part.type === "timeZoneName")?.value ?? "UTC"
    );
  } catch {
    // Do not include the zone or caught error: persisted values may be private and Intl errors can
    // echo them. The bounded static breadcrumb still makes the runtime fallback diagnosable.
    warnRuntimeFallback("timezones: abbreviation formatting failed; using UTC");
    return "UTC";
  }
}

/** Turn an IANA identifier into a compact name people can scan while retaining the identifier. */
export function resolveTimeZoneDisplayName(timeZone: string): string {
  if (timeZone === DEFAULT_TIME_ZONE) return m.settings_timezone_gmt();
  if (timeZone === "UTC") return "UTC";
  const segment = timeZone.split("/").at(-1);
  return (segment ?? timeZone).replaceAll("_", " ");
}

/** Return the current UTC offset for an IANA zone in a compact, unambiguous form. */
export function resolveTimeZoneOffsetLabel(timeZone: string, date = new Date()): string {
  try {
    const value = resolveOffsetFormatter(timeZone)
      .formatToParts(date)
      .find((part) => part.type === "timeZoneName")?.value;

    if (!value || value === "GMT" || value === "UTC") return "UTC+00:00";
    const match = value.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/);
    if (!match) return value.replace(/^GMT/, "UTC");
    const [, sign, hours, minutes = "00"] = match;
    if (!sign || !hours) return value.replace(/^GMT/, "UTC");
    return `UTC${sign}${hours.padStart(2, "0")}:${minutes}`;
  } catch {
    // The zone list itself is validated by listSupportedTimeZones(); this is only a defensive
    // fallback for an older Intl implementation or an unexpected persisted value.
    // Do not include the zone or caught error: persisted values may be private and Intl errors can
    // echo them. The bounded static breadcrumb still makes the runtime fallback diagnosable.
    warnRuntimeFallback("timezones: offset formatting failed; using UTC+00:00");
    return "UTC+00:00";
  }
}

/** Render an option label with both the zone's display name and its current numeric offset.
 *  'Etc/GMT' — the app default — reads as the localised "GMT" rather than its IANA identifier,
 *  which is the one piece of display copy this list needs; every other zone shows its identifier.
 *  Resolved at CALL time (never at module scope) so the label follows the active locale. */
export function resolveTimeZoneOptionLabel(
  timeZone: string,
  displayName = resolveTimeZoneDisplayName(timeZone),
  date = new Date(),
): string {
  const identifier = displayName === timeZone || timeZone === DEFAULT_TIME_ZONE ? "" : ` — ${timeZone}`;
  const abbreviation = resolveTimeZoneAbbreviation(timeZone, date);
  const details =
    timeZone === DEFAULT_TIME_ZONE
      ? resolveTimeZoneOffsetLabel(timeZone, date)
      : `${abbreviation}, ${resolveTimeZoneOffsetLabel(timeZone, date)}`;
  return `${displayName}${identifier} (${details})`;
}
