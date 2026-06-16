import { describe, it, expect } from 'vitest'
import { volumePreservingHours, computeGesture, snappedBarGeometry } from './allocationDrag'
import { buildColumnGeometry } from './columnGeometry'
import { eachDayISO } from '@floaty/shared/lib/dateMath'
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
  // Uniform geometry over June (origin 2026-06-01, dayWidth 20), minimise off — the preview
  // pixels reduce to the absolute index*dayWidth positions the view-model would place.
  const geom = buildColumnGeometry(eachDayISO('2026-06-01', '2026-06-30'), 20, { minimiseWeekends: false, weekendWidth: 12 })

  it('converts a non-weekend-aware move to absolute pixels (left at the snapped start, width holds)', () => {
    // Move +2: 06-01..06-04 → 06-03..06-06. Left = index 2 × 20; width = 4-day span × 20.
    const { left, width } = snappedBarGeometry('move', current, 2, IGNORE, geom)
    expect(left).toBe(2 * 20)
    expect(width).toBe(4 * 20)
  })

  it('threads opts through to applyGesture (weekend-aware result differs from naive)', () => {
    // A Thu–Fri allocation moved +1 day: ignoring weekends it stays a plain 2-calendar-day
    // bar; weekend-aware it preserves its working-day length across the weekend, so the
    // geometry differs. The exact weekend math is applyGesture's own concern (and tests) —
    // here we only prove snappedBarGeometry threads opts through rather than dropping them.
    const thuFri = range('2026-06-04', '2026-06-05')
    const naive = snappedBarGeometry('move', thuFri, 1, IGNORE, geom)
    const weekendAware = snappedBarGeometry('move', thuFri, 1, { workingDays: [1, 2, 3, 4, 5] }, geom)
    expect(naive).toEqual({ left: 4 * 20, width: 2 * 20 }) // +1 calendar day, 2-day span held
    expect(weekendAware).not.toEqual(naive) // opts threaded → weekend-aware (wider) span
  })

  it('keeps the preview pixel-identical to the view-model when the range crosses a narrow weekend', () => {
    // Minimise ON: Sat/Sun are 8px, weekdays 20px. A Fri→following-Mon span must measure from
    // the REAL mixed column widths (the same geometry the committed bar uses) — not 4×20.
    const narrow = buildColumnGeometry(eachDayISO('2026-06-01', '2026-06-30'), 20, { minimiseWeekends: true, weekendWidth: 8 })
    // 06-05 = Fri, 06-08 = Mon. The committed bar's geometry for that exact range:
    const committed = { left: narrow.xForDateInGeom('2026-06-05'), width: narrow.widthForDates('2026-06-05', '2026-06-08') }
    // Reach it by a weekend-aware resize-end of a single Friday +1 day (Fri 06-05, end extends
    // across the weekend to Mon 06-08 — the start stays on Friday).
    const preview = snappedBarGeometry('resize-end', range('2026-06-05', '2026-06-05'), 1, { workingDays: [1, 2, 3, 4, 5] }, narrow)
    expect(preview).toEqual(committed)
    // Width = Fri(20) + Sat(8) + Sun(8) + Mon(20) = 56, NOT 4×20.
    expect(preview.width).toBe(56)
  })
})
