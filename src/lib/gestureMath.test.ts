import { describe, it, expect } from 'vitest'
import { applyGesture, type DateRange } from './gestureMath'
import type { Weekday } from '@capacitylens/shared/types/entities'

// Pixel→day snapping no longer lives here: the drag hook derives the day delta from the
// ColumnGeometry inverse (geom.indexAt), so each endpoint snaps to a column independently —
// correct even across narrowed weekend columns. See columnGeometry.test.ts. applyGesture
// (the weekend-aware DATE math) is unchanged and still owned here.

const range: DateRange = { startDate: '2026-05-10', endDate: '2026-05-12' }

describe('applyGesture: move', () => {
  it('shifts both ends by the delta', () => {
    expect(applyGesture('move', range, 2)).toEqual({ startDate: '2026-05-12', endDate: '2026-05-14' })
    expect(applyGesture('move', range, -3)).toEqual({ startDate: '2026-05-07', endDate: '2026-05-09' })
  })
})

describe('applyGesture: resize-start', () => {
  it('moves the start edge', () => {
    expect(applyGesture('resize-start', range, -2)).toEqual({ startDate: '2026-05-08', endDate: '2026-05-12' })
    expect(applyGesture('resize-start', range, 1)).toEqual({ startDate: '2026-05-11', endDate: '2026-05-12' })
  })

  it('never lets the start pass the end (min 1 day)', () => {
    expect(applyGesture('resize-start', range, 5)).toEqual({ startDate: '2026-05-12', endDate: '2026-05-12' })
  })
})

describe('applyGesture: resize-end', () => {
  it('moves the end edge', () => {
    expect(applyGesture('resize-end', range, 3)).toEqual({ startDate: '2026-05-10', endDate: '2026-05-15' })
    expect(applyGesture('resize-end', range, -1)).toEqual({ startDate: '2026-05-10', endDate: '2026-05-11' })
  })

  it('never lets the end precede the start (min 1 day)', () => {
    expect(applyGesture('resize-end', range, -5)).toEqual({ startDate: '2026-05-10', endDate: '2026-05-10' })
  })
})

describe('applyGesture: weekend-aware resize', () => {
  const wd = { workingDays: [1, 2, 3, 4, 5] as Weekday[] } // Mon–Fri
  // Reference weekdays in May 2026: 11=Mon, 15=Fri, 16=Sat, 17=Sun, 18=Mon, 22=Fri.

  it('resize-end dragging into a weekend snaps forward to the next working day', () => {
    const r: DateRange = { startDate: '2026-05-11', endDate: '2026-05-15' } // Mon–Fri
    // +1 calendar day lands on Sat 05-16; snap forward to Mon 05-18 (no weekend at the edge).
    expect(applyGesture('resize-end', r, 1, wd).endDate).toBe('2026-05-18')
  })

  it('resize-end dragging left onto a weekend snaps backward to a working day', () => {
    const r: DateRange = { startDate: '2026-05-11', endDate: '2026-05-18' } // Mon–Mon
    // -1 from Mon 05-18 = Sun 05-17; snap backward to Fri 05-15.
    expect(applyGesture('resize-end', r, -1, wd).endDate).toBe('2026-05-15')
  })

  it('resize-start dragging onto a weekend snaps to a working day', () => {
    const r: DateRange = { startDate: '2026-05-18', endDate: '2026-05-22' } // Mon–Fri
    // -1 from Mon 05-18 = Sun 05-17; snap backward to Fri 05-15.
    expect(applyGesture('resize-start', r, -1, wd).startDate).toBe('2026-05-15')
  })

  it('does NOT snap when the allocation opts out of weekend-awareness', () => {
    const r: DateRange = { startDate: '2026-05-11', endDate: '2026-05-15' }
    expect(applyGesture('resize-end', r, 1, { ...wd, ignoreWeekends: true }).endDate).toBe('2026-05-16')
  })

  it('resize-start over-dragged past a WEEKEND end pins to a working day (no zero-span)', () => {
    // 2026-06-01 Mon … 2026-06-06 Sat — the end is a Saturday.
    const r: DateRange = { startDate: '2026-06-01', endDate: '2026-06-06' }
    const out = applyGesture('resize-start', r, 99, wd)
    expect(out.startDate).toBe('2026-06-05') // Friday, NOT the Saturday end (was: 06-06, 0 working days)
    expect(out.endDate).toBe('2026-06-06')
  })

  it('resize-end over-dragged past a WEEKEND start pins to a working day', () => {
    // 2026-06-07 Sun … 2026-06-12 Fri — the start is a Sunday.
    const r: DateRange = { startDate: '2026-06-07', endDate: '2026-06-12' }
    const out = applyGesture('resize-end', r, -99, wd)
    expect(out.endDate).toBe('2026-06-08') // Monday, NOT the Sunday start
    expect(out.startDate).toBe('2026-06-07')
  })

  it('a move whose range has NO working days at all preserves its calendar span (does not collapse it)', () => {
    // 2026-06-06 Sat … 2026-06-07 Sun: 0 working days for a Mon-Fri resource. The
    // working-day-count branch would collapse this to a single day (endDateForWorkingDays with
    // count 0); the fallback must instead keep the original 2-calendar-day span.
    const r: DateRange = { startDate: '2026-06-06', endDate: '2026-06-07' }
    expect(applyGesture('move', r, 7, wd)).toEqual({ startDate: '2026-06-13', endDate: '2026-06-14' })
  })

  it('resize-start with a zero delta (no drag) is a no-op, even resting on a non-working day', () => {
    // No actual drag happened (deltaDays 0) — weekend-awareness must NOT kick in and snap a
    // start that was already sitting on a non-working day away from its current position.
    const r: DateRange = { startDate: '2026-06-06', endDate: '2026-06-10' } // Sat … Wed
    expect(applyGesture('resize-start', r, 0, wd)).toEqual({ startDate: '2026-06-06', endDate: '2026-06-10' })
  })

  it('resize-end with a zero delta (no drag) is a no-op, even resting on a non-working day', () => {
    const r: DateRange = { startDate: '2026-06-03', endDate: '2026-06-06' } // Wed … Sat
    expect(applyGesture('resize-end', r, 0, wd)).toEqual({ startDate: '2026-06-03', endDate: '2026-06-06' })
  })

  it('resize-start dragging FORWARD onto a weekend snaps forward (not backward) to a working day', () => {
    // 2026-05-15 Fri … 2026-05-22 Fri, +1 day lands the start on Sat 05-16. A forward drag
    // (deltaDays > 0) must snap FORWARD to Mon 05-18, not backward to Fri 05-15.
    const r: DateRange = { startDate: '2026-05-15', endDate: '2026-05-22' }
    expect(applyGesture('resize-start', r, 1, wd).startDate).toBe('2026-05-18')
  })
})
