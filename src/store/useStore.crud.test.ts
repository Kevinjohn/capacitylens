import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { emptyAppData } from '@floaty/shared/types/entities'
import { resetStoreWithAccount } from '../test/fixtures'

const s = () => useStore.getState()

beforeEach(() => {
  resetStoreWithAccount()
  s().clearFilters()
})

const personDraft = {
  kind: 'person' as const,
  name: 'Person',
  role: 'Dev',
  employmentType: 'permanent' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: '#1',
}

describe('store CRUD covers every entity', () => {
  it('disciplines: add / update / delete', () => {
    const d = s().addDiscipline({ name: 'Design', color: '#1', sortOrder: 0 })
    s().updateDiscipline(d.id, { name: 'Design 2' })
    expect(s().data.disciplines[0].name).toBe('Design 2')
    s().deleteDiscipline(d.id)
    expect(s().data.disciplines).toHaveLength(0)
  })

  it('clients: add / update / delete', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    s().updateClient(c.id, { name: 'Acme 2' })
    expect(s().data.clients[0].name).toBe('Acme 2')
    s().deleteClient(c.id)
    expect(s().data.clients).toHaveLength(0)
  })

  it('projects: add / update / delete', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    s().updateProject(p.id, { name: 'P2' })
    expect(s().data.projects[0].name).toBe('P2')
    s().deleteProject(p.id)
    expect(s().data.projects).toHaveLength(0)
  })

  it('phases: add / update / delete (tasks survive)', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const ph = s().addPhase({ name: 'Discovery', projectId: p.id })
    const t = s().addTask({ name: 'T', projectId: p.id, phaseId: ph.id })
    s().updatePhase(ph.id, { name: 'Disco' })
    expect(s().data.phases[0].name).toBe('Disco')
    s().deletePhase(ph.id)
    expect(s().data.phases).toHaveLength(0)
    expect(s().data.tasks.find((x) => x.id === t.id)!.phaseId).toBeUndefined()
  })

  it('tasks: add / update / delete', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addTask({ name: 'T', projectId: p.id })
    s().updateTask(t.id, { name: 'T2' })
    expect(s().data.tasks[0].name).toBe('T2')
    s().deleteTask(t.id)
    expect(s().data.tasks).toHaveLength(0)
  })

  it('tasks: a general (no-project) task can be added without a projectId', () => {
    const t = s().addTask({ name: 'Admin' })
    expect(t.projectId).toBeUndefined()
    expect(s().data.tasks[0].projectId).toBeUndefined()
    expect(s().data.tasks[0].name).toBe('Admin')
  })

  it('tasks: a project-bound task can be converted to general by clearing projectId', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addTask({ name: 'T', projectId: p.id })
    s().updateTask(t.id, { projectId: undefined })
    expect(s().data.tasks[0].projectId).toBeUndefined()
  })

  it('resources: add / update / delete', () => {
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    s().updateResource(r.id, { role: 'Lead' })
    expect(s().data.resources[0].role).toBe('Lead')
    s().deleteResource(r.id)
    expect(s().data.resources).toHaveLength(0)
  })

  it('allocations: add / update / delete', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addTask({ name: 'T', projectId: p.id })
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    const a = s().addAllocation({ resourceId: r.id, taskId: t.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    s().updateAllocation(a.id, { hoursPerDay: 4, status: 'tentative' })
    expect(s().data.allocations[0]).toMatchObject({ hoursPerDay: 4, status: 'tentative' })
    s().deleteAllocation(a.id)
    expect(s().data.allocations).toHaveLength(0)
  })

  it('time off: add / update / delete', () => {
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    const to = s().addTimeOff({ resourceId: r.id, startDate: '2026-06-10', endDate: '2026-06-11', type: 'holiday' })
    s().updateTimeOff(to.id, { type: 'sick' })
    expect(s().data.timeOff[0].type).toBe('sick')
    s().deleteTimeOff(to.id)
    expect(s().data.timeOff).toHaveLength(0)
  })
})

describe('store UI + history extras', () => {
  it('selectAllocation, setOriginDate and goToToday', () => {
    s().selectAllocation('abc')
    expect(s().ui.selectedAllocationId).toBe('abc')
    s().setOriginDate('2026-01-01')
    expect(s().ui.originDate).toBe('2026-01-01')
    s().goToToday()
    expect(s().ui.originDate).not.toBe('2026-01-01')
  })

  it('undo/redo are no-ops on empty history', () => {
    expect(() => s().undo()).not.toThrow()
    expect(() => s().redo()).not.toThrow()
    expect(s().data.clients).toHaveLength(0)
  })

  it('a new mutation clears the redo stack', () => {
    s().addClient({ name: 'A', color: '#1' })
    s().undo()
    expect(s().future).toHaveLength(1)
    s().addClient({ name: 'B', color: '#2' })
    expect(s().future).toHaveLength(0)
  })
})

describe('allocation integrity at the store boundary', () => {
  it('updateAllocation enforces the placeholder binding', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p1 = s().addProject({ name: 'P1', clientId: c.id, color: '#2' })
    const p2 = s().addProject({ name: 'P2', clientId: c.id, color: '#3' })
    const t1 = s().addTask({ name: 'T1', projectId: p1.id })
    const t2 = s().addTask({ name: 'T2', projectId: p2.id })
    const ph = s().addResource({
      kind: 'placeholder', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#1', projectId: p1.id,
    })
    const a = s().addAllocation({ resourceId: ph.id, taskId: t1.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    expect(() => s().updateAllocation(a.id, { taskId: t2.id })).toThrow()
    expect(s().data.allocations.find((x) => x.id === a.id)!.taskId).toBe(t1.id)
  })

  it('addAllocation rejects dangling resource/task references', () => {
    expect(() =>
      s().addAllocation({ resourceId: 'nope', taskId: 'nope', startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 8, status: 'confirmed' }),
    ).toThrow()
    expect(s().data.allocations).toHaveLength(0)
  })
})

describe('date-range + reference guards at the store boundary', () => {
  const seedAlloc = () => {
    const c = s().addClient({ name: 'Acme', color: '#111111' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#222222' })
    const t = s().addTask({ name: 'T', projectId: p.id })
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    return { r, t }
  }

  it('addAllocation rejects an empty or reversed date range', () => {
    const { r, t } = seedAlloc()
    expect(() => s().addAllocation({ resourceId: r.id, taskId: t.id, startDate: '', endDate: '', hoursPerDay: 8, status: 'confirmed' })).toThrow()
    expect(() => s().addAllocation({ resourceId: r.id, taskId: t.id, startDate: '2026-06-05', endDate: '2026-06-01', hoursPerDay: 8, status: 'confirmed' })).toThrow()
    expect(s().data.allocations).toHaveLength(0)
  })

  it('updateAllocation allows a note/status-only patch (validates the effective range, not the patch)', () => {
    const { r, t } = seedAlloc()
    const a = s().addAllocation({ resourceId: r.id, taskId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' })
    expect(() => s().updateAllocation(a.id, { status: 'tentative' })).not.toThrow()
    expect(s().data.allocations[0].status).toBe('tentative')
    // …but a patch that would reverse the range is rejected.
    expect(() => s().updateAllocation(a.id, { endDate: '2026-05-01' })).toThrow()
    expect(s().data.allocations[0].endDate).toBe('2026-06-03')
  })

  it('addTimeOff rejects a dangling resource and a reversed range', () => {
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    expect(() => s().addTimeOff({ resourceId: 'nope', startDate: '2026-06-01', endDate: '2026-06-02', type: 'holiday' })).toThrow()
    expect(() => s().addTimeOff({ resourceId: r.id, startDate: '2026-06-05', endDate: '2026-06-01', type: 'holiday' })).toThrow()
    expect(s().data.timeOff).toHaveLength(0)
  })

  it('importData replaces everything but is undoable via ⌘Z', () => {
    s().addClient({ name: 'Keep', color: '#111111' })
    s().importData(emptyAppData())
    expect(s().data.clients).toHaveLength(0)
    s().undo()
    expect(s().data.clients).toHaveLength(1)
    expect(s().data.clients[0].name).toBe('Keep')
  })
})
