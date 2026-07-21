import { describe, it, expect } from 'vitest'
import { volumePreservingHoursClamped, computeGesture, snappedBarGeometry, reconcileReassignedHours } from './allocationDrag'
import { buildColumnGeometry } from './columnGeometry'
import { eachDayISO } from '@capacitylens/shared/lib/dateMath'
import type { DateRange } from '../../lib/gestureMath'
import type { Resource, Weekday } from '@capacitylens/shared/types/entities'

// These functions were extracted from AllocationBar so the gesture math could be tested
// directly. The branches below are exactly the ones a happy-path drag interaction test
// never exercises: the divide-by-zero guard, the MAX_HOURS_PER_DAY clamp, the
// deltaDays === 0 / move-keeps-hours paths, and weekend-aware snapping.

const IGNORE = { ignoreWeekends: true } // not weekend-aware → spans are plain calendar days
const range = (startDate: string, endDate: string): DateRange => ({ startDate, endDate })

describe('volumePreservingHoursClamped', () => {
  // The .hours field on its own (what the old volumePreservingHours wrapper returned): rescale,
  // clamp, and the divide-by-zero guard.
  it('rescales hours inversely with the span (volume held constant)', () => {
    // span 4 days → span 2 days doubles hours/day: 6 × 4 / 2 = 12
    expect(volumePreservingHoursClamped(range('2026-06-01', '2026-06-04'), range('2026-06-01', '2026-06-02'), IGNORE, 6).hours).toBe(12)
  })

  it('clamps the result to MAX_HOURS_PER_DAY (24)', () => {
    // span 25 → span 1 would be 6 × 25 = 150 h/day; clamped to a real working day
    expect(volumePreservingHoursClamped(range('2026-06-01', '2026-06-25'), range('2026-06-01', '2026-06-01'), IGNORE, 6).hours).toBe(24)
  })

  it('returns the original hours when the new span is zero (divide-by-zero guard)', () => {
    // endDate one day before startDate → daysInclusive = 0 → guard returns hoursPerDay unchanged
    expect(volumePreservingHoursClamped(range('2026-06-01', '2026-06-04'), range('2026-06-02', '2026-06-01'), IGNORE, 6).hours).toBe(6)
  })

  // The clamp flag is what lets a gesture commit surface the lost work volume — it must be
  // true ONLY when the raw derived hours actually exceeded the cap (a truncation), never on
  // a normal in-range resize or the divide-by-zero guard. This is the test that fails without
  // the surfacing change being wired through.
  it('flags clamped=true when the raw derived hours exceed MAX_HOURS_PER_DAY (24)', () => {
    // span 25 → span 1 would be 6 × 25 = 150 h/day; clamped to 24, and the flag bites
    expect(volumePreservingHoursClamped(range('2026-06-01', '2026-06-25'), range('2026-06-01', '2026-06-01'), IGNORE, 6)).toEqual({ hours: 24, clamped: true })
  })

  it('reports clamped=false for an in-range resize (no truncation)', () => {
    // span 4 → span 2 doubles to 12h/day, well under the cap
    expect(volumePreservingHoursClamped(range('2026-06-01', '2026-06-04'), range('2026-06-01', '2026-06-02'), IGNORE, 6)).toEqual({ hours: 12, clamped: false })
  })

  it('reports clamped=false at exactly the cap (24 is allowed, only > caps)', () => {
    // span 4 → span 1 quadruples 6 → 24, landing exactly on the cap: no truncation
    expect(volumePreservingHoursClamped(range('2026-06-01', '2026-06-04'), range('2026-06-01', '2026-06-01'), IGNORE, 6)).toEqual({ hours: 24, clamped: false })
  })

  it('reports clamped=false through the divide-by-zero guard (original hours, no clamp)', () => {
    expect(volumePreservingHoursClamped(range('2026-06-01', '2026-06-04'), range('2026-06-02', '2026-06-01'), IGNORE, 6)).toEqual({ hours: 6, clamped: false })
  })

  // A weekend-aware allocation spanning only Sat–Sun has ZERO working days in its OLD span. Before
  // the fix, `hoursPerDay * 0 / newSpan` derives 0 and commits it with clamped=false — silent data
  // loss, since the bar still renders but contributes nothing to utilisation. There is no volume to
  // preserve when the old span had none, so the only non-destructive result is the stored hours,
  // untouched.
  const WEEKDAYS_ONLY = { workingDays: [1, 2, 3, 4, 5] as Weekday[] } // Mon–Fri; spanDays counts working days only

  it('preserves hoursPerDay verbatim when the OLD span has zero working days (weekend-only allocation)', () => {
    // 2026-06-06 = Sat, 2026-06-07 = Sun: a Sat-Sun old range has 0 working days.
    expect(
      volumePreservingHoursClamped(range('2026-06-06', '2026-06-07'), range('2026-06-01', '2026-06-04'), WEEKDAYS_ONLY, 6),
    ).toEqual({ hours: 6, clamped: false })
  })

  it('does not zero hours when a zero-working-day old span is resized onto weekdays', () => {
    // Resize-end drags a Sat-only allocation forward onto a full working week — the derived hours
    // must stay the stored value, not collapse to 0 just because oldSpan/newSpan would otherwise
    // divide out to nothing.
    const { hours, clamped } = volumePreservingHoursClamped(
      range('2026-06-06', '2026-06-06'), // Sat only, 0 working days
      range('2026-06-06', '2026-06-12'), // extends across the following working week
      WEEKDAYS_ONLY,
      8,
    )
    expect(hours).toBe(8)
    expect(clamped).toBe(false)
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
    const { dates, hours, clamped } = computeGesture('resize-end', current, -2, IGNORE, 6, true)
    expect(dates).toEqual(range('2026-06-01', '2026-06-02'))
    expect(hours).toBe(12)
    expect(clamped).toBe(false) // in range, no truncation
  })

  it('does NOT rescale hours when not in days mode (hourly/blocks)', () => {
    const { hours, clamped } = computeGesture('resize-end', current, -2, IGNORE, 6, false)
    expect(hours).toBe(6)
    expect(clamped).toBe(false)
  })

  it('flags clamped on a days-mode resize that drives hours past the cap', () => {
    // span 4 → span 1 (resize-end -3) quadruples 12 → 48; clamped to 24, flag set
    const { hours, clamped } = computeGesture('resize-end', current, -3, IGNORE, 12, true)
    expect(hours).toBe(24)
    expect(clamped).toBe(true)
  })

  it('never flags clamped for a move (only a volume-preserving resize can clamp)', () => {
    expect(computeGesture('move', current, 2, IGNORE, 24, true).clamped).toBe(false)
  })

  // A move never rescales even when the span is unchanged (its old/new span ARE equal, so a
  // naive rescale would be a mathematical no-op on `hours` alone) — the `mode !== 'move'` guard
  // must still be the thing gating the branch, not a coincidence of equal spans. An out-of-range
  // hoursPerDay (30, over the 24h cap) makes the two code paths diverge in BOTH fields even though
  // the span stays 4: the hardcoded move path returns it untouched/unclamped; the volume-preserving
  // path (entered only if the mode guard is broken) would clamp it to 24 and flag `clamped: true`.
  it('a move never enters the volume-preserving path, even with an out-of-range hoursPerDay', () => {
    const { hours, clamped } = computeGesture('move', current, 2, IGNORE, 30, true)
    expect(hours).toBe(30)
    expect(clamped).toBe(false)
  })

  // deltaDays === 0 must short-circuit BEFORE the days-mode rescale, not merely produce the same
  // numbers as it by coincidence. Same trick: an out-of-range hoursPerDay makes the (wrongly)
  // entered rescale path diverge from the hardcoded "unchanged" return in both hours and clamped.
  it('deltaDays === 0 skips the rescale entirely, even with an out-of-range hoursPerDay', () => {
    const { hours, clamped } = computeGesture('resize-end', current, 0, IGNORE, 30, true)
    expect(hours).toBe(30)
    expect(clamped).toBe(false)
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

describe('reconcileReassignedHours', () => {
  const res = (kind: Resource['kind'], workingHoursPerDay = 8): Resource => ({
    id: 'r', accountId: 'a', createdAt: 't', updatedAt: 't', kind, role: 'R',
    employmentType: 'permanent', workingHoursPerDay, workingDays: [1, 2, 3, 4, 5], color: '#000000',
  })
  it('forces 0 hours when reassigning onto an external (a capacity-free row carries no load)', () => {
    expect(reconcileReassignedHours(8, res('external'))).toBe(0)
  })
  it('keeps a real resource positive hours on a real-to-real reassign', () => {
    expect(reconcileReassignedHours(6, res('person'))).toBe(6)
  })
  it('promotes a 0-hour booking (dragged off an external) to the target working day', () => {
    expect(reconcileReassignedHours(0, res('person', 7))).toBe(7)
  })
})
