import { describe, it, expect } from 'vitest'
import { volumePreservingHours, computeGesture, snappedBarGeometry } from './allocationDrag'
import type { DateRange } from '../../lib/gestureMath'

// These functions were extracted from AllocationBar so the gesture math could be tested
// directly. The branches below are exactly the ones a happy-path drag interaction test
// never exercises: the divide-by-zero guard, the MAX_HOURS_PER_DAY clamp, the
// deltaDays === 0 / move-keeps-hours paths, and weekend-aware snapping.

const IGNORE = { ignoreWeekends: true } // not weekend-aware → spans are plain calendar days
const range = (startDate: string, endDate: string): DateRange => ({ startDate, endDate })

describe('volumePreservingHours', () => {
  it('rescales hours inversely with the span (volume held constant)', () => {
    // span 4 days → span 2 days doubles hours/day: 6 × 4 / 2 = 12
    expect(volumePreservingHours(range('2026-06-01', '2026-06-04'), range('2026-06-01', '2026-06-02'), IGNORE, 6)).toBe(12)
  })

  it('clamps the result to MAX_HOURS_PER_DAY (24)', () => {
    // span 25 → span 1 would be 6 × 25 = 150 h/day; clamped to a real working day
    expect(volumePreservingHours(range('2026-06-01', '2026-06-25'), range('2026-06-01', '2026-06-01'), IGNORE, 6)).toBe(24)
  })

  it('returns the original hours when the new span is zero (divide-by-zero guard)', () => {
    // endDate one day before startDate → daysInclusive = 0 → guard returns hoursPerDay unchanged
    expect(volumePreservingHours(range('2026-06-01', '2026-06-04'), range('2026-06-02', '2026-06-01'), IGNORE, 6)).toBe(6)
  })
})

describe('computeGesture', () => {
  const current = range('2026-06-01', '2026-06-04') // span 4 days

  it('returns the range and hours unchanged when deltaDays is 0', () => {
    const { dates, hours } = computeGesture('move', current, 0, IGNORE, 6, true)
    expect(dates).toBe(current) // returns `current` by reference — no gesture applied
    expect(hours).toBe(6)
  })

  it('keeps hours unchanged for a move (only a resize rescales)', () => {
    const { dates, hours } = computeGesture('move', current, 2, IGNORE, 6, true)
    expect(hours).toBe(6)
    expect(dates).toEqual(range('2026-06-03', '2026-06-06')) // shifted +2 calendar days
  })

  it('rescales hours for a days-mode resize that changes the span', () => {
    // resize-end -2 → end 06-02, span 4 → 2, hours 6 → 12
    const { dates, hours } = computeGesture('resize-end', current, -2, IGNORE, 6, true)
    expect(dates).toEqual(range('2026-06-01', '2026-06-02'))
    expect(hours).toBe(12)
  })

  it('does NOT rescale hours when not in days mode (hourly/blocks)', () => {
    const { hours } = computeGesture('resize-end', current, -2, IGNORE, 6, false)
    expect(hours).toBe(6)
  })
})

describe('snappedBarGeometry', () => {
  const current = range('2026-06-01', '2026-06-04') // span 4 days

  it('converts a non-weekend-aware move to pixels (left shifts, width holds)', () => {
    const { left, width } = snappedBarGeometry('move', current, 2, IGNORE, 100, 20)
    expect(left).toBe(100 + 2 * 20) // barX + 2 calendar days
    expect(width).toBe(4 * 20) // a move leaves the span (4 days) unchanged
  })

  it('threads opts through to applyGesture (weekend-aware result differs from naive)', () => {
    // A Thu–Fri allocation moved +1 day: ignoring weekends it stays a plain 2-calendar-day
    // bar; weekend-aware it preserves its working-day length across the weekend, so the
    // geometry differs. The exact weekend math is applyGesture's own concern (and tests) —
    // here we only prove snappedBarGeometry threads opts through rather than dropping them.
    const thuFri = range('2026-06-04', '2026-06-05')
    const naive = snappedBarGeometry('move', thuFri, 1, IGNORE, 0, 10)
    const weekendAware = snappedBarGeometry('move', thuFri, 1, { workingDays: [1, 2, 3, 4, 5] }, 0, 10)
    expect(naive).toEqual({ left: 10, width: 20 }) // +1 calendar day, 2-day span held
    expect(weekendAware).not.toEqual(naive) // opts threaded → weekend-aware math applied
  })
})
