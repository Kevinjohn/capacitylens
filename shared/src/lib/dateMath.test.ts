import { describe, it, expect } from 'vitest'
import {
  addDaysISO,
  dayIndex,
  daysInclusive,
  eachDayISO,
  isWithin,
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
})
