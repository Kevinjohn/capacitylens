/**
 * An instant as local date and time: "14/07/2026, 13:00:00" (browser-default locale).
 *
 * The hour is load-bearing, not decoration. These are short-lived security artefacts (a
 * password-reset link that lives 24h, a session with an expiry) where a date-only string both
 * misleads by up to a day in a non-UTC zone and hides the hour the thing dies. Use this whenever the
 * reader may need to act before the deadline today.
 *
 * @param instant - an ISO 8601 instant or numeric epoch milliseconds.
 * @returns the instant on the viewer's wall clock, date + time.
 */
export function formatInstant(instant: string | number): string {
  return new Date(instant).toLocaleString();
}

/** Formats a server instant as a date on the viewer’s local calendar using the browser locale. */
export function formatInstantDate(instant: string): string {
  return new Date(instant).toLocaleDateString();
}
