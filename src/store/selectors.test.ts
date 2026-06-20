import { describe, it, expect } from 'vitest'
import { disciplinesEnabledFor, resourcesByDiscipline, activitiesForProject, visibleRange } from './selectors'
import { emptyFilters } from './useStore'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'

function data(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [
      { id: 'd2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Dev', sortOrder: 1 },
      { id: 'd1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 },
    ],
    resources: [
      { id: 'r1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'A', role: 'x', disciplineId: 'd1', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#1' },
      { id: 'r2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'B', role: 'x', disciplineId: 'd2', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#2' },
      { id: 'r3', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'C', role: 'x', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#3' },
    ],
    projects: [{ id: 'p1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'P', clientId: 'c1', color: '#1' }],
    activities: [
      { id: 't1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T1', kind: 'project', projectId: 'p1' },
      { id: 't2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T2', kind: 'project', projectId: 'p2' },
    ],
  }
}

describe('resourcesByDiscipline', () => {
  it('groups resources under disciplines ordered by sortOrder, with an ungrouped bucket last', () => {
    const groups = resourcesByDiscipline(data())
    expect(groups.map((g) => g.discipline?.name ?? '(none)')).toEqual(['Design', 'Dev', '(none)'])
    expect(groups[0].resources.map((r) => r.id)).toEqual(['r1'])
    expect(groups[2].discipline).toBeNull()
    expect(groups[2].resources.map((r) => r.id)).toEqual(['r3'])
  })
})

describe('disciplinesEnabledFor', () => {
  const accounts = (disciplinesEnabled?: boolean) => ({
    ...emptyAppData(),
    accounts: [{ id: 'a1', createdAt: 't', updatedAt: 't', name: 'Studio', color: '#1', disciplinesEnabled }],
  })

  it('defaults to true when the field is absent', () => {
    expect(disciplinesEnabledFor(accounts(undefined), 'a1')).toBe(true)
  })

  it('defaults to true when no account matches', () => {
    expect(disciplinesEnabledFor(accounts(false), 'missing')).toBe(true)
  })

  it('returns the explicit account value', () => {
    expect(disciplinesEnabledFor(accounts(false), 'a1')).toBe(false)
    expect(disciplinesEnabledFor(accounts(true), 'a1')).toBe(true)
  })
})

describe('activitiesForProject', () => {
  it('filters activities by project', () => {
    expect(activitiesForProject(data(), 'p1').map((t) => t.id)).toEqual(['t1'])
  })
})

describe('visibleRange', () => {
  it('spans rangeDays inclusive from the origin', () => {
    const range = visibleRange({ zoom: 4, originDate: '2026-06-01', rangeDays: 7, focusDate: '2026-06-01', drawMode: 'work', selectedAllocationId: null, filters: emptyFilters(), collapsedGroups: [], recenterToken: 0, scrollToResource: null })
    expect(range).toEqual({ start: '2026-06-01', end: '2026-06-07' })
  })
})
