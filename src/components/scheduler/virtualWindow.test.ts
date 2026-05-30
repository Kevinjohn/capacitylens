import { describe, it, expect } from 'vitest'
import { computeWindow } from './virtualWindow'

describe('computeWindow', () => {
  it('renders everything when the content fits the viewport', () => {
    const heights = Array.from({ length: 8 }, () => 56) // 448px total
    const w = computeWindow(heights, 0, 720)
    expect(w).toEqual({ first: 0, last: 7, topPad: 0, bottomPad: 0 })
  })

  it('renders everything when the viewport is unmeasured (jsdom: height 0)', () => {
    const heights = Array.from({ length: 200 }, () => 56)
    const w = computeWindow(heights, 0, 0)
    expect(w).toEqual({ first: 0, last: 199, topPad: 0, bottomPad: 0 })
  })

  it('windows a large list to the visible slice (+overscan) at 200 rows', () => {
    const heights = Array.from({ length: 200 }, () => 50) // 10,000px total
    const w = computeWindow(heights, 1000, 500, 300)
    // Visible band [700, 1800): rows 14 (ends 750>700) … 35 (top 1750<1800).
    expect(w.first).toBe(14)
    expect(w.last).toBe(35)
    expect(w.topPad).toBe(700) // 14 * 50
    // The three sections always sum back to the full scroll height (stable scrollbar).
    const renderedHeight = heights.slice(w.first, w.last + 1).reduce((a, b) => a + b, 0)
    expect(w.topPad + renderedHeight + w.bottomPad).toBe(10000)
    // Only a small slice is rendered, not all 200.
    expect(w.last - w.first + 1).toBeLessThan(40)
  })

  it('clamps at the top of the list', () => {
    const heights = Array.from({ length: 200 }, () => 50)
    const w = computeWindow(heights, 0, 500, 300)
    expect(w.first).toBe(0)
    expect(w.topPad).toBe(0)
  })

  it('handles variable row heights', () => {
    const heights = [100, 40, 40, 40, 200, 40, 40, 40, 40, 40] // total 620
    const w = computeWindow(heights, 0, 200, 0)
    // band [0,200): items 0(0-100),1(100-140),2(140-180),3(180-220) → last is 3
    expect(w.first).toBe(0)
    expect(w.last).toBe(3)
    const rendered = heights.slice(0, 4).reduce((a, b) => a + b, 0)
    expect(w.topPad + rendered + w.bottomPad).toBe(620)
  })

  it('is empty for no items', () => {
    expect(computeWindow([], 0, 720)).toEqual({ first: 0, last: -1, topPad: 0, bottomPad: 0 })
  })
})
