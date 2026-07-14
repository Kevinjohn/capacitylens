/**
 * The IANA time-zone list offered wherever an account's `timezone` is chosen — the
 * create-company form (AccountPicker) and Settings. Extracted so both share one source.
 *
 * Prefers the engine's full `Intl.supportedValuesOf('timeZone')`, ensuring 'Etc/GMT'
 * (the app's default) is present; falls back to a small hand-list on older engines that
 * lack the API. The display label for 'Etc/GMT' is "GMT" at the call sites.
 */
export function supportedTimeZones(): string[] {
  try {
    const zones = Intl.supportedValuesOf('timeZone') as string[]
    if (!zones.includes('Etc/GMT')) return ['Etc/GMT', ...zones]
    return zones
  } catch {
    // Fallback for older engines
    return ['Etc/GMT', 'UTC', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']
  }
}
