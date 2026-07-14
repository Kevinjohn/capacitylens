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

/** Return the current UTC offset for an IANA zone in a compact, unambiguous form. */
export function timeZoneOffsetLabel(timeZone: string, date = new Date()): string {
  try {
    const value = new Intl.DateTimeFormat('en-US', {
      timeZone,
      timeZoneName: 'longOffset',
    })
      .formatToParts(date)
      .find((part) => part.type === 'timeZoneName')?.value

    if (!value || value === 'GMT' || value === 'UTC') return 'UTC+00:00'

    const match = value.match(/^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/)
    if (!match) return value.replace(/^GMT/, 'UTC')

    const [, sign, hours, minutes = '00'] = match
    return `UTC${sign}${hours.padStart(2, '0')}:${minutes}`
  } catch {
    // The zone list itself is validated by supportedTimeZones(); this is only a defensive
    // fallback for an older Intl implementation or an unexpected persisted value.
    return 'UTC+00:00'
  }
}

/** Render an option label with both the IANA identifier and its current numeric offset. */
export function timeZoneOptionLabel(timeZone: string, displayName = timeZone, date = new Date()): string {
  return `${displayName} (${timeZoneOffsetLabel(timeZone, date)})`
}
