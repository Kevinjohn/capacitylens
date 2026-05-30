import { describe, it, expect } from 'vitest'
import {
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
  deleteTaskCascade,
  isTemporary,
  validateAllocationAssignment,
  validateDateRange,
  validateProjectClient,
} from './integrity'
import { emptyAppData } from '../types/entities'
import type { AppData, Resource } from '../types/entities'

const placeholder = (over: Partial<Resource> = {}): Resource => ({
  id: 'ph1',
  accountId: 'acct-test',
  createdAt: 't',
  updatedAt: 't',
  kind: 'placeholder',
  role: 'Senior Designer',
  employmentType: 'permanent',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: '#000',
  projectId: 'p1',
  ...over,
})

const person = (over: Partial<Resource> = {}): Resource => ({
  ...placeholder(over),
  kind: 'person',
  projectId: undefined,
  ...over,
})

// A small connected dataset: client c1 -> project p1 -> phase ph -> tasks; allocations; a bound placeholder.
function sampleData(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [{ id: 'd1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 }],
    clients: [{ id: 'c1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#111' }],
    projects: [{ id: 'p1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Lightning', clientId: 'c1', color: '#222' }],
    phases: [{ id: 'phase1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Discovery', projectId: 'p1' }],
    tasks: [
      { id: 't1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Wires', projectId: 'p1', phaseId: 'phase1' },
      { id: 't2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Visual', projectId: 'p1' },
    ],
    resources: [person({ id: 'r1', disciplineId: 'd1' }), placeholder({ id: 'ph1', projectId: 'p1', disciplineId: 'd1' })],
    allocations: [
      { id: 'a1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', taskId: 't1', startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'ph1', taskId: 't2', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
    ],
    timeOff: [{ id: 'to1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', startDate: '2026-06-10', endDate: '2026-06-11', type: 'holiday' }],
  }
}

describe('isTemporary', () => {
  it('is true for freelancers and contractors, false for permanent', () => {
    expect(isTemporary({ employmentType: 'permanent' })).toBe(false)
    expect(isTemporary({ employmentType: 'freelancer' })).toBe(true)
    expect(isTemporary({ employmentType: 'contractor' })).toBe(true)
  })
})

describe('validateProjectClient', () => {
  it('requires a client', () => {
    expect(validateProjectClient('c1').ok).toBe(true)
    expect(validateProjectClient('').ok).toBe(false)
    expect(validateProjectClient(undefined).ok).toBe(false)
  })
})

describe('validateDateRange', () => {
  it('accepts a normal range and a single day', () => {
    expect(validateDateRange('2026-06-01', '2026-06-05').ok).toBe(true)
    expect(validateDateRange('2026-06-01', '2026-06-01').ok).toBe(true)
  })
  it('rejects a missing end or start', () => {
    expect(validateDateRange('2026-06-01', '').ok).toBe(false)
    expect(validateDateRange('', '2026-06-01').ok).toBe(false)
    expect(validateDateRange(undefined, undefined).ok).toBe(false)
  })
  it('rejects a reversed range', () => {
    const v = validateDateRange('2026-06-05', '2026-06-01')
    expect(v.ok).toBe(false)
    expect(v.errors[0]).toMatch(/before the start/i)
  })
})

describe('placeholder binding', () => {
  it('a person can be assigned any project task', () => {
    expect(validateAllocationAssignment(person(), 'anything').ok).toBe(true)
  })

  it('a placeholder can only be assigned tasks from its bound project', () => {
    const ph = placeholder({ projectId: 'p1' })
    expect(validateAllocationAssignment(ph, 'p1').ok).toBe(true)
    expect(validateAllocationAssignment(ph, 'p2').ok).toBe(false)
  })

  it('validateAllocationAssignment explains the rejection', () => {
    expect(validateAllocationAssignment(placeholder({ projectId: 'p1' }), 'p2').ok).toBe(false)
    expect(validateAllocationAssignment(placeholder({ projectId: undefined }), 'p1').ok).toBe(false)
    expect(validateAllocationAssignment(placeholder({ projectId: 'p1' }), 'p1').ok).toBe(true)
    expect(validateAllocationAssignment(person(), 'p1').ok).toBe(true)
  })
})

describe('cascade deletes', () => {
  it('deleteResourceCascade removes the resource, its allocations and time off', () => {
    const next = deleteResourceCascade(sampleData(), 'r1')
    expect(next.resources.map((r) => r.id)).toEqual(['ph1'])
    expect(next.allocations.map((a) => a.id)).toEqual(['a2'])
    expect(next.timeOff).toHaveLength(0)
  })

  it('deleteTaskCascade removes the task and its allocations', () => {
    const next = deleteTaskCascade(sampleData(), 't1')
    expect(next.tasks.map((t) => t.id)).toEqual(['t2'])
    expect(next.allocations.map((a) => a.id)).toEqual(['a2'])
  })

  it('deletePhaseCascade ungroups tasks but keeps them', () => {
    const next = deletePhaseCascade(sampleData(), 'phase1')
    expect(next.phases).toHaveLength(0)
    expect(next.tasks.find((t) => t.id === 't1')!.phaseId).toBeUndefined()
    expect(next.tasks).toHaveLength(2)
  })

  it('deleteProjectCascade removes project, phases, tasks, their allocations, and unbinds placeholders', () => {
    const next = deleteProjectCascade(sampleData(), 'p1')
    expect(next.projects).toHaveLength(0)
    expect(next.phases).toHaveLength(0)
    expect(next.tasks).toHaveLength(0)
    expect(next.allocations).toHaveLength(0) // both allocations referenced p1 tasks
    expect(next.resources.find((r) => r.id === 'ph1')!.projectId).toBeUndefined()
    expect(next.resources).toHaveLength(2) // resources are NOT deleted
  })

  it('deleteClientCascade cascades through its projects', () => {
    const next = deleteClientCascade(sampleData(), 'c1')
    expect(next.clients).toHaveLength(0)
    expect(next.projects).toHaveLength(0)
    expect(next.tasks).toHaveLength(0)
    expect(next.allocations).toHaveLength(0)
    expect(next.resources.find((r) => r.id === 'ph1')!.projectId).toBeUndefined()
  })

  it('deleteDisciplineCascade ungroups resources but keeps them', () => {
    const next = deleteDisciplineCascade(sampleData(), 'd1')
    expect(next.disciplines).toHaveLength(0)
    expect(next.resources.every((r) => r.disciplineId === undefined)).toBe(true)
    expect(next.resources).toHaveLength(2)
  })

  it('does not mutate the input', () => {
    const data = sampleData()
    const snapshot = JSON.stringify(data)
    deleteClientCascade(data, 'c1')
    expect(JSON.stringify(data)).toBe(snapshot)
  })
})
