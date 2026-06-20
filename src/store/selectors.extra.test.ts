import { describe, it, expect } from 'vitest'
import {
  allocationsForResource,
  byDisciplineOrder,
  clientById,
  phasesForProject,
  projectById,
  projectsForClient,
  resourceById,
  taskById,
  timeOffForResource,
} from './selectors'
import type { Discipline } from '@floaty/shared/types/entities'
import { emptyAppData } from '@floaty/shared/types/entities'
import type { AppData } from '@floaty/shared/types/entities'

const data: AppData = {
  ...emptyAppData(),
  clients: [{ id: 'c1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#1' }],
  projects: [
    { id: 'p1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'P1', clientId: 'c1', color: '#2' },
    { id: 'p2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'P2', clientId: 'c1', color: '#3' },
  ],
  phases: [{ id: 'ph1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Disc', projectId: 'p1' }],
  tasks: [{ id: 't1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'T1', kind: 'project', projectId: 'p1' }],
  resources: [
    { id: 'r1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', kind: 'person', name: 'A', role: 'Dev', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1], color: '#4' },
  ],
  allocations: [
    { id: 'a1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
  ],
  timeOff: [{ id: 'to1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', startDate: '2026-06-10', endDate: '2026-06-11', type: 'holiday' }],
}

describe('lookup + relation selectors', () => {
  it('by-id selectors find entities (and return undefined for misses)', () => {
    expect(clientById(data, 'c1')!.name).toBe('Acme')
    expect(projectById(data, 'p1')!.name).toBe('P1')
    expect(taskById(data, 't1')!.name).toBe('T1')
    expect(resourceById(data, 'r1')!.name).toBe('A')
    expect(clientById(data, 'nope')).toBeUndefined()
  })

  it('relation selectors filter children', () => {
    expect(projectsForClient(data, 'c1').map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(phasesForProject(data, 'p1').map((p) => p.id)).toEqual(['ph1'])
    expect(allocationsForResource(data, 'r1').map((a) => a.id)).toEqual(['a1'])
    expect(timeOffForResource(data, 'r1').map((t) => t.id)).toEqual(['to1'])
  })
})

describe('byDisciplineOrder (shared by the scheduler grouping AND the Disciplines list)', () => {
  const disc = (id: string, name: string, sortOrder: number): Discipline => ({ id, accountId: 'acct-test', name, sortOrder, createdAt: 't', updatedAt: 't' })

  it('orders by sortOrder, then name as a stable tiebreak on equal sortOrder', () => {
    const list = [disc('a', 'Zeta', 1), disc('b', 'Alpha', 1), disc('c', 'Beta', 0)]
    expect([...list].sort(byDisciplineOrder).map((d) => d.name)).toEqual(['Beta', 'Alpha', 'Zeta'])
  })
})
