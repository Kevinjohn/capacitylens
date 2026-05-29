import { describe, it, expect } from 'vitest'
import { resourcesByDiscipline, tasksForProject, visibleRange } from './selectors'
import { emptyFilters } from './useStore'
import { emptyAppData } from '../types/entities'
import type { AppData } from '../types/entities'

function data(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [
      { id: 'd2', createdAt: 't', updatedAt: 't', name: 'Dev', sortOrder: 1 },
      { id: 'd1', createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 },
    ],
    resources: [
      { id: 'r1', createdAt: 't', updatedAt: 't', kind: 'person', name: 'A', role: 'x', disciplineId: 'd1', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#1' },
      { id: 'r2', createdAt: 't', updatedAt: 't', kind: 'person', name: 'B', role: 'x', disciplineId: 'd2', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#2' },
      { id: 'r3', createdAt: 't', updatedAt: 't', kind: 'person', name: 'C', role: 'x', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#3' },
    ],
    projects: [{ id: 'p1', createdAt: 't', updatedAt: 't', name: 'P', clientId: 'c1', color: '#1' }],
    tasks: [
      { id: 't1', createdAt: 't', updatedAt: 't', name: 'T1', projectId: 'p1' },
      { id: 't2', createdAt: 't', updatedAt: 't', name: 'T2', projectId: 'p2' },
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

describe('tasksForProject', () => {
  it('filters tasks by project', () => {
    expect(tasksForProject(data(), 'p1').map((t) => t.id)).toEqual(['t1'])
  })
})

describe('visibleRange', () => {
  it('spans rangeDays inclusive from the origin', () => {
    const range = visibleRange({ zoom: 4, originDate: '2026-06-01', rangeDays: 7, focusDate: '2026-06-01', drawMode: 'work', selectedAllocationId: null, filters: emptyFilters(), collapsedGroups: [], recenterToken: 0 })
    expect(range).toEqual({ start: '2026-06-01', end: '2026-06-07' })
  })
})
