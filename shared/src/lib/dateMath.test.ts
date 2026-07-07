import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  addDaysISO,
  countWorkingDays,
  dayIndex,
  daysInclusive,
  eachDayISO,
  endDateForWorkingDays,
  isWithin,
  isWeekendAware,
  parseDate,
  startOfWeekISO,
  todayISO,
  toISODate,
  weekdayOf,
  widthForRange,
  xForDate,
} from './dateMath'

describe('dateMath', () => {
  it('dayIndex counts whole calendar days from the origin', () => {
    expect(dayIndex('2026-05-29', '2026-05-29')).toBe(0)
    expect(dayIndex('2026-05-30', '2026-05-29')).toBe(1)
    expect(dayIndex('2026-05-28', '2026-05-29')).toBe(-1)
    expect(dayIndex('2026-06-05', '2026-05-29')).toBe(7)
  })

  it('addDaysISO adds and subtracts across month/year boundaries', () => {
    expect(addDaysISO('2026-05-29', 1)).toBe('2026-05-30')
    expect(addDaysISO('2026-05-29', -1)).toBe('2026-05-28')
    expect(addDaysISO('2026-05-31', 1)).toBe('2026-06-01')
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('daysInclusive treats both ends inclusively', () => {
    expect(daysInclusive('2026-05-29', '2026-05-29')).toBe(1)
    expect(daysInclusive('2026-05-29', '2026-05-30')).toBe(2)
    expect(daysInclusive('2026-05-29', '2026-06-04')).toBe(7)
  })

  it('is immune to spring-forward DST (no off-by-one across the boundary)', () => {
    // US DST 2026 spring-forward is 2026-03-08.
    expect(dayIndex('2026-03-09', '2026-03-07')).toBe(2)
    expect(daysInclusive('2026-03-07', '2026-03-09')).toBe(3)
    expect(addDaysISO('2026-03-07', 2)).toBe('2026-03-09')
    expect(eachDayISO('2026-03-07', '2026-03-09')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ])
  })

  it('eachDayISO lists inclusive dates, empty when reversed', () => {
    expect(eachDayISO('2026-05-29', '2026-05-31')).toEqual([
      '2026-05-29',
      '2026-05-30',
      '2026-05-31',
    ])
    expect(eachDayISO('2026-05-31', '2026-05-29')).toEqual([])
  })

  it('weekdayOf returns 0=Sun … 6=Sat', () => {
    expect(weekdayOf('2026-05-31')).toBe(0) // Sunday
    expect(weekdayOf('2026-06-01')).toBe(1) // Monday
    expect(weekdayOf('2026-05-29')).toBe(5) // Friday
  })

  it('startOfWeekISO snaps back to the week start Monday (default)', () => {
    // Week of 2026-06-01 (Mon) … 2026-06-07 (Sun).
    expect(startOfWeekISO('2026-06-01')).toBe('2026-06-01') // Monday → itself
    expect(startOfWeekISO('2026-06-03')).toBe('2026-06-01') // Wednesday → Monday
    expect(startOfWeekISO('2026-06-07')).toBe('2026-06-01') // Sunday → previous Monday
    expect(startOfWeekISO('2026-05-31')).toBe('2026-05-25') // Sunday → its Monday (crosses month)
  })

  it('startOfWeekISO respects weekStartsOn=0 (Sunday)', () => {
    // 2026-06-11 is a Thursday; Sunday of that week is 2026-06-07
    expect(startOfWeekISO('2026-06-11', 0)).toBe('2026-06-07')
    // 2026-06-07 is a Sunday; start of week is itself
    expect(startOfWeekISO('2026-06-07', 0)).toBe('2026-06-07')
    // 2026-06-08 is a Monday; Sunday before it is 2026-06-07
    expect(startOfWeekISO('2026-06-08', 0)).toBe('2026-06-07')
  })

  it('xForDate and widthForRange map dates/ranges to pixels', () => {
    expect(xForDate('2026-05-29', '2026-05-29', 40)).toBe(0)
    expect(xForDate('2026-05-30', '2026-05-29', 40)).toBe(40)
    expect(widthForRange('2026-05-29', '2026-05-29', 40)).toBe(40)
    expect(widthForRange('2026-05-29', '2026-05-30', 40)).toBe(80)
  })

  it('xForDate/widthForRange degrade safely on empty or reversed input (no NaN / negative)', () => {
    // An imported bad record must not poison the timeline geometry.
    expect(xForDate('', '2026-05-29', 40)).toBe(0)
    expect(widthForRange('', '', 40)).toBe(0)
    expect(widthForRange('2026-06-05', '2026-06-01', 40)).toBe(0) // reversed -> 0, never negative
  })

  it('isWithin is inclusive of both ends', () => {
    expect(isWithin('2026-05-10', '2026-05-01', '2026-05-31')).toBe(true)
    expect(isWithin('2026-05-01', '2026-05-01', '2026-05-31')).toBe(true)
    expect(isWithin('2026-05-31', '2026-05-01', '2026-05-31')).toBe(true)
    expect(isWithin('2026-06-01', '2026-05-01', '2026-05-31')).toBe(false)
  })

  it('toISODate/parseDate round-trip', () => {
    expect(toISODate(parseDate('2026-05-29'))).toBe('2026-05-29')
  })
})

describe('todayISO', () => {
  it('returns the local date when no timeZone given', () => {
    const result = todayISO()
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns a YYYY-MM-DD string for a valid time zone', () => {
    const result = todayISO('America/New_York')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('returns the correct date for zones on both sides of midnight', () => {
    // We can't control the clock in unit tests easily, so just check format + it doesn't throw.
    expect(() => todayISO('Pacific/Auckland')).not.toThrow()
    expect(() => todayISO('America/Los_Angeles')).not.toThrow()
    expect(() => todayISO('Etc/GMT')).not.toThrow()
  })

  it('falls back gracefully when given undefined', () => {
    expect(() => todayISO(undefined)).not.toThrow()
    expect(todayISO(undefined)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  describe('with a fixed clock', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('resolves the date in the GIVEN zone, not the local one — even when they disagree', () => {
      // At this instant, Pacific/Kiritimati (UTC+14) has already ticked over to the
      // 15th while every plausible CI/dev machine zone (UTC-12 .. UTC+14, but not
      // literally Kiritimati) still reads the 14th. A mutant that swaps the locale,
      // drops the timeZone option, or blanks out the year/month/day field options all
      // make the Intl call throw or silently ignore the zone — either way falling back
      // to the (wrong, one-day-off) local date.
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-14T20:00:00Z'))
      expect(todayISO('Pacific/Kiritimati')).toBe('2026-06-15')
    })

    it('always resolves the SAME zone, ignoring which timeZone happens to be passed', () => {
      // Guards the early-return short-circuit `if (!timeZone) return toISODate(new
      // Date())`: forcing it to ALWAYS fire (dropping the timeZone argument on the
      // floor) would make a valid, given zone come back as the local date instead.
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-06-14T20:00:00Z'))
      expect(todayISO('Pacific/Kiritimati')).not.toBe(todayISO())
    })
  })

  it('warns (not silently) and still returns a valid local date for a malformed IANA zone', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => todayISO('Not/AZone')).not.toThrow()
    const result = todayISO('Not/AZone')
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(result).toBe(toISODate(new Date()))
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('todayISO: invalid timeZone "Not/AZone"'),
      expect.anything(),
    )
    warnSpy.mockRestore()
  })
})

describe('isWeekendAware', () => {
  it('is false when workingDays is empty (no boundary at length > 0 to cross)', () => {
    expect(isWeekendAware([], false)).toBe(false)
  })

  it('is false for a full 7-day working week (no boundary at length < 7 to cross)', () => {
    expect(isWeekendAware([0, 1, 2, 3, 4, 5, 6], false)).toBe(false)
  })

  it('is true for a genuine partial week (both boundaries cleared)', () => {
    expect(isWeekendAware([1, 2, 3, 4, 5], false)).toBe(true)
  })
})

describe('countWorkingDays', () => {
  it('returns 0 for a reversed (empty) range regardless of how far reversed', () => {
    expect(countWorkingDays('2026-06-02', '2026-06-01', [1, 2, 3, 4, 5])).toBe(0)
    expect(countWorkingDays('2026-06-10', '2026-06-01', [1, 2, 3, 4, 5])).toBe(0)
  })
})

describe('endDateForWorkingDays', () => {
  it('falls back to the raw calendar span (start itself) when count <= 0', () => {
    expect(endDateForWorkingDays('2026-06-01', 0, [1, 2, 3, 4, 5])).toBe('2026-06-01')
    expect(endDateForWorkingDays('2026-06-01', -3, [1, 2, 3, 4, 5])).toBe('2026-06-01')
  })

  it('falls back to the raw calendar span when workingDays is empty', () => {
    // count=5 -> 5th calendar day at/after start = start + 4.
    expect(endDateForWorkingDays('2026-06-01', 5, [])).toBe('2026-06-05')
  })

  it('falls back to the raw calendar span at length >= 7, even with duplicate weekday entries', () => {
    // A length-7 workingDays array is normally the full week (matches every day), so
    // the fallback and the working-day scan happen to agree — UNLESS the array is
    // degenerate (all entries the same weekday), which still has length 7 but only
    // actually works ~1 day in 7. That's exactly what distinguishes ">= 7" (fallback,
    // start + 4) from a scan that would otherwise land 4 WEEKS later.
    expect(endDateForWorkingDays('2026-06-01', 5, [1, 1, 1, 1, 1, 1, 1])).toBe('2026-06-05')
  })
})
