import { describe, it, expect } from 'vitest'
import {
  addDaysISO,
  dayIndex,
  daysInclusive,
  eachDayISO,
  isWithin,
  parseDate,
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

  it('xForDate and widthForRange map dates/ranges to pixels', () => {
    expect(xForDate('2026-05-29', '2026-05-29', 40)).toBe(0)
    expect(xForDate('2026-05-30', '2026-05-29', 40)).toBe(40)
    expect(widthForRange('2026-05-29', '2026-05-29', 40)).toBe(40)
    expect(widthForRange('2026-05-29', '2026-05-30', 40)).toBe(80)
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
