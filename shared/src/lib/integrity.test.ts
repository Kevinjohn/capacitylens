import { describe, it, expect } from 'vitest'
import {
  deleteClientCascade,
  deleteDisciplineCascade,
  deletePhaseCascade,
  deleteProjectCascade,
  deleteResourceCascade,
  deleteActivityCascade,
  isTemporary,
  isValidISODate,
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

// A small connected dataset: client c1 -> project p1 -> phase ph -> activities; allocations; a bound placeholder.
function sampleData(): AppData {
  return {
    ...emptyAppData(),
    disciplines: [{ id: 'd1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Design', sortOrder: 0 }],
    clients: [{ id: 'c1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#111' }],
    projects: [{ id: 'p1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Lightning', clientId: 'c1', color: '#222' }],
    phases: [{ id: 'phase1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Discovery', projectId: 'p1' }],
    activities: [
      { id: 't1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Wires', kind: 'project', projectId: 'p1', phaseId: 'phase1' },
      { id: 't2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Visual', kind: 'project', projectId: 'p1' },
    ],
    resources: [person({ id: 'r1', disciplineId: 'd1' }), placeholder({ id: 'ph1', projectId: 'p1', disciplineId: 'd1' })],
    allocations: [
      { id: 'a1', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't1', startDate: '2026-06-01', endDate: '2026-06-03', hoursPerDay: 8, status: 'confirmed' },
      { id: 'a2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'ph1', activityId: 't2', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
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

describe('isValidISODate', () => {
  it('accepts a real, zero-padded calendar date and rejects malformed / impossible ones', () => {
    expect(isValidISODate('2026-06-01')).toBe(true)
    expect(isValidISODate('nope')).toBe(false) // fails the shape regex
    expect(isValidISODate('2026-13-01')).toBe(false) // month 13 — round-trips to a different string
    expect(isValidISODate('2026-02-30')).toBe(false) // 30 Feb — never a real date
  })

  it('rejects a NON-STRING even when it stringifies to a valid-looking date', () => {
    // The `typeof s !== 'string'` guard must fire FIRST: parseDate() throws on a non-string
    // (`.split` on a number/array), so dropping the guard would surface a throw instead of a
    // clean `false`. An array like ['2026-06-01'] String()-coerces to a matching shape, so only
    // the type check — not the regex — protects the parse.
    expect(isValidISODate(null)).toBe(false)
    expect(isValidISODate(20260601)).toBe(false)
    expect(isValidISODate(['2026-06-01'])).toBe(false)
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
  it('rejects non-zero-padded and out-of-range dates (the invariant isWithin relies on)', () => {
    // A non-padded "2026-6-1" would break isWithin's lexicographic compare, so it must
    // never pass this write-boundary guard.
    expect(validateDateRange('2026-6-1', '2026-06-05').ok).toBe(false) // unpadded month/day
    expect(validateDateRange('2026-06-01', '2026-6-5').ok).toBe(false)
    expect(validateDateRange('2026-13-01', '2026-12-01').ok).toBe(false) // impossible month
    expect(validateDateRange('2026-02-30', '2026-03-05').ok).toBe(false) // 30 Feb rolls over
    // and the rejection names the calendar-date rule (not some other error)
    expect(validateDateRange('2026-13-01', '2026-12-01').errors[0]).toMatch(/valid calendar dates/i)
  })
})

describe('placeholder binding', () => {
  it('a person can be assigned any project activity', () => {
    expect(validateAllocationAssignment(person(), 'anything').ok).toBe(true)
  })

  it('a placeholder can only be assigned activities from its bound project', () => {
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

  it('distinguishes an UNBOUND placeholder from a wrong-project one by message', () => {
    // An unbound placeholder (no projectId) and one bound to the WRONG project both reject,
    // but with DIFFERENT reasons — so the `!resource.projectId` branch and each message string
    // are load-bearing, not interchangeable.
    expect(validateAllocationAssignment(placeholder({ projectId: undefined }), 'p1').errors[0]).toMatch(
      /not bound to a project/i,
    )
    expect(validateAllocationAssignment(placeholder({ projectId: 'p1' }), 'p2').errors[0]).toMatch(
      /only be assigned to activities from its bound project/i,
    )
  })

  it('a general (no-project) activity can be assigned to anyone — people and placeholders', () => {
    expect(validateAllocationAssignment(person(), undefined).ok).toBe(true)
    // The project restriction does not bite when the activity has no project.
    expect(validateAllocationAssignment(placeholder({ projectId: 'p1' }), undefined).ok).toBe(true)
    expect(validateAllocationAssignment(placeholder({ projectId: undefined }), undefined).ok).toBe(true)
  })
})

describe('cascade deletes', () => {
  it('deleteResourceCascade removes the resource, its allocations and time off', () => {
    const next = deleteResourceCascade(sampleData(), 'r1')
    expect(next.resources.map((r) => r.id)).toEqual(['ph1'])
    expect(next.allocations.map((a) => a.id)).toEqual(['a2'])
    expect(next.timeOff).toHaveLength(0)
  })

  it('deleteResourceCascade keeps allocations and time off belonging to OTHER resources', () => {
    // The filters must key on resourceId, not blanket-drop — a co-worker's time off survives.
    const data = sampleData()
    data.timeOff.push({ id: 'to2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'ph1', startDate: '2026-06-20', endDate: '2026-06-21', type: 'sick' })
    const next = deleteResourceCascade(data, 'r1')
    expect(next.timeOff.map((t) => t.id)).toEqual(['to2']) // r1's dropped, ph1's kept
    expect(next.allocations.map((a) => a.id)).toEqual(['a2']) // a1 (r1) dropped, a2 (ph1) kept
  })

  it('deleteActivityCascade removes the activity and its allocations', () => {
    const next = deleteActivityCascade(sampleData(), 't1')
    expect(next.activities.map((t) => t.id)).toEqual(['t2'])
    expect(next.allocations.map((a) => a.id)).toEqual(['a2'])
  })

  it('deletePhaseCascade ungroups activities but keeps them', () => {
    const next = deletePhaseCascade(sampleData(), 'phase1')
    expect(next.phases).toHaveLength(0)
    expect(next.activities.find((t) => t.id === 't1')!.phaseId).toBeUndefined()
    expect(next.activities).toHaveLength(2)
  })

  it('deletePhaseCascade only removes the TARGET phase and only ungroups ITS activities', () => {
    // A sibling phase survives untouched, and an activity grouped under the sibling keeps its
    // phaseId — only activities pointing at the deleted phase are ungrouped.
    const data = sampleData()
    data.phases.push({ id: 'phase2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Build', projectId: 'p1' })
    data.activities.push({ id: 't3', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Dev', kind: 'project', projectId: 'p1', phaseId: 'phase2' })
    const next = deletePhaseCascade(data, 'phase1')
    expect(next.phases.map((p) => p.id)).toEqual(['phase2']) // sibling phase kept
    expect(next.activities.find((t) => t.id === 't3')!.phaseId).toBe('phase2') // NOT ungrouped
    expect(next.activities.find((t) => t.id === 't1')!.phaseId).toBeUndefined() // was under phase1
  })

  it('deleteProjectCascade removes project, phases, activities, their allocations, and unbinds placeholders', () => {
    const next = deleteProjectCascade(sampleData(), 'p1')
    expect(next.projects).toHaveLength(0)
    expect(next.phases).toHaveLength(0)
    expect(next.activities).toHaveLength(0)
    expect(next.allocations).toHaveLength(0) // both allocations referenced p1 activities
    expect(next.resources.find((r) => r.id === 'ph1')!.projectId).toBeUndefined()
    expect(next.resources).toHaveLength(2) // resources are NOT deleted
  })

  it('deleteProjectCascade leaves general (no-project) activities and their allocations intact', () => {
    const data = sampleData()
    data.activities.push({ id: 't3', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Admin', kind: 'repeatable' })
    data.allocations.push({ id: 'a3', accountId: 'acct-test', createdAt: 't', updatedAt: 't', resourceId: 'r1', activityId: 't3', startDate: '2026-06-05', endDate: '2026-06-06', hoursPerDay: 8, status: 'confirmed' })
    const next = deleteProjectCascade(data, 'p1')
    expect(next.activities.map((t) => t.id)).toEqual(['t3'])
    expect(next.allocations.map((a) => a.id)).toEqual(['a3'])
  })

  it('deleteProjectCascade unbinds a surviving activity’s phaseId that pointed at a deleted phase', () => {
    // t-keep belongs to p2 but (incoherently) references phase ph-p1, which belongs to p1.
    // Deleting p1 removes ph-p1; t-keep must SURVIVE with its phaseId unbound — never a
    // dangling reference (mirrors the server FK's ON DELETE SET NULL).
    const data: AppData = {
      ...emptyAppData(),
      clients: [{ id: 'c1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'C', color: '#1' }],
      projects: [
        { id: 'p1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'P1', clientId: 'c1', color: '#1' },
        { id: 'p2', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'P2', clientId: 'c1', color: '#2' },
      ],
      phases: [{ id: 'ph-p1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'Ph', projectId: 'p1' }],
      activities: [{ id: 't-keep', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'Keep', kind: 'project', projectId: 'p2', phaseId: 'ph-p1' }],
    }
    const next = deleteProjectCascade(data, 'p1')
    const keep = next.activities.find((t) => t.id === 't-keep')
    expect(keep).toBeDefined() // survives — it belongs to p2
    expect(keep!.phaseId).toBeUndefined() // dangling phase reference unbound
    expect(next.phases).toHaveLength(0) // p1's phase removed
  })

  it('deleteProjectCascade spares a SIBLING project’s phases, activities, allocations and bound placeholder', () => {
    // Deleting p1 must touch ONLY p1's subtree: p2 and everything coherently under it survives,
    // and a coherent p2 activity keeps its (p2) phase — the removed-phase set must not over-collect.
    const data: AppData = {
      ...emptyAppData(),
      clients: [{ id: 'c1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'C', color: '#1' }],
      projects: [
        { id: 'p1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'P1', clientId: 'c1', color: '#1' },
        { id: 'p2', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'P2', clientId: 'c1', color: '#2' },
      ],
      phases: [
        { id: 'ph-p1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'Ph1', projectId: 'p1' },
        { id: 'ph-p2', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'Ph2', projectId: 'p2' },
      ],
      activities: [
        { id: 'a-p1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'A1', kind: 'project', projectId: 'p1', phaseId: 'ph-p1' },
        { id: 'a-p2', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'A2', kind: 'project', projectId: 'p2', phaseId: 'ph-p2' },
      ],
      allocations: [
        { id: 'al-p2', accountId: 'a', createdAt: 't', updatedAt: 't', resourceId: 'ph2', activityId: 'a-p2', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      ],
      resources: [placeholder({ id: 'ph2', projectId: 'p2' })],
    }
    const next = deleteProjectCascade(data, 'p1')
    expect(next.projects.map((p) => p.id)).toEqual(['p2']) // only p1 removed
    expect(next.phases.map((p) => p.id)).toEqual(['ph-p2']) // p2's phase kept
    expect(next.activities.map((t) => t.id)).toEqual(['a-p2']) // p1 activity removed, p2 kept
    expect(next.activities.find((t) => t.id === 'a-p2')!.phaseId).toBe('ph-p2') // coherent phase NOT unbound
    expect(next.allocations.map((a) => a.id)).toEqual(['al-p2']) // sibling allocation survives
    expect(next.resources.find((r) => r.id === 'ph2')!.projectId).toBe('p2') // p2 placeholder keeps binding
  })

  it('deleteClientCascade cascades through its projects', () => {
    const next = deleteClientCascade(sampleData(), 'c1')
    expect(next.clients).toHaveLength(0)
    expect(next.projects).toHaveLength(0)
    expect(next.activities).toHaveLength(0)
    expect(next.allocations).toHaveLength(0)
    expect(next.resources.find((r) => r.id === 'ph1')!.projectId).toBeUndefined()
  })

  it('deleteClientCascade removes ONLY the target client’s subtree, sparing a sibling client', () => {
    // Two clients; deleting c1 leaves c2's project/phase/activity/allocation/placeholder intact.
    // A c2 activity that (incoherently) points at a c1 phase SURVIVES with its phaseId unbound.
    const data: AppData = {
      ...emptyAppData(),
      clients: [
        { id: 'c1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'C1', color: '#1' },
        { id: 'c2', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'C2', color: '#2' },
      ],
      projects: [
        { id: 'p1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'P1', clientId: 'c1', color: '#1' },
        { id: 'p2', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'P2', clientId: 'c2', color: '#2' },
      ],
      phases: [
        { id: 'ph1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'Ph1', projectId: 'p1' },
        { id: 'ph2', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'Ph2', projectId: 'p2' },
      ],
      activities: [
        { id: 'a1', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'A1', kind: 'project', projectId: 'p1' },
        { id: 'a2', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'A2', kind: 'project', projectId: 'p2', phaseId: 'ph2' },
        { id: 'a3', accountId: 'a', createdAt: 't', updatedAt: 't', name: 'A3', kind: 'project', projectId: 'p2', phaseId: 'ph1' },
      ],
      allocations: [
        { id: 'al1', accountId: 'a', createdAt: 't', updatedAt: 't', resourceId: 'phc2', activityId: 'a1', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
        { id: 'al2', accountId: 'a', createdAt: 't', updatedAt: 't', resourceId: 'phc2', activityId: 'a2', startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' },
      ],
      resources: [placeholder({ id: 'phc1', projectId: 'p1' }), placeholder({ id: 'phc2', projectId: 'p2' })],
    }
    const next = deleteClientCascade(data, 'c1')
    expect(next.clients.map((c) => c.id)).toEqual(['c2'])
    expect(next.projects.map((p) => p.id)).toEqual(['p2'])
    expect(next.phases.map((p) => p.id)).toEqual(['ph2']) // c1's phase removed, c2's kept
    expect(next.activities.map((t) => t.id).sort()).toEqual(['a2', 'a3']) // a1 (c1) removed
    expect(next.activities.find((t) => t.id === 'a2')!.name).toBe('A2') // record kept whole, not blanked
    expect(next.activities.find((t) => t.id === 'a2')!.phaseId).toBe('ph2') // coherent phase NOT unbound
    expect(next.activities.find((t) => t.id === 'a3')!.phaseId).toBeUndefined() // dangling c1 phase unbound
    expect(next.allocations.map((a) => a.id)).toEqual(['al2']) // a1's allocation removed, a2's kept
    expect(next.resources.find((r) => r.id === 'phc1')!.projectId).toBeUndefined() // bound to removed p1
    expect(next.resources.find((r) => r.id === 'phc2')!.projectId).toBe('p2') // bound to surviving p2
  })

  it('deleteDisciplineCascade ungroups resources but keeps them', () => {
    const next = deleteDisciplineCascade(sampleData(), 'd1')
    expect(next.disciplines).toHaveLength(0)
    expect(next.resources.every((r) => r.disciplineId === undefined)).toBe(true)
    expect(next.resources).toHaveLength(2)
  })

  it('deleteDisciplineCascade keeps OTHER disciplines and only ungroups its own resources', () => {
    const data = sampleData()
    data.disciplines.push({ id: 'd2', accountId: 'acct-test', createdAt: 't', updatedAt: 't', name: 'Dev', sortOrder: 1 })
    data.resources.push(person({ id: 'r2', disciplineId: 'd2' }))
    const next = deleteDisciplineCascade(data, 'd1')
    expect(next.disciplines.map((d) => d.id)).toEqual(['d2']) // sibling discipline kept
    expect(next.resources.find((r) => r.id === 'r2')!.disciplineId).toBe('d2') // NOT ungrouped
    // r1 was in d1 → ungrouped, but kept as a whole record (not blanked to {})
    const r1 = next.resources.find((r) => r.id === 'r1')
    expect(r1!.disciplineId).toBeUndefined()
    expect(r1!.role).toBe('Senior Designer')
  })

  it('does not mutate the input', () => {
    const data = sampleData()
    const snapshot = JSON.stringify(data)
    deleteClientCascade(data, 'c1')
    expect(JSON.stringify(data)).toBe(snapshot)
  })
})
