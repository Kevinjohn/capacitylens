import { describe, it, expect } from 'vitest'
import { buildColumnGeometry } from './columnGeometry'
import { eachDayISO, xForDate, widthForRange } from '@capacitylens/shared/lib/dateMath'

// A full week: 2026-06-01 (Mon) … 2026-06-07 (Sun). 06-06 = Sat, 06-07 = Sun.
const WEEK = eachDayISO('2026-06-01', '2026-06-07')
const OFF = { minimiseWeekends: false, weekendWidth: 20 }
const ON = { minimiseWeekends: true, weekendWidth: 20 }

describe('buildColumnGeometry — minimise OFF reproduces the uniform index*dayWidth grid', () => {
  const geom = buildColumnGeometry(WEEK, 48, OFF)

  it('every column is dayWidth wide and offsets are the running multiples', () => {
    expect(geom.widths).toEqual([48, 48, 48, 48, 48, 48, 48])
    expect(geom.offsets).toEqual([0, 48, 96, 144, 192, 240, 288, 336])
    expect(geom.totalWidth).toBe(336)
    expect(geom.minimiseActive).toBe(false)
  })

  it('x(i) === i * dayWidth and widthOf(i) === dayWidth', () => {
    for (let i = 0; i < WEEK.length; i++) {
      expect(geom.x(i)).toBe(i * 48)
      expect(geom.widthOf(i)).toBe(48)
    }
  })

  it('xForDateInGeom / widthForDates match the legacy xForDate / widthForRange exactly', () => {
    const origin = WEEK[0]
    for (const d of WEEK) {
      expect(geom.xForDateInGeom(d)).toBe(xForDate(d, origin, 48))
    }
    // Inclusive ranges, including ones that span the (uniform) weekend.
    expect(geom.widthForDates('2026-06-01', '2026-06-02')).toBe(widthForRange('2026-06-01', '2026-06-02', 48))
    expect(geom.widthForDates('2026-06-05', '2026-06-07')).toBe(widthForRange('2026-06-05', '2026-06-07', 48))
  })

  it('xForDateInGeom extrapolates off-window dates at full dayWidth (overflow geometry preserved)', () => {
    expect(geom.xForDateInGeom('2026-05-30')).toBe(-2 * 48) // two days before the window
    expect(geom.xForDateInGeom('2026-06-09')).toBe(8 * 48) // two days past the last index (7)
  })

  it('indexAt reduces to the old floor(px / dayWidth), clamped to [0, n-1]', () => {
    expect(geom.indexAt(-10)).toBe(0)
    expect(geom.indexAt(0)).toBe(0)
    expect(geom.indexAt(47)).toBe(0)
    expect(geom.indexAt(48)).toBe(1)
    expect(geom.indexAt(95)).toBe(1)
    expect(geom.indexAt(300)).toBe(6)
    expect(geom.indexAt(336)).toBe(6) // == totalWidth → last column, not n
    expect(geom.indexAt(99999)).toBe(6)
  })
})

describe('buildColumnGeometry — minimise ON narrows the weekend columns', () => {
  const geom = buildColumnGeometry(WEEK, 48, ON)

  it('Sat and Sun take weekendWidth; weekdays keep dayWidth', () => {
    expect(geom.widths).toEqual([48, 48, 48, 48, 48, 20, 20])
    expect(geom.offsets).toEqual([0, 48, 96, 144, 192, 240, 260, 280])
    expect(geom.totalWidth).toBe(280) // 5×48 + 2×20
    expect(geom.minimiseActive).toBe(true)
  })

  it('spanWidth across the narrow weekend sums the real (mixed) widths', () => {
    // Fri..Sun = 48 (Fri) + 20 (Sat) + 20 (Sun) = 88
    expect(geom.spanWidth(4, 6)).toBe(88)
    // widthForDates is the date-keyed equivalent.
    expect(geom.widthForDates('2026-06-05', '2026-06-07')).toBe(88)
    // A weekday-only range is unaffected.
    expect(geom.widthForDates('2026-06-01', '2026-06-02')).toBe(96)
  })

  it('a bar starting on a narrow weekend lands at the summed offset', () => {
    expect(geom.xForDateInGeom('2026-06-06')).toBe(240) // Sat: 5×48
    expect(geom.xForDateInGeom('2026-06-07')).toBe(260) // Sun: 5×48 + 20
  })

  it('caps weekendWidth at dayWidth (a "narrow" column can never be wider than a normal one)', () => {
    const wide = buildColumnGeometry(WEEK, 18, { minimiseWeekends: true, weekendWidth: 40 })
    expect(wide.widths).toEqual([18, 18, 18, 18, 18, 18, 18]) // 40 capped to 18 → no visible narrowing
  })

  it('degrades to full-width weekends when weekendWidth is unmeasured (NaN / 0)', () => {
    for (const bad of [NaN, 0, -5]) {
      const geomBad = buildColumnGeometry(WEEK, 48, { minimiseWeekends: true, weekendWidth: bad })
      expect(geomBad.widths.every((w) => w === 48)).toBe(true)
      expect(geomBad.offsets.every((o) => Number.isFinite(o))).toBe(true)
    }
  })
})

describe('buildColumnGeometry — indexAt is the exact inverse of x() at every boundary', () => {
  for (const opts of [OFF, ON]) {
    const label = opts.minimiseWeekends ? 'minimise ON' : 'minimise OFF'
    const geom = buildColumnGeometry(WEEK, 48, opts)

    it(`${label}: indexAt(x(i)) === i, and indexAt(x(i) - 1) === i - 1`, () => {
      for (let i = 0; i < WEEK.length; i++) {
        expect(geom.indexAt(geom.x(i))).toBe(i) // left edge of column i → i
        if (i > 0) expect(geom.indexAt(geom.x(i) - 1)).toBe(i - 1) // one px left → previous column
      }
    })
  }
})

describe('buildColumnGeometry — gating + degenerate windows', () => {
  it('does NOT narrow below the per-day-column threshold (header shows week blocks there)', () => {
    const geom = buildColumnGeometry(WEEK, 12, ON) // 12 < DAY_COLUMN_MIN_WIDTH (18)
    expect(geom.minimiseActive).toBe(false)
    expect(geom.widths).toEqual([12, 12, 12, 12, 12, 12, 12])
  })

  it('handles an empty window without throwing or producing NaN', () => {
    const geom = buildColumnGeometry([], 48, ON)
    expect(geom.totalWidth).toBe(0)
    expect(geom.offsets).toEqual([0])
    expect(geom.indexAt(0)).toBe(0)
    expect(geom.x(3)).toBe(0)
    expect(geom.widthOf(0)).toBe(0)
    expect(geom.xForDateInGeom('2026-06-01')).toBe(0)
    expect(geom.widthForDates('2026-06-01', '2026-06-02')).toBe(0)
  })

  it('widthForDates clamps a reversed range to 0 (never negative)', () => {
    const geom = buildColumnGeometry(WEEK, 48, OFF)
    expect(geom.widthForDates('2026-06-05', '2026-06-01')).toBe(0)
  })
})
