import { describe, it, expect } from 'vitest'
import { SWATCH_COLUMNS, SWATCHES, colorName, swatchLabel } from './palette'

describe('SWATCHES', () => {
  it('is a 13x4 grid of distinct, valid hex colours', () => {
    // Kills the StringLiteral mutants (each entry replaced with "") in one pass: a blanked
    // entry fails the hex-format check and collapses the uniqueness count.
    expect(SWATCHES.length).toBe(SWATCH_COLUMNS * 4)
    for (const hex of SWATCHES) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/)
    }
    expect(new Set(SWATCHES).size).toBe(SWATCHES.length)
  })
})

describe('colorName', () => {
  it('names a known swatch instead of echoing its hex', () => {
    const hex = SWATCHES[0]
    const name = colorName(hex)
    expect(name).not.toBe(hex)
    expect(name).toBe(swatchLabel(0))
  })

  it('falls back to the raw hex for an unknown colour', () => {
    // Kills the "i >= 0 -> true" and "i >= 0 -> i > 0" mutants: an unknown hex must take the
    // else-branch and get the hex back verbatim, not a swatch label.
    const unknown = '#123456'
    expect(SWATCHES).not.toContain(unknown)
    expect(colorName(unknown)).toBe(unknown)
  })
})
