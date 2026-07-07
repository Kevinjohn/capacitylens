import { describe, it, expect } from 'vitest'
import { resolveBarColor, contrastRatio, readableTextColor, ensureBarColors, isHexColor, type BarColorMaps } from './color'
import type { Allocation, Client, Project, Resource, Activity } from '../types/entities'

// Build the id→entity maps resolveBarColor consumes, from plain arrays.
function maps(over: { activities?: Activity[]; projects?: Project[]; clients?: Client[]; resources?: Resource[] } = {}): BarColorMaps {
  return {
    activities: new Map((over.activities ?? []).map((t) => [t.id, t])),
    projects: new Map((over.projects ?? []).map((p) => [p.id, p])),
    clients: new Map((over.clients ?? []).map((c) => [c.id, c])),
    resources: new Map((over.resources ?? []).map((r) => [r.id, r])),
  }
}

const TS = 't'
const alloc = (resourceId: string, activityId: string): Allocation => ({
  id: 'a', accountId: 'acct', createdAt: TS, updatedAt: TS, resourceId, activityId,
  startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 0, status: 'confirmed',
})
const project = (id: string, color: string): Project => ({ id, accountId: 'acct', createdAt: TS, updatedAt: TS, name: id, clientId: 'c', color })
const activity = (id: string, projectId?: string): Activity => ({ id, accountId: 'acct', createdAt: TS, updatedAt: TS, name: id, kind: 'project', projectId })
const resource = (id: string, kind: Resource['kind']): Resource => ({
  id, accountId: 'acct', createdAt: TS, updatedAt: TS, kind, role: 'R',
  employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#123456',
})

describe('resolveBarColor', () => {
  it("colours a person's bar by its project", () => {
    const m = maps({ activities: [activity('t', 'p')], projects: [project('p', '#abcdef')], resources: [resource('r', 'person')] })
    expect(resolveBarColor(alloc('r', 't'), m)).toBe('#abcdef')
  })

  it('forces an EXTERNAL bar to neutral grey, overriding the project colour', () => {
    // Same project as the person above, but the external short-circuit wins so an outsourced
    // bar never looks like one of our own (DECISIONS.md "external kind": single neutral colour).
    const m = maps({ activities: [activity('t', 'p')], projects: [project('p', '#abcdef')], resources: [resource('ext', 'external')] })
    expect(resolveBarColor(alloc('ext', 't'), m)).toBe('#9ca3af')
  })
})

describe('contrastRatio', () => {
  it('linearises a near-black channel via the low-s division branch, not the gamma curve', () => {
    // s = 1/255 <= 0.03928, so channelLin must take the s/12.92 branch. Using the
    // gamma (pow) branch instead, or multiplying instead of dividing, gives a very
    // different luminance and thus ratio.
    expect(contrastRatio('#010101', '#000000')).toBeCloseTo(1.0060705396709768, 9)
  })

  it('linearises a mid-tone channel via the gamma curve division, not multiplication', () => {
    // s = 128/255 > 0.03928, so this exercises the pow((s+0.055)/1.055, 2.4) branch.
    expect(contrastRatio('#808080', '#ffffff')).toBeCloseTo(3.9494396480491156, 9)
  })

  it('falls back to a ratio of 1 when only one channel of a hex is unparseable', () => {
    // Only the r channel is invalid here, so a mutated some->every (or an emptied
    // array) would miss it and let NaN leak into the luminance math instead of
    // short-circuiting to the documented "no contrast info" fallback of 1.
    expect(contrastRatio('#zz0000', '#123456')).toBe(1)
  })

  it('falls back to a ratio of 1 when the SECOND hex is unparseable', () => {
    // hexA is valid and non-black, so only checking hexA for null (dropping the
    // `|| lb === null` half of the guard) would let a null lb fall through into
    // the luminance arithmetic instead of short-circuiting to 1.
    expect(contrastRatio('#ffffff', '#zzzzzz')).toBe(1)
  })
})

describe('readableTextColor', () => {
  it('accounts for the real (non-zero) luminance of DARK_INK, not a zeroed-out fallback', () => {
    // At this exact background luminance, using DARK_INK's true luminance picks
    // white ink; treating it as 0 (e.g. a ?? -> && slip, which returns 0 because
    // the left side is truthy) flips the decision to dark ink.
    expect(readableTextColor('#767676')).toBe('#ffffff')
  })

  it('uses the correct white-luminance numerator (1 + 0.05) when picking ink', () => {
    // At this background luminance, the real numerator picks white ink; the
    // mutated numerator (1 - 0.05) undershoots and flips the decision to dark ink.
    expect(readableTextColor('#7c7c7c')).toBe('#ffffff')
  })
})

describe('ensureBarColors', () => {
  it('darkens (multiplies channels down) when white ink is chosen', () => {
    // Exercises the darken branch body (r/g/b *= 0.92) and the toHex '#' prefix +
    // clamp + zero-pad; a b *= -> b /= slip alone changes the blue channel here.
    expect(ensureBarColors('#6366f1')).toEqual({ bg: '#5b5ede', ink: '#ffffff' })
  })

  it('lightens (moves channels toward 255) when dark ink is chosen, never darkens', () => {
    // Real ink here is DARK_INK, so this must take the else/lighten branch. Forcing
    // `darken` true, or the inner `if (darken)` true, or flipping any of the +=/-=
    // or the (255 - c) to (255 + c) in that branch, all change this exact bg.
    expect(ensureBarColors('#3b82f6')).toEqual({ bg: '#5391f7', ink: '#1c2230' })
  })

  it('falls back to the neutral colour when the hex has any unparseable channel', () => {
    expect(ensureBarColors('#zz3456')).toEqual({ bg: '#9ca3af', ink: '#1c2230' })
  })

  it('zero-pads a single-hex-digit channel back to two digits', () => {
    // The adjusted red channel here rounds to 0, i.e. a single hex digit ("0")
    // that MUST be left-padded to "00" — dropping the padStart pad character
    // would shorten the whole hex string.
    expect(ensureBarColors('#0070f8')).toEqual({ bg: '#0067e4', ink: '#ffffff' })
  })
})

describe('isHexColor', () => {
  it('accepts a bare 6-digit hex', () => {
    expect(isHexColor('#abcdef')).toBe(true)
  })

  it('rejects a hex that is not anchored at the start of the string', () => {
    // Only the trailing $ anchor would still match "#abcdef" wherever it appears;
    // the leading ^ is what rejects junk before the '#'.
    expect(isHexColor('x#abcdef')).toBe(false)
  })
})
