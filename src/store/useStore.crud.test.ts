import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import type { Allocation, AppData, Resource, TimeOff } from '@capacitylens/shared/types/entities'
import { DEFAULT_ACCOUNT_ID, makeAppData, resetStoreWithAccount } from '../test/fixtures'

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

  // Clients/projects/resources have NO immediate hard-delete action — removal goes through the
  // Active → Archived → Soft-deleted → Purged lifecycle (see useStore.lifecycle.test.ts). These
  // cover the add/update half of their CRUD; the lifecycle suite covers their removal.
  it('clients: add / update', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    s().updateClient(c.id, { name: 'Acme 2' })
    expect(s().data.clients[0].name).toBe('Acme 2')
  })

  it('projects: add / update', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    s().updateProject(p.id, { name: 'P2' })
    expect(s().data.projects[0].name).toBe('P2')
  })

  it('phases: add / update / delete (activities survive)', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const ph = s().addPhase({ name: 'Discovery', projectId: p.id })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id, phaseId: ph.id })
    s().updatePhase(ph.id, { name: 'Disco' })
    expect(s().data.phases[0].name).toBe('Disco')
    s().deletePhase(ph.id)
    expect(s().data.phases).toHaveLength(0)
    expect(s().data.activities.find((x) => x.id === t.id)!.phaseId).toBeUndefined()
  })

  it('activities: add / update / delete', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    s().updateActivity(t.id, { name: 'T2' })
    expect(s().data.activities[0].name).toBe('T2')
    s().deleteActivity(t.id)
    expect(s().data.activities).toHaveLength(0)
  })

  it('activities: a general (no-project) activity can be added without a projectId', () => {
    const t = s().addActivity({ name: 'Admin', kind: 'repeatable' })
    expect(t.projectId).toBeUndefined()
    expect(s().data.activities[0].projectId).toBeUndefined()
    expect(s().data.activities[0].name).toBe('Admin')
  })

  it('activities: a project-specific activity converts to cross-project by clearing its project + kind together', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    s().updateActivity(t.id, { kind: 'repeatable', projectId: undefined })
    expect(s().data.activities[0].kind).toBe('repeatable')
    expect(s().data.activities[0].projectId).toBeUndefined()
  })

  it('activities: kind ⇆ projectId coherence is enforced — clearing a project activity’s project alone throws', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    // Leaving kind='project' while removing the project is incoherent — rejected at the store boundary.
    expect(() => s().updateActivity(t.id, { projectId: undefined })).toThrow(/project-specific activity must be assigned/i)
    // And an internal/cross-project activity may not carry a project.
    expect(() => s().addActivity({ name: 'X', kind: 'internal', projectId: p.id })).toThrow(/cannot belong to a project/i)
  })

  it('updateActivity validates the MERGED row, not the raw patch (partial phase/project patches)', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p1 = s().addProject({ name: 'P1', clientId: c.id, color: '#2' })
    const p2 = s().addProject({ name: 'P2', clientId: c.id, color: '#3' })
    const ph1 = s().addPhase({ name: 'Disco', projectId: p1.id }) // a phase OF p1
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p1.id, phaseId: ph1.id })

    // A phaseId-ONLY patch (re-setting the same phase) must NOT be wrongly rejected: the
    // merged row still carries projectId from the existing activity, so coherence holds.
    expect(() => s().updateActivity(t.id, { phaseId: ph1.id })).not.toThrow()

    // A projectId-ONLY patch that would leave a STALE cross-project phaseId IS rejected
    // (merged row: projectId=p2 but phaseId=ph1-of-p1) instead of silently persisting an
    // incoherent activity the server would later 400 on sync.
    expect(() => s().updateActivity(t.id, { projectId: p2.id })).toThrow(/phase/i)
    expect(s().data.activities[0].projectId).toBe(p1.id) // unchanged — the bad patch didn't land
  })

  it('resources: add / update', () => {
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    s().updateResource(r.id, { role: 'Lead' })
    expect(s().data.resources[0].role).toBe('Lead')
  })

  it('allocations: add / update / delete', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    const a = s().addAllocation({ resourceId: r.id, activityId: t.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
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
    const t1 = s().addActivity({ name: 'T1', kind: 'project', projectId: p1.id })
    const t2 = s().addActivity({ name: 'T2', kind: 'project', projectId: p2.id })
    const ph = s().addResource({
      kind: 'placeholder', role: 'Designer', employmentType: 'permanent', workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#1', projectId: p1.id,
    })
    const a = s().addAllocation({ resourceId: ph.id, activityId: t1.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    expect(() => s().updateAllocation(a.id, { activityId: t2.id })).toThrow()
    expect(s().data.allocations.find((x) => x.id === a.id)!.activityId).toBe(t1.id)
  })

  it('addAllocation rejects dangling resource/activity references', () => {
    expect(() =>
      s().addAllocation({ resourceId: 'nope', activityId: 'nope', startDate: '2026-06-01', endDate: '2026-06-01', hoursPerDay: 8, status: 'confirmed' }),
    ).toThrow()
    expect(s().data.allocations).toHaveLength(0)
  })
})

describe('date-range + reference guards at the store boundary', () => {
  const seedAlloc = () => {
    const c = s().addClient({ name: 'Acme', color: '#111111' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#222222' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    return { r, t }
  }

  it('addAllocation rejects an empty or reversed date range', () => {
    const { r, t } = seedAlloc()
    expect(() => s().addAllocation({ resourceId: r.id, activityId: t.id, startDate: '', endDate: '', hoursPerDay: 8, status: 'confirmed' })).toThrow()
    expect(() => s().addAllocation({ resourceId: r.id, activityId: t.id, startDate: '2026-06-05', endDate: '2026-06-01', hoursPerDay: 8, status: 'confirmed' })).toThrow()
    expect(s().data.allocations).toHaveLength(0)
  })

  it('clamps allocation hoursPerDay to a real working day (<= 24) on add and update', () => {
    const { r, t } = seedAlloc()
    const a = s().addAllocation({ resourceId: r.id, activityId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 200, status: 'confirmed' })
    expect(a.hoursPerDay).toBe(24) // inflated value clamped on add
    s().updateAllocation(a.id, { hoursPerDay: 99 })
    expect(s().data.allocations[0].hoursPerDay).toBe(24) // and on update (e.g. a drag-resize rescale)
  })

  it('updateAllocation allows a note/status-only patch (validates the effective range, not the patch)', () => {
    const { r, t } = seedAlloc()
    const a = s().addAllocation({ resourceId: r.id, activityId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' })
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
    // 'Keep' replaced by the imported client; import also guarantees one built-in Internal client.
    expect(s().data.clients.filter((c) => !c.builtin).map((c) => c.name)).toEqual(['Imported'])
    expect(s().data.clients.filter((c) => c.builtin)).toHaveLength(1)
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

// The store re-validates the EFFECTIVE MERGED row on every update*, exactly as the SQLite server's
// validateWrite re-validates the full {...existing, ...patch} row on every write. A note/status/
// date-only edit of a row whose resource is EXTERNAL with a non-zero load / any external time-off
// (legacy pre-v0.8.1 data, or after a resource kind-flip) must therefore be REJECTED by the store too
// — otherwise it succeeds locally and 400s on the server, diverging local and synced state. The
// invalid states below can't be CREATED through add* (they'd be rejected), so they're built directly
// via replaceAll to mimic legacy/kind-flipped data already in the store.
describe('update* re-validates the merged row so the store + server agree', () => {
  const TS = '2026-05-01T00:00:00.000Z'

  const externalResource = (id: string): Resource => ({
    id,
    accountId: DEFAULT_ACCOUNT_ID,
    createdAt: TS,
    updatedAt: TS,
    kind: 'external',
    name: 'Outsource Co',
    role: 'Overflow',
    employmentType: 'permanent',
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    color: '#333333',
  })

  it('a normal-resource note/date-only updateAllocation + updateTimeOff still succeed (no false reject)', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    const a = s().addAllocation({ resourceId: r.id, activityId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' })
    // A note/date-only patch on a VALID (non-external) allocation must NOT be rejected even though
    // the merged-row check now runs unconditionally — assertAllocationRefs is pure & idempotent.
    expect(() => s().updateAllocation(a.id, { note: 'ping' })).not.toThrow()
    expect(() => s().updateAllocation(a.id, { startDate: '2026-06-02' })).not.toThrow()
    expect(s().data.allocations[0].note).toBe('ping')
    expect(s().data.allocations[0].startDate).toBe('2026-06-02')

    const to = s().addTimeOff({ resourceId: r.id, startDate: '2026-06-10', endDate: '2026-06-11', type: 'holiday' })
    expect(() => s().updateTimeOff(to.id, { type: 'sick' })).not.toThrow()
    expect(() => s().updateTimeOff(to.id, { startDate: '2026-06-09' })).not.toThrow()
    expect(s().data.timeOff[0].type).toBe('sick')
  })

  it('a note-only updateAllocation on an external resource carrying a non-zero load now THROWS (matches the server)', () => {
    const ext = externalResource('ext-1')
    const alloc: Allocation = {
      id: 'alloc-1',
      accountId: DEFAULT_ACCOUNT_ID,
      createdAt: TS,
      updatedAt: TS,
      resourceId: ext.id,
      activityId: 'act-1',
      startDate: '2026-06-01',
      endDate: '2026-06-03',
      // Legacy / kind-flip data: an external resource with a non-zero load — invalid under the
      // v0.8.1 capacity-free rule. The form/store could never CREATE this; it predates the rule.
      hoursPerDay: 8,
      status: 'confirmed',
    }
    const data: AppData = makeAppData({
      resources: [ext],
      activities: [{ id: 'act-1', accountId: DEFAULT_ACCOUNT_ID, createdAt: TS, updatedAt: TS, name: 'Repeatable', kind: 'repeatable' }],
      allocations: [alloc],
    })
    s().replaceAll(data)
    s().setActiveAccount(DEFAULT_ACCOUNT_ID)

    // A note-only patch touches none of resourceId/activityId/hoursPerDay, yet the merged row still
    // references an external resource with a non-zero load — the server 400s, so the store must too.
    expect(() => s().updateAllocation(alloc.id, { note: 'just a note' })).toThrow(/external.*can.t carry hours/i)
    // Atomic failure: the bad patch did NOT land (the producer threw before `set`).
    expect(s().data.allocations[0].note).toBeUndefined()
  })

  it('a date-only updateTimeOff on an external resource now THROWS (matches the server)', () => {
    const ext = externalResource('ext-2')
    const timeOff: TimeOff = {
      id: 'to-1',
      accountId: DEFAULT_ACCOUNT_ID,
      createdAt: TS,
      updatedAt: TS,
      resourceId: ext.id,
      startDate: '2026-06-10',
      endDate: '2026-06-12',
      type: 'holiday',
    }
    const data: AppData = makeAppData({ resources: [ext], timeOff: [timeOff] })
    s().replaceAll(data)
    s().setActiveAccount(DEFAULT_ACCOUNT_ID)

    // A date-only patch doesn't touch resourceId, yet time-off on an external resource is meaningless
    // (no capacity) — the server rejects it on every write, so the store now matches.
    expect(() => s().updateTimeOff(timeOff.id, { startDate: '2026-06-11' })).toThrow(/external.*3rd-party/i)
    expect(s().data.timeOff[0].startDate).toBe('2026-06-10') // unchanged — atomic failure
  })
})

// Flipping a resource's kind to 'external' AFTER it already owns loaded work / time-off would orphan
// those dependents (the scheduler hides external capacity + time-off) — recreating the invisible-orphan
// state v0.8.1 closed at the allocation/time-off write boundary. updateResource must REJECT the flip
// (reassign/remove first), throw-before-mutate, exactly as the server's validateWrite does.
describe('updateResource rejects a kind-flip-to-external that would orphan dependents', () => {
  it('flipping a person with a loaded allocation to external THROWS and does not mutate', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    s().addAllocation({ resourceId: r.id, activityId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' })

    expect(() => s().updateResource(r.id, { kind: 'external' })).toThrow(/work and time off before making it external/i)
    expect(s().data.resources[0].kind).toBe('person') // atomic failure — the flip did NOT land
  })

  it('flipping a person with time off to external THROWS', () => {
    const r = s().addResource({ ...personDraft, workingDays: [1, 2, 3, 4, 5] })
    s().addTimeOff({ resourceId: r.id, startDate: '2026-06-10', endDate: '2026-06-11', type: 'holiday' })

    expect(() => s().updateResource(r.id, { kind: 'external' })).toThrow(/work and time off before making it external/i)
    expect(s().data.resources[0].kind).toBe('person')
  })

  it('flipping a person with NO dependents (or only a zero-load allocation) to external SUCCEEDS', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    const free = s().addResource({ ...personDraft, name: 'Free', workingDays: [1, 2, 3, 4, 5] })
    expect(() => s().updateResource(free.id, { kind: 'external' })).not.toThrow()
    expect(s().data.resources.find((r) => r.id === free.id)?.kind).toBe('external')

    // A zero-load allocation is already valid for an external, so it must NOT block the flip.
    const z = s().addResource({ ...personDraft, name: 'Zero', workingDays: [1, 2, 3, 4, 5] })
    s().addAllocation({ resourceId: z.id, activityId: t.id, startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 0, status: 'confirmed' })
    expect(() => s().updateResource(z.id, { kind: 'external' })).not.toThrow()
    expect(s().data.resources.find((r) => r.id === z.id)?.kind).toBe('external')
  })

  it('editing an external resource’s OTHER fields (name) with no dependents still SUCCEEDS', () => {
    const ext = s().addResource({ ...personDraft, name: 'Outsource', kind: 'external', workingDays: [1, 2, 3, 4, 5] })
    expect(() => s().updateResource(ext.id, { name: 'Outsource Co' })).not.toThrow()
    expect(s().data.resources.find((r) => r.id === ext.id)?.name).toBe('Outsource Co')
  })
})
