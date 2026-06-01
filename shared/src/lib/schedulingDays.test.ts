import { describe, it, expect } from 'vitest'
import { spanDays, endDateForSpan, hoursPerDayFor, daysOfWorkFor, blockHoursPerDay, BLOCK_LOAD_FRACTION, MAX_SPAN_DAYS } from './schedulingDays'
import type { Weekday } from '../types/entities'

const MON_FRI: Weekday[] = [1, 2, 3, 4, 5]
// 2026-06-01 is a Monday; 06-05 Fri, 06-06/07 weekend, 06-08 Mon.

describe('spanDays', () => {
  it('counts working days when weekend-aware', () => {
    expect(spanDays('2026-06-01', '2026-06-05', { workingDays: MON_FRI })).toBe(5)
    // Mon–Fri (5) + the following Monday = 6 working days across an 8-day calendar span.
    expect(spanDays('2026-06-01', '2026-06-08', { workingDays: MON_FRI })).toBe(6)
  })

  it('counts calendar days when ignoreWeekends opts out', () => {
    expect(spanDays('2026-06-01', '2026-06-08', { workingDays: MON_FRI, ignoreWeekends: true })).toBe(8)
  })

  it('counts calendar days when the whole week is working', () => {
    expect(spanDays('2026-06-01', '2026-06-08', { workingDays: [0, 1, 2, 3, 4, 5, 6] })).toBe(8)
  })
})

describe('endDateForSpan is the inverse of spanDays', () => {
  it('weekend-aware: skips non-working days', () => {
    expect(endDateForSpan('2026-06-01', 5, { workingDays: MON_FRI })).toBe('2026-06-05')
    expect(endDateForSpan('2026-06-01', 6, { workingDays: MON_FRI })).toBe('2026-06-08')
  })

  it('calendar mode: plain inclusive span', () => {
    expect(endDateForSpan('2026-06-01', 8, { workingDays: MON_FRI, ignoreWeekends: true })).toBe('2026-06-08')
  })

  it('round-trips span -> end -> span (weekend-aware)', () => {
    const opts = { workingDays: MON_FRI }
    for (const n of [1, 3, 5, 6, 10]) {
      const end = endDateForSpan('2026-06-01', n, opts)
      expect(spanDays('2026-06-01', end, opts)).toBe(n)
    }
  })

  it('clamps a sub-1 span to a single day', () => {
    expect(endDateForSpan('2026-06-01', 0, { workingDays: MON_FRI })).toBe('2026-06-01')
  })

  it('caps an absurd / NaN span so the derived end date stays a valid 4-digit-year date', () => {
    const opts = { workingDays: MON_FRI, ignoreWeekends: true }
    const capped = endDateForSpan('2026-06-01', MAX_SPAN_DAYS, opts)
    // A huge span clamps to the cap (instead of deriving a 5-digit-year date that throws
    // RangeError when the modal hint formats it).
    expect(endDateForSpan('2026-06-01', 9_999_999, opts)).toBe(capped)
    expect(/^\d{4}-\d{2}-\d{2}$/.test(capped)).toBe(true)
    // NaN → a single day, never an Invalid Date.
    expect(endDateForSpan('2026-06-01', NaN, opts)).toBe('2026-06-01')
  })
})

describe('hoursPerDayFor / daysOfWorkFor', () => {
  it('spreads volume across the span', () => {
    // 5 days of work over 10 days at an 8h day = half-time = 4h/day.
    expect(hoursPerDayFor(5, 10, 8)).toBe(4)
    // Full-time: work === span.
    expect(hoursPerDayFor(5, 5, 8)).toBe(8)
  })

  it('round-trips hours <-> days of work', () => {
    expect(daysOfWorkFor(hoursPerDayFor(3, 7, 8), 7, 8)).toBeCloseTo(3)
    expect(hoursPerDayFor(daysOfWorkFor(4, 10, 8), 10, 8)).toBeCloseTo(4)
  })

  it('is safe on degenerate inputs', () => {
    expect(hoursPerDayFor(5, 0, 8)).toBe(0)
    expect(daysOfWorkFor(8, 5, 0)).toBe(0)
  })
})

describe('blockHoursPerDay', () => {
  it('is the configured fraction of the working day (0 = no load, for now)', () => {
    expect(BLOCK_LOAD_FRACTION).toBe(0)
    expect(blockHoursPerDay(8)).toBe(0)
    expect(blockHoursPerDay(7.5)).toBe(0)
  })
})
