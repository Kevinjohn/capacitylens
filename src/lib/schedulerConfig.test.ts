import { describe, it, expect } from 'vitest'
import { MAX_DAY_WIDTH, MIN_DAY_WIDTH, resolveDayWidth, ZOOM_LEVELS } from './schedulerConfig'

describe('resolveDayWidth', () => {
  it('fits the requested number of weeks into the available width', () => {
    expect(resolveDayWidth(800, 4)).toBe(28) // 800 / (4*7)
    expect(resolveDayWidth(800, 8)).toBe(14) // 800 / (8*7)
    expect(resolveDayWidth(840, 2)).toBe(60) // 840 / (2*7), below the cap
  })

  it('clamps to MAX for very wide / few-week views', () => {
    expect(resolveDayWidth(2000, 1)).toBe(MAX_DAY_WIDTH) // 2000/7 = 285 -> capped
    expect(resolveDayWidth(5000, 1)).toBe(MAX_DAY_WIDTH)
  })

  it('clamps to MIN for tiny / many-week views and non-positive widths', () => {
    expect(resolveDayWidth(50, 8)).toBe(MIN_DAY_WIDTH)
    expect(resolveDayWidth(0, 4)).toBe(MIN_DAY_WIDTH)
    expect(resolveDayWidth(-100, 1)).toBe(MIN_DAY_WIDTH)
  })

  it('exposes the expected zoom levels', () => {
    expect(ZOOM_LEVELS).toEqual([1, 2, 4, 6, 8])
  })
})
