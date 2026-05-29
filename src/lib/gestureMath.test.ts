import { describe, it, expect } from 'vitest'
import { applyGesture, snapDeltaToDays, type DateRange } from './gestureMath'

const range: DateRange = { startDate: '2026-05-10', endDate: '2026-05-12' }

describe('snapDeltaToDays', () => {
  it('rounds pixels to the nearest whole day', () => {
    expect(snapDeltaToDays(40, 40)).toBe(1)
    expect(snapDeltaToDays(59, 40)).toBe(1)
    expect(snapDeltaToDays(60, 40)).toBe(2)
    expect(snapDeltaToDays(-40, 40)).toBe(-1)
    expect(snapDeltaToDays(10, 40)).toBe(0)
  })

  it('is safe when dayWidth is zero', () => {
    expect(snapDeltaToDays(100, 0)).toBe(0)
  })
})

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
