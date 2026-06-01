import { describe, it, expect } from 'vitest'
import { resolveBarColor, readableTextColor, contrastRatio, ensureBarColors, isHexColor } from '@floaty/shared/lib/color'
import { DEFAULT_COLORS } from './palette'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'

function dataWith(projectColor: string, clientColor = '#client'): AppData {
  return {
    ...emptyAppData(),
    clients: [{ id: 'c1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Acme', color: clientColor }],
    projects: [{ id: 'p1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'P', clientId: 'c1', color: projectColor }],
    tasks: [{ id: 't1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T', projectId: 'p1' }],
    resources: [{ id: 'r1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#resource' }],
  }
}

const alloc = { id: 'a1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' as const }

// resolveBarColor takes id→entity maps (built once by the scheduler model); build them here.
const maps = (d: AppData) => ({
  tasks: new Map(d.tasks.map((t) => [t.id, t])),
  projects: new Map(d.projects.map((p) => [p.id, p])),
  clients: new Map(d.clients.map((c) => [c.id, c])),
  resources: new Map(d.resources.map((r) => [r.id, r])),
})

describe('resolveBarColor', () => {
  it('prefers the project colour', () => {
    expect(resolveBarColor(alloc, maps(dataWith('#project')))).toBe('#project')
  })

  it('falls back to the client colour when the project has none', () => {
    expect(resolveBarColor(alloc, maps(dataWith('', '#client')))).toBe('#client')
  })

  it('falls back to the resource colour when project and client have none', () => {
    expect(resolveBarColor(alloc, maps(dataWith('', '')))).toBe('#resource')
  })

  it('uses a neutral grey when nothing resolves', () => {
    expect(resolveBarColor(alloc, maps(emptyAppData()))).toBe('#9ca3af')
  })
})

describe('readableTextColor', () => {
  it('uses dark ink on light backgrounds', () => {
    expect(readableTextColor('#ffffff')).toBe('#1c2230')
    expect(readableTextColor('#fbbf24')).toBe('#1c2230') // amber
  })
  it('uses white on dark/saturated backgrounds', () => {
    expect(readableTextColor('#1c2230')).toBe('#ffffff')
    expect(readableTextColor('#4f46e5')).toBe('#ffffff') // indigo
  })
  it('falls back to dark ink for malformed input', () => {
    expect(readableTextColor('#abc')).toBe('#1c2230')
    expect(readableTextColor('not-a-color')).toBe('#1c2230')
  })
})

describe('ensureBarColors', () => {
  it('guarantees the label clears WCAG AA (4.5:1) for every default colour', () => {
    for (const hex of Object.values(DEFAULT_COLORS)) {
      const { bg, ink } = ensureBarColors(hex)
      expect(contrastRatio(bg, ink)).toBeGreaterThanOrEqual(4.5)
    }
  })
  it('leaves an already-compliant colour effectively unchanged', () => {
    const { bg, ink } = ensureBarColors('#000000')
    expect(ink).toBe('#ffffff')
    expect(contrastRatio(bg, ink)).toBeGreaterThanOrEqual(4.5)
  })
  it('falls back for malformed input', () => {
    const { bg, ink } = ensureBarColors('nope')
    expect(contrastRatio(bg, ink)).toBeGreaterThan(1)
  })
  it('falls back to neutral grey for an OVERLONG hex (was mis-sliced before)', () => {
    expect(ensureBarColors('#aabbccdd').bg).toBe('#9ca3af') // 8 digits → invalid → grey, not a wrong colour
  })
})

describe('isHexColor', () => {
  it('accepts 6-digit hex and rejects everything else', () => {
    expect(isHexColor('#3b82f6')).toBe(true)
    expect(isHexColor('#ABCDEF')).toBe(true)
    expect(isHexColor('#abc')).toBe(false)
    expect(isHexColor('3b82f6')).toBe(false)
    expect(isHexColor('rgb(0,0,0)')).toBe(false)
  })
})

describe('contrastRatio', () => {
  it('black on white is the maximum ~21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeGreaterThan(20)
  })
  it('identical colours are 1:1', () => {
    expect(contrastRatio('#777777', '#777777')).toBeCloseTo(1)
  })
  it('returns 1 for malformed input', () => {
    expect(contrastRatio('nope', '#ffffff')).toBe(1)
  })
  it('returns 1 for an overlong hex', () => {
    expect(contrastRatio('#aabbccdd', '#ffffff')).toBe(1)
  })
})
