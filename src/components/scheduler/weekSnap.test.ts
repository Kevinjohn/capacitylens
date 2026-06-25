import { describe, it, expect } from 'vitest'
import { buildColumnGeometry } from './columnGeometry'
import { weekStartSnapTarget } from './weekSnap'
import { eachDayISO, startOfWeekISO } from '@floaty/shared/lib/dateMath'

// Three full weeks: 2026-06-01 (Mon) … 2026-06-21 (Sun). Mondays sit at indices 0 (06-01),
// 7 (06-08), 14 (06-15); Sundays (the Sunday-week-start anchors) at 6 (06-07), 13 (06-14).
// A multi-week window is deliberate: the "floor not nearest" test needs a NEXT Monday to prove
// a >½-week left edge still floors BACKWARD rather than forward.
const DAYS = eachDayISO('2026-06-01', '2026-06-21')
const DAY_W = 48
const OFF = { minimiseWeekends: false, weekendWidth: 20 }
const ON = { minimiseWeekends: true, weekendWidth: 20 }

describe('weekStartSnapTarget — floor to the current week start (uniform grid)', () => {
  const geom = buildColumnGeometry(DAYS, DAY_W, OFF)
  const mon1 = geom.xForDateInGeom('2026-06-01') // 0
  const mon2 = geom.xForDateInGeom('2026-06-08') // 336

  it('a left edge mid-week (Wed) floors BACK to the same Monday', () => {
    const wedX = geom.xForDateInGeom('2026-06-03') // 96
    expect(weekStartSnapTarget(geom, DAYS, wedX, 1)).toBe(mon1)
  })

  it('a left edge past the half-week (Fri) ALSO floors back to the SAME Monday, never forward', () => {
    const friX = geom.xForDateInGeom('2026-06-05') // 192, > half of the 336px week
    const target = weekStartSnapTarget(geom, DAYS, friX, 1)
    expect(target).toBe(mon1) // the CURRENT Monday, not the nearest
    expect(target).toBeLessThan(mon2) // and strictly behind next Monday — proves "floor, not nearest"
  })

  it('returns null when already exactly on a Monday (convergence — caller no-ops)', () => {
    expect(weekStartSnapTarget(geom, DAYS, mon1, 1)).toBeNull()
    expect(weekStartSnapTarget(geom, DAYS, mon2, 1)).toBeNull()
  })

  it('returns null within the 0.5px convergence band (sub-pixel already-aligned)', () => {
    // Just ABOVE the exact Monday offset still resolves to that Monday's column → target === mon2,
    // within the band → null. (A value just BELOW it floors to the prior — Sunday — column, which is
    // a genuine different week start, so that case is NOT a no-op and is covered by the floor tests.)
    expect(weekStartSnapTarget(geom, DAYS, mon2 + 0.4, 1)).toBeNull()
    // …but just past the band it snaps.
    expect(weekStartSnapTarget(geom, DAYS, mon2 + 0.6, 1)).toBe(mon2)
  })
})

describe('weekStartSnapTarget — Sunday week start (weekStartsOn=0)', () => {
  const geom = buildColumnGeometry(DAYS, DAY_W, OFF)

  it('floors to the SUNDAY, not the Monday', () => {
    const tueX = geom.xForDateInGeom('2026-06-09') // Tue of the 2nd week, idx 8
    const sunday = geom.xForDateInGeom('2026-06-07') // the Sunday that starts that week, idx 6
    expect(weekStartSnapTarget(geom, DAYS, tueX, 0)).toBe(sunday)
    // Cross-check it's genuinely the Sunday, not the Monday after it.
    expect(weekStartSnapTarget(geom, DAYS, tueX, 0)).not.toBe(geom.xForDateInGeom('2026-06-08'))
  })
})

describe('weekStartSnapTarget — degenerate inputs stay finite', () => {
  const geom = buildColumnGeometry(DAYS, DAY_W, OFF)

  it('an out-of-range (negative / huge) scrollLeft falls back via days[0]/last day, never NaN', () => {
    // indexAt clamps px<=0 → 0 and px>=totalWidth → n-1, so the left day is always in-window.
    // A hugely-negative scrollLeft clamps to days[0] (Monday 06-01, offset 0); target 0 is far from
    // -9999 so it's a real snap (not null) — and finite.
    const lo = weekStartSnapTarget(geom, DAYS, -9999, 1)
    expect(lo).toBe(0)
    expect(Number.isFinite(lo as number)).toBe(true)
    // A huge px clamps to the last column (06-21, Sun) whose Monday is 06-15; finite, no NaN.
    const hi = weekStartSnapTarget(geom, DAYS, 9_999_999, 1)
    expect(Number.isFinite(hi as number)).toBe(true)
    expect(hi).toBe(geom.xForDateInGeom('2026-06-15'))
  })
})

describe('weekStartSnapTarget — minimised-weekend geometry', () => {
  const geom = buildColumnGeometry(DAYS, DAY_W, ON)

  it('floors to the correct INTEGER week-start offset across narrowed weekends', () => {
    // Land the left edge on Wed of week 2 (past two narrowed weekends), then floor to its Monday.
    const wedX = geom.xForDateInGeom('2026-06-10') // Wed, week 2
    const mondayOfWeek2 = geom.xForDateInGeom('2026-06-08')
    const target = weekStartSnapTarget(geom, DAYS, wedX, 1)
    expect(target).toBe(mondayOfWeek2)
    // Offsets are integer under the rounded weekend width — the snap target must be too (a
    // fractional target was the bug that drifted the left-edge date a day on every zoom flip).
    expect(Number.isInteger(target as number)).toBe(true)
    // And it must agree with re-deriving the Monday through the date helpers (round-trip).
    expect(target).toBe(geom.xForDateInGeom(startOfWeekISO('2026-06-10', 1)))
  })
})
