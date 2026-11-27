import { describe, expect, it } from 'vitest'
import { buildArchiveImpactNotice } from './archiveImpactCopy'

const impact = (projects: number, phases: number, allocations: number) => ({
  projects,
  phases,
  allocations,
  activities: 0,
  timeOff: 0,
})

describe('buildArchiveImpactNotice', () => {
  it('reports what archiving a client hid', () => {
    expect(buildArchiveImpactNotice('clients', impact(1, 0, 2))).toBe(
      'Archiving the client also hid 1 project, 0 phases and 2 allocations from the schedule; restore it to bring them back.'
    )
  })

  it.each([
    [1, '1 project, 1 phase and 1 allocation'],
    [2, '2 projects, 2 phases and 2 allocations'],
  ] as const)('formats client counts of %s', (count, expected) => {
    const copy = buildArchiveImpactNotice('clients', impact(count, count, count))
    expect(copy).toContain(expected)
    expect(copy).not.toContain('(s)')
  })

  it.each([
    [1, '1 phase and 1 allocation'],
    [2, '2 phases and 2 allocations'],
  ] as const)('formats project counts of %s', (count, expected) => {
    const copy = buildArchiveImpactNotice('projects', impact(0, count, count))
    expect(copy).toContain(expected)
    expect(copy).not.toContain('(s)')
  })

  it('reports what archiving an activity hid', () => {
    expect(buildArchiveImpactNotice('activities', impact(0, 0, 3))).toBe(
      'Archiving the activity also hid 3 allocations from the schedule; restore it to bring them back.'
    )
  })

  it.each(['clients', 'projects', 'activities'] as const)(
    'returns null when archiving %s hid nothing',
    (entity) => {
      expect(buildArchiveImpactNotice(entity, impact(0, 0, 0))).toBeNull()
    }
  )

  it('ignores counts that do not belong to the archived entity', () => {
    expect(buildArchiveImpactNotice('projects', impact(4, 0, 0))).toBeNull()
    expect(buildArchiveImpactNotice('activities', impact(4, 4, 0))).toBeNull()
  })
})
