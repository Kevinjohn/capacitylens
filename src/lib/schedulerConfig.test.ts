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

  it('with a weekend width, widens weekday columns so N weeks fill the space (minimise fit)', () => {
    // 1 week into 1064 with 22px weekends: 5·dw + 2·22 = 1064 -> dw = (1064-44)/5 = 204.
    expect(resolveDayWidth(1064, 1, 22)).toBe(204)
    // 2 weeks: (1064 - 2·2·22)/(2·5) = (1064-88)/10 = 97.6 -> 97.
    expect(resolveDayWidth(1064, 2, 22)).toBe(97)
    // The fit is WIDER than the uniform 7-equal-columns width (which under-fills with narrow weekends).
    expect(resolveDayWidth(1064, 1)).toBe(152) // uniform: 1064/7
    expect(204).toBeGreaterThan(152)
  })

  it('still clamps the weekend-aware fit, and ignores a non-positive / non-finite weekend width', () => {
    expect(resolveDayWidth(2000, 1, 22)).toBe(MAX_DAY_WIDTH) // (2000-44)/5 = 391 -> capped
    expect(resolveDayWidth(50, 1, 22)).toBe(MIN_DAY_WIDTH) // (50-44)/5 = 1 -> floored to MIN
    expect(resolveDayWidth(1064, 1, 0)).toBe(152) // 0 weekend width -> uniform fit
    expect(resolveDayWidth(1064, 1, NaN)).toBe(152) // NaN -> uniform fit
  })

  it('clamps to MIN for tiny / many-week views and non-positive widths', () => {
    expect(resolveDayWidth(50, 8)).toBe(MIN_DAY_WIDTH)
    expect(resolveDayWidth(0, 4)).toBe(MIN_DAY_WIDTH)
    expect(resolveDayWidth(-100, 1)).toBe(MIN_DAY_WIDTH)
  })

  it('falls back to MIN for a non-finite (NaN) available width, without propagating NaN', () => {
    // A measured DOM rect can be NaN (unmeasured/detached). Without the early `!Number.isFinite`
    // guard, `Math.floor(NaN / …)` and Math.min/max(NaN, …) would propagate NaN straight through
    // the clamp — this specifically exercises that guard, not the `<= 0` half.
    expect(resolveDayWidth(NaN, 4)).toBe(MIN_DAY_WIDTH)
    expect(Number.isFinite(resolveDayWidth(NaN, 4))).toBe(true)
  })

  it('exposes the expected zoom levels', () => {
    expect(ZOOM_LEVELS).toEqual([1, 2, 4, 6, 8])
  })
})
