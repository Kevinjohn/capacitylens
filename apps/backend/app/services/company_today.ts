import { resolveCalendarToday } from '@capacitylens/shared/lib/calendarToday'
import { assertFourDigitISODate } from '@capacitylens/shared/lib/dateMath'
import type { ISODate } from '@capacitylens/shared/types/entities'

/** The zone a company without a stored time zone uses, as in its initial defaults. */
const DEFAULT_TIME_ZONE = 'Etc/GMT'

/**
 * The company's current calendar date in its own time zone at `now`. `fixedToday`, the configured
 * `CAPACITYLENS_FIXED_TODAY`, replaces the clock for the browser tests, which freeze the browser on
 * the same day.
 *
 * @throws `Error` when the stored time zone is not a valid zone. Writes validate it, so this is a
 * data fault to surface rather than replace with another date.
 */
export function readCompanyToday(
  timezone: string | null,
  fixedToday: string | undefined,
  now: number
): ISODate {
  if (fixedToday) return assertFourDigitISODate(fixedToday)
  const today = resolveCalendarToday(timezone ?? DEFAULT_TIME_ZONE, now)
  if (today.kind === 'invalid-time-zone') {
    throw new Error('The company time zone is invalid.', { cause: today.cause })
  }
  return today.date
}
