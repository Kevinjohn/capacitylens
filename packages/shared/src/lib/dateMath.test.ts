import { describe, it, expect } from 'vitest'
import {
  addDaysISO,
  calculateDayIndex,
  countDaysInclusive,
  listDaysISO,
  isWithin,
  MAX_MATERIALISED_DAYS,
  parseDate,
  hasRangeOverlap,
  startOfWeekISO,
  formatISODate,
  getWeekday,
} from './dateMath.js'

describe('dateMath', () => {
  it('dayIndex counts whole calendar days from the origin', () => {
    expect(calculateDayIndex('2026-05-29', '2026-05-29')).toBe(0)
    expect(calculateDayIndex('2026-05-30', '2026-05-29')).toBe(1)
    expect(calculateDayIndex('2026-05-28', '2026-05-29')).toBe(-1)
    expect(calculateDayIndex('2026-06-05', '2026-05-29')).toBe(7)
  })

  it('addDaysISO adds and subtracts across month/year boundaries', () => {
    expect(addDaysISO('2026-05-29', 1)).toBe('2026-05-30')
    expect(addDaysISO('2026-05-29', -1)).toBe('2026-05-28')
    expect(addDaysISO('2026-05-31', 1)).toBe('2026-06-01')
    expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('countDaysInclusive treats both ends inclusively', () => {
    expect(countDaysInclusive('2026-05-29', '2026-05-29')).toBe(1)
    expect(countDaysInclusive('2026-05-29', '2026-05-30')).toBe(2)
    expect(countDaysInclusive('2026-05-29', '2026-06-04')).toBe(7)
  })

  it('is immune to spring-forward DST (no off-by-one across the boundary)', () => {
    // US DST 2026 spring-forward is 2026-03-08.
    expect(calculateDayIndex('2026-03-09', '2026-03-07')).toBe(2)
    expect(countDaysInclusive('2026-03-07', '2026-03-09')).toBe(3)
    expect(addDaysISO('2026-03-07', 2)).toBe('2026-03-09')
    expect(listDaysISO('2026-03-07', '2026-03-09')).toEqual([
      '2026-03-07',
      '2026-03-08',
      '2026-03-09',
    ])
  })

  it('listDaysISO lists inclusive dates, empty when reversed', () => {
    expect(listDaysISO('2026-05-29', '2026-05-31')).toEqual([
      '2026-05-29',
      '2026-05-30',
      '2026-05-31',
    ])
    expect(listDaysISO('2026-05-31', '2026-05-29')).toEqual([])
  })

  it('listDaysISO returns a single-element array for a same-day range', () => {
    expect(listDaysISO('2026-06-15', '2026-06-15')).toEqual(['2026-06-15'])
  })

  it('listDaysISO rejects ranges too large to materialise safely', () => {
    expect(() => listDaysISO('1900-01-01', '2100-01-01')).toThrow(
      `Date range exceeds the ${MAX_MATERIALISED_DAYS}-day materialisation limit.`
    )
  })

  it('listDaysISO is empty for ANY end-before-start range, not just adjacent reversals', () => {
    expect(listDaysISO('2026-06-15', '2026-01-01')).toEqual([])
  })

  it('listDaysISO steps correctly across a month boundary', () => {
    expect(listDaysISO('2026-01-30', '2026-02-02')).toEqual([
      '2026-01-30',
      '2026-01-31',
      '2026-02-01',
      '2026-02-02',
    ])
    expect(listDaysISO('2024-02-27', '2024-03-01')).toEqual([
      '2024-02-27',
      '2024-02-28',
      '2024-02-29',
      '2024-03-01',
    ])
  })
})

describe('dateMath range predicates', () => {
  it("preserves hasRangeOverlap's public four-argument runtime arity", () => {
    expect(hasRangeOverlap.length).toBe(4)
  })

  it('getWeekday returns 0=Sun … 6=Sat', () => {
    expect(getWeekday('2026-05-31')).toBe(0)
    expect(getWeekday('2026-06-01')).toBe(1)
    expect(getWeekday('2026-05-29')).toBe(5)
  })

  it('startOfWeekISO snaps back to the week start Monday (default)', () => {
    expect(startOfWeekISO('2026-06-01')).toBe('2026-06-01')
    expect(startOfWeekISO('2026-06-03')).toBe('2026-06-01')
    expect(startOfWeekISO('2026-06-07')).toBe('2026-06-01')
    expect(startOfWeekISO('2026-05-31')).toBe('2026-05-25')
  })

  it('startOfWeekISO respects weekStartsOn=0 (Sunday)', () => {
    expect(startOfWeekISO('2026-06-11', 0)).toBe('2026-06-07')
    expect(startOfWeekISO('2026-06-07', 0)).toBe('2026-06-07')
    expect(startOfWeekISO('2026-06-08', 0)).toBe('2026-06-07')
  })

  it('isWithin is inclusive of both ends', () => {
    expect(isWithin('2026-05-10', '2026-05-01', '2026-05-31')).toBe(true)
    expect(isWithin('2026-05-01', '2026-05-01', '2026-05-31')).toBe(true)
    expect(isWithin('2026-05-31', '2026-05-01', '2026-05-31')).toBe(true)
    expect(isWithin('2026-06-01', '2026-05-01', '2026-05-31')).toBe(false)
  })

  it('hasRangeOverlap is inclusive at both ends of both ranges', () => {
    expect(hasRangeOverlap('2026-05-01', '2026-05-31', '2026-05-10', '2026-05-12')).toBe(true)
    expect(hasRangeOverlap('2026-05-01', '2026-05-10', '2026-05-10', '2026-05-20')).toBe(true)
    expect(hasRangeOverlap('2026-05-10', '2026-05-20', '2026-05-01', '2026-05-10')).toBe(true)
    expect(hasRangeOverlap('2026-05-01', '2026-05-09', '2026-05-10', '2026-05-20')).toBe(false)
    expect(hasRangeOverlap('2026-05-21', '2026-05-30', '2026-05-10', '2026-05-20')).toBe(false)
  })

  it('formatISODate/parseDate round-trip', () => {
    expect(formatISODate(parseDate('2026-05-29'))).toBe('2026-05-29')
  })

  it('rejects extended and derived five-digit years before they can masquerade as ISODate', () => {
    expect(() => formatISODate(parseDate('+012026-06-01'))).toThrow(/four-digit ISO year range/i)
    expect(() => addDaysISO('9999-12-31', 1)).toThrow(/four-digit ISO year range/i)
  })
})
