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

  it('updateTask validates the MERGED row, not the raw patch (partial phase/project patches)', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p1 = s().addProject({ name: 'P1', clientId: c.id, color: '#2' })
    const p2 = s().addProject({ name: 'P2', clientId: c.id, color: '#3' })
    const ph1 = s().addPhase({ name: 'Disco', projectId: p1.id }) // a phase OF p1
    const t = s().addTask({ name: 'T', projectId: p1.id, phaseId: ph1.id })

    // A phaseId-ONLY patch (re-setting the same phase) must NOT be wrongly rejected: the
    // merged row still carries projectId from the existing task, so coherence holds.
    expect(() => s().updateTask(t.id, { phaseId: ph1.id })).not.toThrow()

    // A projectId-ONLY patch that would leave a STALE cross-project phaseId IS rejected
    // (merged row: projectId=p2 but phaseId=ph1-of-p1) instead of silently persisting an
    // incoherent task the server would later 400 on sync.
    expect(() => s().updateTask(t.id, { projectId: p2.id })).toThrow(/phase/i)
    expect(s().data.tasks[0].projectId).toBe(p1.id) // unchanged — the bad patch didn't land
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

  it('clamps allocation hoursPerDay to a real working day (<= 24) on add and update', () => {
    const { r, t } = seedAlloc()
    const a = s().addAllocation({ resourceId: r.id, taskId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 200, status: 'confirmed' })
    expect(a.hoursPerDay).toBe(24) // inflated value clamped on add
    s().updateAllocation(a.id, { hoursPerDay: 99 })
    expect(s().data.allocations[0].hoursPerDay).toBe(24) // and on update (e.g. a drag-resize rescale)
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

  it('addResource / updateResource reject an empty working-days set', () => {
    expect(() => s().addResource({ ...personDraft, workingDays: [] })).toThrow(/at least one working day/i)
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    expect(() => s().updateResource(r.id, { workingDays: [] })).toThrow(/at least one working day/i)
    // A patch that doesn't touch workingDays is unaffected.
    expect(() => s().updateResource(r.id, { name: 'Renamed' })).not.toThrow()
  })

  it('clamps resource workingHoursPerDay to (0, 24] on add and update (0/junk → 8, >24 → 24)', () => {
    // The store is the last line for the resource path too (the form caps it, but a non-form
    // or pre-blur-paste write must not persist NaN / 0 / >24h capacity). 0 is NOT legal for a
    // resource — no working day — so it falls back to 8 (distinct from an allocation, where 0 is fine).
    const over = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5], workingHoursPerDay: 1000 })
    expect(over.workingHoursPerDay).toBe(24)
    const zero = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5], workingHoursPerDay: 0 })
    expect(zero.workingHoursPerDay).toBe(8)
    s().updateResource(over.id, { workingHoursPerDay: NaN })
    expect(s().data.resources.find((r) => r.id === over.id)!.workingHoursPerDay).toBe(8) // junk → 8
  })

  it('importData replaces the active account slice and is undoable via ⌘Z', () => {
    s().addClient({ name: 'Keep', color: '#111111' })
    // A non-empty import replaces the slice (a zero-record import is refused — see below).
    const incoming = {
      ...emptyAppData(),
      clients: [{ id: 'imp', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'Imported', color: '#222222' }],
    }
    s().importData(incoming)
    expect(s().data.clients.map((c) => c.name)).toEqual(['Imported']) // 'Keep' replaced
    s().undo()
    expect(s().data.clients.map((c) => c.name)).toEqual(['Keep']) // undo restores the pre-import slice
  })

  it('importData refuses a zero-record import (no silent wipe)', () => {
    s().addClient({ name: 'Keep', color: '#111111' })
    const summary = s().importData(emptyAppData())
    expect(summary.imported).toBe(0)
    expect(s().data.clients.map((c) => c.name)).toEqual(['Keep']) // untouched
  })
})
