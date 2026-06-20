import { describe, it, expect } from 'vitest'
import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertScopedRefs,
  deleteAccountCascade,
  findOwned,
  remapAndValidateImport,
} from './mutations'
import { emptyAppData, SCOPED_KEYS } from '../types/entities'
import type {
  Account,
  Allocation,
  AppData,
  Client,
  Discipline,
  ID,
  Phase,
  Project,
  Resource,
  Activity,
  TimeOff,
} from '../types/entities'

// These specs target the PURE domain mutations directly (no store, no React). The
// store and a future server both call this exact module, so locking the rules in
// here is what makes "server validation == client validation" free.

const TS = '2026-01-01T00:00:00.000Z'
const meta = (id: ID, accountId: ID) => ({ id, accountId, createdAt: TS, updatedAt: TS })

const account = (id: ID, name = 'Co'): Account => ({ id, name, color: '#3b82f6', createdAt: TS, updatedAt: TS })
const client = (id: ID, accountId: ID, name = 'Acme'): Client => ({ ...meta(id, accountId), name, color: '#3b82f6' })
const project = (id: ID, accountId: ID, clientId: ID): Project => ({ ...meta(id, accountId), name: 'Web', clientId, color: '#3b82f6' })
const phase = (id: ID, accountId: ID, projectId: ID): Phase => ({ ...meta(id, accountId), name: 'Discovery', projectId })
const activity = (id: ID, accountId: ID, projectId: ID, phaseId?: ID): Activity => ({ ...meta(id, accountId), name: 'Activity', kind: 'project', projectId, phaseId })
const person = (id: ID, accountId: ID): Resource => ({
  ...meta(id, accountId),
  kind: 'person',
  role: 'Designer',
  employmentType: 'permanent',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  color: '#3b82f6',
})
const discipline = (id: ID, accountId: ID): Discipline => ({
  ...meta(id, accountId),
  name: 'Design',
  sortOrder: 0,
})
const placeholder = (id: ID, accountId: ID, projectId?: ID): Resource => ({
  ...person(id, accountId),
  kind: 'placeholder',
  projectId,
})
const allocation = (id: ID, accountId: ID, resourceId: ID, activityId: ID, o: Partial<Allocation> = {}): Allocation => ({
  ...meta(id, accountId),
  resourceId,
  activityId,
  startDate: '2026-01-01',
  endDate: '2026-01-05',
  hoursPerDay: 8,
  status: 'confirmed',
  ...o,
})
const timeOff = (id: ID, accountId: ID, resourceId: ID, o: Partial<TimeOff> = {}): TimeOff => ({
  ...meta(id, accountId),
  resourceId,
  startDate: '2026-01-01',
  endDate: '2026-01-03',
  type: 'holiday',
  ...o,
})

const A1 = 'acct-1'
const A2 = 'acct-2'
const base = (): AppData => ({ ...emptyAppData(), accounts: [account(A1), account(A2)] })

describe('findOwned', () => {
  it('returns the row when it belongs to the active account', () => {
    const data = { ...base(), clients: [client('c1', A1)] }
    expect(findOwned(data, A1, 'clients', 'c1')?.id).toBe('c1')
  })

  it('returns null for an absent id (stale-id no-op contract)', () => {
    expect(findOwned(base(), A1, 'clients', 'missing')).toBeNull()
  })

  it('throws when the row belongs to another account', () => {
    const data = { ...base(), clients: [client('c1', A2)] }
    expect(() => findOwned(data, A1, 'clients', 'c1')).toThrow('That record does not belong to the active company.')
  })
})

describe('assertScopedRefs', () => {
  it('passes when a project references a client in the same account', () => {
    const data = { ...base(), clients: [client('c1', A1)] }
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'c1' })).not.toThrow()
  })

  it('throws when a project references a client in another account', () => {
    const data = { ...base(), clients: [client('c1', A2)] }
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'c1' })).toThrow(
      'Project must reference a client in this company.',
    )
  })

  it('only checks FK fields actually present (partial patch)', () => {
    // A patch with no clientId must not be rejected for omitting it.
    expect(() => assertScopedRefs(base(), A1, 'projects', { name: 'Renamed' })).not.toThrow()
  })

  it('throws when an activity phase belongs to another account', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [phase('ph1', A2, 'p1')],
    }
    expect(() => assertScopedRefs(data, A1, 'activities', { projectId: 'p1', phaseId: 'ph1' })).toThrow(
      'Activity phase must belong to this company.',
    )
  })

  it('throws when an activity phase belongs to a DIFFERENT project than the activity', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      phases: [phase('ph1', A1, 'p1')], // a phase of p1
    }
    // Activity is bound to p2 but references p1's phase — double-bound to two projects.
    expect(() => assertScopedRefs(data, A1, 'activities', { projectId: 'p2', phaseId: 'ph1' })).toThrow(
      'Activity phase must belong to the activity’s project.',
    )
  })

  it('throws when an activity carries a phase but no project', () => {
    const data = { ...base(), clients: [client('c1', A1)], projects: [project('p1', A1, 'c1')], phases: [phase('ph1', A1, 'p1')] }
    expect(() => assertScopedRefs(data, A1, 'activities', { phaseId: 'ph1' })).toThrow(
      'An activity with a phase must also belong to that phase’s project.',
    )
  })

  it('passes when an activity phase belongs to the activity’s own project', () => {
    const data = { ...base(), clients: [client('c1', A1)], projects: [project('p1', A1, 'c1')], phases: [phase('ph1', A1, 'p1')] }
    expect(() => assertScopedRefs(data, A1, 'activities', { projectId: 'p1', phaseId: 'ph1' })).not.toThrow()
  })

  it('throws when a project activity carries no project (kind coherence)', () => {
    const data = { ...base(), clients: [client('c1', A1)], projects: [project('p1', A1, 'c1')] }
    expect(() => assertScopedRefs(data, A1, 'activities', { kind: 'project', name: 'T' })).toThrow(
      'A project activity must be assigned to a project.',
    )
  })

  it('throws when an internal/repeatable activity carries a project or phase (kind coherence)', () => {
    const data = { ...base(), clients: [client('c1', A1)], projects: [project('p1', A1, 'c1')], phases: [phase('ph1', A1, 'p1')] }
    expect(() => assertScopedRefs(data, A1, 'activities', { kind: 'internal', projectId: 'p1' })).toThrow(
      'cannot belong to a project',
    )
    expect(() => assertScopedRefs(data, A1, 'activities', { kind: 'repeatable', phaseId: 'ph1' })).toThrow(
      'cannot belong to a phase',
    )
  })

  it('passes for a valid project-less internal activity', () => {
    expect(() => assertScopedRefs(base(), A1, 'activities', { kind: 'internal', name: 'Admin' })).not.toThrow()
  })

  it('throws when a placeholder is bound to a project in another account', () => {
    const data = { ...base(), clients: [client('c1', A2)], projects: [project('p1', A2, 'c1')] }
    expect(() => assertScopedRefs(data, A1, 'resources', { projectId: 'p1' })).toThrow(
      'Placeholder project must belong to this company.',
    )
  })
})

describe('assertAllocationRefs', () => {
  const world = (): AppData => ({
    ...base(),
    clients: [client('c1', A1)],
    projects: [project('p1', A1, 'c1')],
    activities: [activity('t1', A1, 'p1')],
    resources: [person('r1', A1)],
  })

  it('passes for a real resource + activity in the account', () => {
    expect(() => assertAllocationRefs(world(), A1, 'r1', 't1')).not.toThrow()
  })

  it('throws when the resource or activity is missing / cross-account', () => {
    expect(() => assertAllocationRefs(world(), A1, 'missing', 't1')).toThrow(
      'Allocation must reference an existing resource and activity in this company.',
    )
  })

  it('throws when a placeholder is assigned outside its bound project', () => {
    const data: AppData = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      activities: [activity('t2', A1, 'p2')],
      resources: [placeholder('ph', A1, 'p1')],
    }
    expect(() => assertAllocationRefs(data, A1, 'ph', 't2')).toThrow(
      'A placeholder can only be assigned to activities from its bound project.',
    )
  })
})

describe('assertDateRange', () => {
  it('passes for a valid forward range', () => {
    expect(() => assertDateRange('2026-01-01', '2026-01-05')).not.toThrow()
  })
  it('throws for a reversed range', () => {
    expect(() => assertDateRange('2026-01-05', '2026-01-01')).toThrow('End date cannot be before the start date.')
  })
  it('throws when an end is missing', () => {
    expect(() => assertDateRange('2026-01-01', undefined)).toThrow('Start and end dates are required.')
  })
})

describe('assertResourceExists', () => {
  it('passes when the resource is in the account', () => {
    const data = { ...base(), resources: [person('r1', A1)] }
    expect(() => assertResourceExists(data, A1, 'r1')).not.toThrow()
  })
  it('throws for a missing / cross-account resource', () => {
    const data = { ...base(), resources: [person('r1', A2)] }
    expect(() => assertResourceExists(data, A1, 'r1')).toThrow(
      'Time off must reference an existing resource in this company.',
    )
  })
})

describe('deleteAccountCascade', () => {
  it('drops the account and all its scoped rows, leaving other accounts intact', () => {
    const data: AppData = {
      ...base(),
      clients: [client('c1', A1), client('c2', A2)],
      projects: [project('p1', A1, 'c1')],
      activities: [activity('t1', A1, 'p1')],
      resources: [person('r1', A1)],
      allocations: [allocation('al1', A1, 'r1', 't1')],
      timeOff: [timeOff('to1', A1, 'r1')],
    }
    const next = deleteAccountCascade(data, A1)
    expect(next.accounts.map((a) => a.id)).toEqual([A2])
    expect(next.clients).toEqual([client('c2', A2)])
    expect(next.projects).toHaveLength(0)
    expect(next.activities).toHaveLength(0)
    expect(next.resources).toHaveLength(0)
    expect(next.allocations).toHaveLength(0)
    expect(next.timeOff).toHaveLength(0)
  })
})

describe('remapAndValidateImport', () => {
  const incoming = (): AppData => ({
    ...emptyAppData(),
    clients: [client('src-c', 'src-acct')],
    projects: [project('src-p', 'src-acct', 'src-c')],
    activities: [activity('src-t', 'src-acct', 'src-p')],
  })

  it('imports into the active account with FRESH ids and remapped foreign keys', () => {
    const { data, imported, skipped } = remapAndValidateImport(base(), A1, incoming(), TS)
    expect(imported).toBe(3)
    expect(skipped).toBe(0)
    const p = data.projects[0]
    const t = data.activities[0]
    expect(p.id).not.toBe('src-p') // fresh id
    expect(p.accountId).toBe(A1) // stamped active account
    expect(t.projectId).toBe(p.id) // FK rewired to the new project id
    expect(data.clients[0].id).not.toBe('src-c')
  })

  it('replaces only the active account slice; other accounts are untouched', () => {
    const start: AppData = { ...base(), clients: [client('keep', A2)] }
    const { data } = remapAndValidateImport(start, A1, incoming(), TS)
    expect(data.clients.some((c) => c.id === 'keep' && c.accountId === A2)).toBe(true)
    expect(data.clients.filter((c) => c.accountId === A1)).toHaveLength(1)
  })

  it('drops invalid allocations / time-off and reports the skipped count', () => {
    const bad: AppData = {
      ...emptyAppData(),
      clients: [client('src-c', 'src-acct')],
      projects: [project('src-p', 'src-acct', 'src-c')],
      activities: [activity('src-t', 'src-acct', 'src-p')],
      resources: [person('src-r', 'src-acct')],
      allocations: [
        allocation('ok', 'src-acct', 'src-r', 'src-t'),
        allocation('reversed', 'src-acct', 'src-r', 'src-t', { startDate: '2026-02-10', endDate: '2026-02-01' }),
        allocation('dangling', 'src-acct', 'src-r', 'no-such-activity'),
      ],
      timeOff: [timeOff('to-dangling', 'src-acct', 'no-such-resource')],
    }
    const { data, skipped } = remapAndValidateImport(base(), A1, bad, TS)
    expect(data.allocations).toHaveLength(1) // only the valid one survives
    expect(skipped).toBe(3) // 2 bad allocations + 1 dangling time-off
  })

  it('drops records with a dangling REQUIRED ref and unbinds a dangling OPTIONAL ref', () => {
    // A hand-edited file: a project/phase whose required parent is absent, and a
    // activity/resource pointing at an absent optional parent. The required-FK records
    // must be dropped (else they would hit the server DB's FK and fail the import);
    // the optional-FK records survive, unbound.
    const handEdited: AppData = {
      ...emptyAppData(),
      projects: [project('p-orphan', 'src', 'ghost-client')], // dropped: client absent
      phases: [phase('ph-orphan', 'src', 'ghost-project')], // dropped: project absent
      resources: [{ ...person('r1', 'src'), disciplineId: 'ghost-disc' }], // kept, unbound
      activities: [activity('t1', 'src', 'ghost-project', 'ghost-phase')], // kept, unbound to general
    }
    const { data, imported, skipped } = remapAndValidateImport(base(), A1, handEdited, TS)
    expect(data.projects).toHaveLength(0)
    expect(data.phases).toHaveLength(0)
    expect(data.resources).toHaveLength(1)
    expect(data.resources[0].disciplineId).toBeUndefined()
    expect(data.activities).toHaveLength(1)
    expect(data.activities[0].projectId).toBeUndefined() // unbound → project-less activity
    expect(data.activities[0].phaseId).toBeUndefined() // a project-less activity carries no phase
    expect(data.activities[0].kind).toBe('repeatable') // a project activity that loses its project becomes repeatable
    expect(imported).toBe(2) // resource + activity
    expect(skipped).toBe(2) // project + phase
  })

  it('keeps an allocation to an unbound placeholder when its activity is general', () => {
    // The placeholder's bound project is absent, so it unbinds. An allocation of it to
    // a (general) activity whose own project is also absent survives — a general activity is
    // allocatable to anyone, placeholders included.
    const handEdited: AppData = {
      ...emptyAppData(),
      resources: [placeholder('ph', 'src', 'ghost-project')], // unbinds (project absent)
      activities: [activity('t-general', 'src', 'ghost-project')], // unbinds to a general activity
      allocations: [allocation('al', 'src', 'ph', 't-general')],
    }
    const { data } = remapAndValidateImport(base(), A1, handEdited, TS)
    expect(data.resources[0].projectId).toBeUndefined()
    expect(data.activities[0].projectId).toBeUndefined()
    expect(data.allocations).toHaveLength(1) // unbound placeholder + general activity is allowed
  })

  it('drops an allocation to an unbound placeholder when its activity is project-bound', () => {
    // Same unbinding, but the activity keeps a SURVIVING project, so the placeholder rule
    // bites: an unbound placeholder may not take a project activity → the allocation drops.
    const handEdited: AppData = {
      ...emptyAppData(),
      clients: [client('c', 'src')],
      projects: [project('p', 'src', 'c')], // survives → t-proj stays project-bound
      activities: [activity('t-proj', 'src', 'p')],
      resources: [placeholder('ph', 'src', 'ghost-project')], // unbinds (project absent)
      allocations: [allocation('al', 'src', 'ph', 't-proj')],
    }
    const { data } = remapAndValidateImport(base(), A1, handEdited, TS)
    expect(data.resources[0].projectId).toBeUndefined()
    expect(data.activities[0].projectId).toBe(data.projects[0].id) // activity stays bound
    expect(data.allocations).toHaveLength(0) // placeholder rule drops the allocation
  })

  it('gives duplicate source ids DISTINCT fresh ids (no primary-key collision)', () => {
    const dup: AppData = {
      ...emptyAppData(),
      clients: [
        { ...client('dup', 'src'), name: 'First' },
        { ...client('dup', 'src'), name: 'Second' },
      ],
    }
    const { data, imported } = remapAndValidateImport(base(), A1, dup, TS)
    expect(imported).toBe(2)
    const brought = data.clients.filter((c) => c.accountId === A1)
    expect(brought).toHaveLength(2)
    expect(new Set(brought.map((c) => c.id)).size).toBe(2) // two distinct ids, not one shared id
    expect(brought.map((c) => c.name).sort()).toEqual(['First', 'Second'])
  })

  it('resolves a foreign key against its OWN table when a source id collides across tables', () => {
    // Corrupt file: a discipline and a client share source id 'X', and a project points at
    // clientId 'X'. A single GLOBAL id map would resolve 'X' to whichever table is processed
    // first (disciplines) and misroute the project's clientId to a non-client id, dropping
    // the project (required FK) and its subtree. Per-table maps resolve clientId via the
    // CLIENTS map, so the project survives and re-links to the imported client.
    const collide: AppData = {
      ...emptyAppData(),
      disciplines: [{ ...meta('X', 'src'), name: 'Design', sortOrder: 0 }],
      clients: [{ ...client('X', 'src'), name: 'Acme' }],
      projects: [project('src-p', 'src', 'X')],
    }
    const { data } = remapAndValidateImport(base(), A1, collide, TS)
    const proj = data.projects.find((p) => p.accountId === A1)
    const cli = data.clients.find((c) => c.accountId === A1)
    expect(proj).toBeDefined() // NOT dropped (old global map dropped it)
    expect(cli).toBeDefined()
    expect(proj?.clientId).toBe(cli?.id) // clientId re-linked to the imported CLIENT, not the discipline
  })

  it('stamps fresh createdAt/updatedAt on imported records (the store/server owns the clock)', () => {
    const NOW = '2030-06-15T12:00:00.000Z'
    const withOldTs: AppData = {
      ...emptyAppData(),
      clients: [{ ...client('src-c', 'src'), createdAt: '2000-01-01T00:00:00.000Z', updatedAt: '2000-01-01T00:00:00.000Z' }],
    }
    const { data } = remapAndValidateImport(base(), A1, withOldTs, NOW)
    const c = data.clients.find((x) => x.accountId === A1)
    expect(c?.createdAt).toBe(NOW)
    expect(c?.updatedAt).toBe(NOW)
  })

  it('unbinds an activity’s phase that belongs to a different project', () => {
    const handEdited: AppData = {
      ...emptyAppData(),
      clients: [client('c', 'src')],
      projects: [project('p1', 'src', 'c'), project('p2', 'src', 'c')],
      phases: [phase('ph1', 'src', 'p1')], // a phase OF p1
      activities: [activity('t', 'src', 'p2', 'ph1')], // bound to p2 but referencing p1's phase
    }
    const { data } = remapAndValidateImport(base(), A1, handEdited, TS)
    const t = data.activities.find((x) => x.accountId === A1)
    expect(t?.projectId).toBeDefined() // activity keeps its surviving project
    expect(t?.phaseId).toBeUndefined() // the incoherent phase is unbound
  })

  it('imports zero records for an empty dataset (caller refuses the wipe)', () => {
    const { imported, skipped } = remapAndValidateImport(base(), A1, emptyAppData(), TS)
    expect(imported).toBe(0)
    expect(skipped).toBe(0)
  })

  it('exhaustiveness: remapAndValidateImport output covers every scoped key (repair order completeness)', () => {
    // If a new scoped entity is added to SCOPED_KEYS but the import repair block inside
    // remapAndValidateImport is not updated, the new table's rows would be brought in
    // without referential repair. This test ensures the import survives and preserves
    // rows for every scoped table — a missing repair step silently drops or corrupts rows
    // in the affected table, causing this test to fail.
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [client('c', 'src')],
      disciplines: [discipline('d', 'src')],
      projects: [project('p', 'src', 'c')],
      phases: [phase('ph', 'src', 'p')],
      resources: [{ ...person('r', 'src'), disciplineId: 'd', projectId: 'p' }],
      activities: [activity('t', 'src', 'p', 'ph')],
      allocations: [allocation('al', 'src', 'r', 't')],
      timeOff: [timeOff('to', 'src', 'r')],
    }
    const { data, imported } = remapAndValidateImport(base(), A1, incoming, TS)
    // Every SCOPED_KEY must be present in the output and non-empty.
    for (const key of SCOPED_KEYS) {
      expect(data[key], `key "${key}" must be non-empty after import`).toHaveLength(1)
    }
    expect(imported).toBe(SCOPED_KEYS.length)
  })

  it('repairs an imported allocation’s unpadded dates instead of dropping it', () => {
    const handEdited: AppData = {
      ...emptyAppData(),
      clients: [client('c', 'src')],
      projects: [project('p', 'src', 'c')],
      activities: [activity('t', 'src', 'p')],
      resources: [person('r', 'src')],
      // single-digit month/day — would fail the YYYY-MM-DD range check if not normalized.
      allocations: [allocation('al', 'src', 'r', 't', { startDate: '2026-6-1', endDate: '2026-6-5' })],
    }
    const { data } = remapAndValidateImport(base(), A1, handEdited, TS)
    const a = data.allocations.find((x) => x.accountId === A1)
    expect(a).toBeDefined() // kept (repaired), not dropped
    expect(a?.startDate).toBe('2026-06-01')
    expect(a?.endDate).toBe('2026-06-05')
  })
})
