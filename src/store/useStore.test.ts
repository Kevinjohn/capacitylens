import { describe, it, expect, beforeEach } from 'vitest'
import { hasActiveFilters, useStore } from './useStore'
import { resetStoreWithAccount } from '../test/fixtures'

const s = () => useStore.getState()
beforeEach(() => resetStoreWithAccount())

const personDraft = {
  kind: 'person' as const,
  name: 'Ty',
  role: 'Dev',
  employmentType: 'permanent' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5] as const,
  color: '#1',
}

describe('store CRUD', () => {
  it('adds entities with a generated id and timestamps', () => {
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    expect(r.id).toBeTruthy()
    expect(r.createdAt).toBeTruthy()
    expect(r.updatedAt).toBeTruthy()
    expect(s().data.resources).toHaveLength(1)
  })

  it('updates fields and bumps updatedAt', async () => {
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    await new Promise((res) => setTimeout(res, 2))
    s().updateResource(r.id, { name: 'Tyler' })
    const updated = s().data.resources[0]
    expect(updated.name).toBe('Tyler')
    expect(updated.updatedAt >= r.updatedAt).toBe(true)
  })

  it('cascades client deletion through projects, tasks and allocations', () => {
    const client = s().addClient({ name: 'Acme', color: '#1' })
    const project = s().addProject({ name: 'P', clientId: client.id, color: '#2' })
    const task = s().addTask({ name: 'T', projectId: project.id })
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    s().addAllocation({ resourceId: r.id, taskId: task.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    expect(s().data.allocations).toHaveLength(1)

    s().deleteClient(client.id)
    const d = s().data
    expect(d.clients).toHaveLength(0)
    expect(d.projects).toHaveLength(0)
    expect(d.tasks).toHaveLength(0)
    expect(d.allocations).toHaveLength(0)
    expect(d.resources).toHaveLength(1) // resources are not deleted
  })

  it('rejects assigning a placeholder to a task outside its bound project', () => {
    const client = s().addClient({ name: 'Acme', color: '#1' })
    const p1 = s().addProject({ name: 'P1', clientId: client.id, color: '#2' })
    const p2 = s().addProject({ name: 'P2', clientId: client.id, color: '#3' })
    const taskP2 = s().addTask({ name: 'T2', projectId: p2.id })
    const ph = s().addResource({
      kind: 'placeholder',
      role: 'Designer',
      employmentType: 'permanent',
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      color: '#1',
      projectId: p1.id,
    })
    expect(() =>
      s().addAllocation({ resourceId: ph.id, taskId: taskP2.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' }),
    ).toThrow()
    expect(s().data.allocations).toHaveLength(0)
  })
})

describe('store scheduler UI', () => {
  it('setZoom sets the weeks-visible level', () => {
    s().setZoom(8)
    expect(s().ui.zoom).toBe(8)
    s().setZoom(1)
    expect(s().ui.zoom).toBe(1)
  })

  it('panDays shifts the origin', () => {
    s().setOriginDate('2026-06-01')
    s().panDays(7)
    expect(s().ui.originDate).toBe('2026-06-08')
  })

  it('goToToday resets the origin and bumps recenterToken (so the grid re-scrolls)', () => {
    const before = s().ui.recenterToken
    s().setOriginDate('2020-01-01')
    s().goToToday()
    expect(s().ui.recenterToken).toBe(before + 1)
    expect(s().ui.originDate).not.toBe('2020-01-01')
  })

  it('setNotice sets and clears the transient message', () => {
    s().setNotice('Nope')
    expect(s().notice).toBe('Nope')
    s().setNotice(null)
    expect(s().notice).toBeNull()
  })

  it('setNotice records severity (info default, error opt-in) so the UI can persist errors', () => {
    s().setNotice('Heads up')
    expect(s().noticeTone).toBe('info')
    s().setNotice('Boom', 'error')
    expect(s().noticeTone).toBe('error')
    // Clearing resets the tone so a stale error tone can't linger.
    s().setNotice(null)
    expect(s().noticeTone).toBe('info')
  })

  it('goToDate sets focusDate + origin and bumps recenterToken', () => {
    const before = s().ui.recenterToken
    s().goToDate('2026-08-15')
    expect(s().ui.focusDate).toBe('2026-08-15')
    expect(s().ui.recenterToken).toBe(before + 1)
    expect(s().ui.originDate < '2026-08-15').toBe(true) // offset back for lead context
  })

  it('setDrawMode toggles between work and time off', () => {
    s().setDrawMode('timeoff')
    expect(s().ui.drawMode).toBe('timeoff')
    s().setDrawMode('work')
    expect(s().ui.drawMode).toBe('work')
  })

  it('toggleGroup collapses and expands a discipline', () => {
    s().toggleGroup('d-design')
    expect(s().ui.collapsedGroups).toContain('d-design')
    s().toggleGroup('d-design')
    expect(s().ui.collapsedGroups).not.toContain('d-design')
  })

  it('undo and redo move through mutation history', () => {
    resetStoreWithAccount()
    const c = s().addClient({ name: 'Acme', color: '#1' })
    expect(s().data.clients).toHaveLength(1)
    s().undo()
    expect(s().data.clients).toHaveLength(0)
    s().redo()
    expect(s().data.clients).toHaveLength(1)
    expect(s().data.clients[0].id).toBe(c.id)
  })

  it('setFilters merges, hasActiveFilters reflects state, clearFilters resets', () => {
    s().clearFilters()
    expect(hasActiveFilters(s().ui.filters)).toBe(false)
    s().setFilters({ search: 'ty', hideTentative: true })
    expect(s().ui.filters.search).toBe('ty')
    expect(s().ui.filters.hideTentative).toBe(true)
    expect(hasActiveFilters(s().ui.filters)).toBe(true)
    s().clearFilters()
    expect(s().ui.filters.search).toBe('')
    expect(hasActiveFilters(s().ui.filters)).toBe(false)
  })
})
