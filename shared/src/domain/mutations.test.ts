import { describe, it, expect } from 'vitest'
import {
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
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
const external = (id: ID, accountId: ID): Resource => ({
  ...person(id, accountId),
  kind: 'external',
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

  it('treats a null FK as ABSENT — a null clientId is skipped, not rejected', () => {
    // present(field) must count null as absent (a SQLite/JSON round-trip yields null): the field
    // simply isn't validated, rather than being treated as a value and failing the in-account check.
    expect(() => assertScopedRefs(base(), A1, 'projects', { clientId: null })).not.toThrow()
  })

  it('rejects a project whose client id is ABSENT even though ANOTHER client belongs to the account', () => {
    // The in-account check must match the referenced id, not merely "does any row belong here": with a
    // valid A1 client present but a dangling reference, the FK is still unsatisfied and must throw.
    const data = { ...base(), clients: [client('c1', A1)] }
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'ghost' })).toThrow(
      'Project must reference a client in this company.',
    )
  })

  it('validates a phase’s projectId FK (throws cross-account, passes in-account)', () => {
    const cross = { ...base(), clients: [client('c1', A2)], projects: [project('p1', A2, 'c1')] }
    expect(() => assertScopedRefs(cross, A1, 'phases', { projectId: 'p1' })).toThrow(
      'Phase must reference a project in this company.',
    )
    const ok = { ...base(), clients: [client('c1', A1)], projects: [project('p1', A1, 'c1')] }
    expect(() => assertScopedRefs(ok, A1, 'phases', { projectId: 'p1' })).not.toThrow()
  })

  it('validates an activity’s projectId FK with its OWN message when a dangling project is referenced', () => {
    const data = { ...base(), clients: [client('c1', A1)] } // no projects at all
    expect(() => assertScopedRefs(data, A1, 'activities', { projectId: 'ghost' })).toThrow(
      'Activity must reference a project in this company.',
    )
  })

  it('rejects an activity whose phase id is ABSENT even though ANOTHER phase belongs to the account', () => {
    // The phase lookup must match the referenced id, not "any account phase": a dangling phaseId must
    // fail with the belong-to-company message even when a real phase exists in the account.
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [phase('ph1', A1, 'p1')],
    }
    expect(() => assertScopedRefs(data, A1, 'activities', { projectId: 'p1', phaseId: 'ph-absent' })).toThrow(
      'Activity phase must belong to this company.',
    )
  })

  it('an UNRECOGNISED activity kind is not treated as internal/repeatable (no false project rejection)', () => {
    // assertScopedRefs checks refs + coherence for the KNOWN kinds only; it does not police the kind
    // enum itself (sanitize does). An unknown kind carrying a valid project must pass the ref checks.
    const data = { ...base(), clients: [client('c1', A1)], projects: [project('p1', A1, 'c1')] }
    expect(() => assertScopedRefs(data, A1, 'activities', { kind: 'bogus', projectId: 'p1' })).not.toThrow()
  })

  it('validates a resource’s disciplineId FK with its own message (dangling discipline throws)', () => {
    const data = { ...base(), disciplines: [discipline('d1', A2)] } // discipline is in ANOTHER account
    expect(() => assertScopedRefs(data, A1, 'resources', { disciplineId: 'd1' })).toThrow(
      'Resource discipline must belong to this company.',
    )
  })

  // The unchanged-on-update relaxation (5th arg `existing`): in SERVER mode the client's hydrated
  // slice is ACTIVE-ONLY, so an unchanged parent id pointing at an ARCHIVED parent (absent from
  // `data`) must not block an unrelated edit. A CHANGED id is still validated strictly.
  describe('unchanged parent id on update (existing row passed)', () => {
    it('passes an UNCHANGED clientId even when the client is absent from data (archived parent)', () => {
      const existing = project('p1', A1, 'c-archived')
      // No clients at all — the archived parent was stripped from the slice.
      expect(() =>
        assertScopedRefs(base(), A1, 'projects', { name: 'Renamed', clientId: 'c-archived' }, existing),
      ).not.toThrow()
    })

    it('still rejects a CHANGED clientId that is absent from data', () => {
      const existing = project('p1', A1, 'c-archived')
      expect(() =>
        assertScopedRefs(base(), A1, 'projects', { clientId: 'c-other' }, existing),
      ).toThrow('Project must reference a client in this company.')
    })

    it('passes an UNCHANGED projectId+phaseId pair even when both are absent from data', () => {
      const existing = activity('t1', A1, 'p-archived', 'ph-archived')
      const merged = { ...existing, name: 'Renamed' }
      expect(() => assertScopedRefs(base(), A1, 'activities', merged, existing)).not.toThrow()
    })

    it('re-runs the full phase coherence check when the phaseId CHANGES', () => {
      const data = { ...base(), clients: [client('c1', A1)], projects: [project('p1', A1, 'c1')] }
      const existing = activity('t1', A1, 'p1', 'ph-old')
      const merged = { ...existing, phaseId: 'ph-new' } // changed → must resolve, and it can't
      expect(() => assertScopedRefs(data, A1, 'activities', merged, existing)).toThrow(
        'Activity phase must belong to this company.',
      )
    })

    it('passes an UNCHANGED placeholder projectId even when the project is absent from data', () => {
      const existing = placeholder('r1', A1, 'p-archived')
      expect(() =>
        assertScopedRefs(base(), A1, 'resources', { name: 'Renamed', projectId: 'p-archived' }, existing),
      ).not.toThrow()
    })

    it('without `existing` (an ADD) the check stays strict', () => {
      expect(() => assertScopedRefs(base(), A1, 'projects', { clientId: 'c-archived' })).toThrow(
        'Project must reference a client in this company.',
      )
    })
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
    expect(() => assertAllocationRefs(world(), A1, 'r1', 't1', 8)).not.toThrow()
  })

  it('throws when the resource or activity is missing / cross-account', () => {
    expect(() => assertAllocationRefs(world(), A1, 'missing', 't1', 8)).toThrow(
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
    expect(() => assertAllocationRefs(data, A1, 'ph', 't2', 8)).toThrow(
      'A placeholder can only be assigned to activities from its bound project.',
    )
  })

  it('rejects a non-zero load on an external / 3rd-party resource (no capacity)', () => {
    const data: AppData = { ...world(), resources: [external('ext', A1)] }
    expect(() => assertAllocationRefs(data, A1, 'ext', 't1', 8)).toThrow('can’t carry hours')
  })

  it('allows a zero load on an external resource (the external rule is always enforced)', () => {
    const data: AppData = { ...world(), resources: [external('ext', A1)] }
    expect(() => assertAllocationRefs(data, A1, 'ext', 't1', 0)).not.toThrow()
  })

  it('allows a non-zero load on a normal resource', () => {
    expect(() => assertAllocationRefs(world(), A1, 'r1', 't1', 8)).not.toThrow()
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
  it('throws for an external / 3rd-party resource (no capacity → no time off)', () => {
    const data = { ...base(), resources: [external('ext', A1)] }
    expect(() => assertResourceExists(data, A1, 'ext')).toThrow(
      'Time off can’t be recorded for an external / 3rd-party resource.',
    )
  })
})

describe('assertResourceKindAllowsDependents', () => {
  const reject = /reassign or remove this resource’s work and time off/i

  it('is a no-op when the merged kind is not external', () => {
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1)],
      activities: [activity('t1', A1, 'p1')],
      allocations: [allocation('al', A1, 'r1', 't1', { hoursPerDay: 8 })],
      timeOff: [timeOff('to', A1, 'r1')],
    }
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'person')).not.toThrow()
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'placeholder')).not.toThrow()
  })

  it('rejects making external a resource that still owns a loaded allocation', () => {
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1)],
      allocations: [allocation('al', A1, 'r1', 't1', { hoursPerDay: 8 })],
    }
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).toThrow(reject)
  })

  it('rejects making external a resource that still owns time off', () => {
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1)],
      timeOff: [timeOff('to', A1, 'r1')],
    }
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).toThrow(reject)
  })

  it('allows making external a resource whose only allocation carries a zero load (already valid for an external)', () => {
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1)],
      allocations: [allocation('al', A1, 'r1', 't1', { hoursPerDay: 0 })],
    }
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).not.toThrow()
  })

  it('allows making external a resource with no dependents', () => {
    const data: AppData = { ...base(), resources: [person('r1', A1)] }
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).not.toThrow()
  })

  it('only considers THIS resource’s dependents in THIS account', () => {
    // Another resource's loaded allocation + a same-id dependent in a different account must NOT block.
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1), person('other', A1)],
      allocations: [
        allocation('al', A1, 'other', 't1', { hoursPerDay: 8 }), // belongs to a DIFFERENT resource
        allocation('al2', A2, 'r1', 't1', { hoursPerDay: 8 }), // same resource id, DIFFERENT account
      ],
      timeOff: [timeOff('to', A2, 'r1')], // same resource id, DIFFERENT account
    }
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).not.toThrow()
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
    // The imported (non-builtin) client lands; import also guarantees one built-in Internal for A1.
    expect(data.clients.filter((c) => c.accountId === A1 && !c.builtin)).toHaveLength(1)
    expect(data.clients.filter((c) => c.accountId === A1 && c.builtin)).toHaveLength(1)
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

  it('skips null and primitive import rows instead of dereferencing them', () => {
    const malformed = {
      ...emptyAppData(),
      clients: [null, 42, client('src-c', 'src-acct')],
    } as unknown as AppData

    const { data, imported, skipped } = remapAndValidateImport(base(), A1, malformed, TS)

    expect(imported).toBe(1)
    expect(skipped).toBe(2)
    expect(data.clients.some((candidate) => !candidate.builtin && candidate.name === 'Acme')).toBe(true)
  })

  it('coerces an external resource’s allocation load to 0 and drops external time-off', () => {
    // A hand-edited file: an external resource carries a non-zero allocation load (impossible via the
    // form) and a time-off entry (meaningless — externals have no capacity). Import keeps the booking
    // but zeroes its load, and drops the time-off entirely (the same rule the write boundary rejects).
    const handEdited: AppData = {
      ...emptyAppData(),
      clients: [client('src-c', 'src-acct')],
      projects: [project('src-p', 'src-acct', 'src-c')],
      activities: [activity('src-t', 'src-acct', 'src-p')],
      resources: [external('src-ext', 'src-acct')],
      allocations: [allocation('al-ext', 'src-acct', 'src-ext', 'src-t', { hoursPerDay: 8 })],
      timeOff: [timeOff('to-ext', 'src-acct', 'src-ext')],
    }
    const { data } = remapAndValidateImport(base(), A1, handEdited, TS)
    expect(data.allocations).toHaveLength(1)
    expect(data.allocations[0].hoursPerDay).toBe(0) // load coerced — capacity-free resource
    expect(data.timeOff).toHaveLength(0) // external time-off dropped
  })

  it('obfuscates personal data on an imported deleted resource', () => {
    const deleted = {
      ...person('src-r', 'src-acct'),
      name: 'Named Person',
      role: 'Sensitive role',
      archivedAt: '2026-01-02T00:00:00.000Z',
      deletedAt: '2026-01-03T00:00:00.000Z',
    }
    const { data } = remapAndValidateImport(base(), A1, { ...emptyAppData(), resources: [deleted] }, TS)
    expect(data.resources).toHaveLength(1)
    expect(data.resources[0]).toMatchObject({ role: 'Sensitive role', deletedAt: deleted.deletedAt })
    expect(data.resources[0].name).toMatch(/^Removed person #[a-zA-Z0-9]{4}$/)
    expect(data.resources[0].name).not.toContain('Named Person')
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
    expect(imported).toBe(2) // the auto-added built-in Internal is infrastructure, not counted
    const brought = data.clients.filter((c) => c.accountId === A1 && !c.builtin)
    expect(brought).toHaveLength(2)
    expect(new Set(brought.map((c) => c.id)).size).toBe(2) // two distinct ids, not one shared id
    expect(brought.map((c) => c.name).sort()).toEqual(['First', 'Second'])
  })

  it('does not count an auto-added built-in Internal that the file already carries (no N+1 over-report)', () => {
    // A pre-v6 FULL export gets a builtin Internal synthesised by migrate BEFORE this import runs, so
    // the file reaching here already carries one. It must be KEPT (every account needs exactly one) but
    // NOT counted — `imported` reflects only the file's genuine non-builtin records.
    const withBuiltin: AppData = {
      ...emptyAppData(),
      clients: [
        { ...client('src-internal', 'src'), name: 'Internal', color: '#9c3ace', builtin: true },
        { ...client('src-c', 'src'), name: 'Acme' },
      ],
      projects: [project('src-p', 'src', 'src-c')],
    }
    const { data, imported, skipped } = remapAndValidateImport(base(), A1, withBuiltin, TS)
    expect(imported).toBe(2) // the real (non-builtin) client + project — NOT the builtin (would be 3)
    expect(skipped).toBe(0)
    // Exactly one builtin lands for A1 (the kept imported one), and it is NOT in the genuine count;
    // the one real non-builtin client (src-c) lands alongside it.
    expect(data.clients.filter((c) => c.accountId === A1 && c.builtin)).toHaveLength(1)
    expect(data.clients.filter((c) => c.accountId === A1 && !c.builtin)).toHaveLength(1)
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
    // Every SCOPED_KEY must be present in the output and non-empty. `clients` carries TWO rows: the
    // imported client plus the guaranteed built-in Internal (synthesised — the file had none).
    for (const key of SCOPED_KEYS) {
      const expectedLen = key === 'clients' ? 2 : 1
      expect(data[key], `key "${key}" must be non-empty after import`).toHaveLength(expectedLen)
    }
    // The synthesised Internal is bookkeeping, so the FILE'S record count is still SCOPED_KEYS.length.
    expect(imported).toBe(SCOPED_KEYS.length)
  })

  it('assigns a FRESH id to a record that arrives WITHOUT one (never leaves id undefined)', () => {
    // A hand-edited file can carry a record missing its id. It must still get a fresh newId() — not
    // land with an undefined primary key (which SQLite's NOT NULL would reject).
    const noId = { name: 'NoId', color: '#3b82f6', createdAt: TS, updatedAt: TS } as unknown as Client
    const incoming: AppData = { ...emptyAppData(), clients: [noId] }
    const { data } = remapAndValidateImport(base(), A1, incoming, TS)
    const brought = data.clients.find((c) => c.accountId === A1 && c.name === 'NoId')
    expect(brought).toBeDefined()
    expect(brought?.id).toBeTruthy() // a real fresh id, not undefined
  })

  it('KEEPS a resource’s valid discipline and a placeholder’s valid project (does not over-unbind)', () => {
    // The optional-FK repair must only unbind a DANGLING ref — a surviving discipline/project must be
    // retained (and remapped), not nuked to undefined.
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [client('c', 'src')],
      projects: [project('p', 'src', 'c')],
      disciplines: [discipline('d', 'src')],
      resources: [{ ...placeholder('ph', 'src', 'p'), disciplineId: 'd' }],
    }
    const { data } = remapAndValidateImport(base(), A1, incoming, TS)
    const r = data.resources.find((x) => x.accountId === A1)
    const proj = data.projects.find((x) => x.accountId === A1)
    const disc = data.disciplines.find((x) => x.accountId === A1)
    expect(r?.disciplineId).toBe(disc?.id) // valid discipline kept + remapped
    expect(r?.projectId).toBe(proj?.id) // valid placeholder project kept + remapped
  })

  it('KEEPS a project activity’s valid phase and its kind (no over-unbind, no re-classify)', () => {
    // A project activity whose phase belongs to its OWN project is coherent — the phase must stay, the
    // kind must remain 'project', and the projectId must be retained.
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [client('c', 'src')],
      projects: [project('p', 'src', 'c')],
      phases: [phase('ph', 'src', 'p')],
      activities: [activity('t', 'src', 'p', 'ph')],
    }
    const { data } = remapAndValidateImport(base(), A1, incoming, TS)
    const t = data.activities.find((x) => x.accountId === A1)
    const proj = data.projects.find((x) => x.accountId === A1)
    const ph = data.phases.find((x) => x.accountId === A1)
    expect(t?.kind).toBe('project') // not re-classified to repeatable
    expect(t?.projectId).toBe(proj?.id) // project kept
    expect(t?.phaseId).toBe(ph?.id) // coherent phase kept
  })

  it('STRIPS project + phase from an INTERNAL activity that carries them (kind coherence)', () => {
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [client('c', 'src')],
      projects: [project('p', 'src', 'c')],
      phases: [phase('ph', 'src', 'p')],
      activities: [{ ...activity('t', 'src', 'p', 'ph'), kind: 'internal' }],
    }
    const { data } = remapAndValidateImport(base(), A1, incoming, TS)
    const t = data.activities.find((x) => x.accountId === A1)
    expect(t?.kind).toBe('internal') // kind preserved
    expect(t?.projectId).toBeUndefined() // project stripped — a project-less kind carries neither
    expect(t?.phaseId).toBeUndefined()
  })

  it('STRIPS project + phase from a REPEATABLE activity that carries them (kind coherence)', () => {
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [client('c', 'src')],
      projects: [project('p', 'src', 'c')],
      phases: [phase('ph', 'src', 'p')],
      activities: [{ ...activity('t', 'src', 'p', 'ph'), kind: 'repeatable' }],
    }
    const { data } = remapAndValidateImport(base(), A1, incoming, TS)
    const t = data.activities.find((x) => x.accountId === A1)
    expect(t?.kind).toBe('repeatable')
    expect(t?.projectId).toBeUndefined()
    expect(t?.phaseId).toBeUndefined()
  })

  it('FOLDS duplicate imported built-in Internal clients into ONE and rewires their projects to it', () => {
    // A hand-edited / re-imported file with TWO builtins must be normalised to exactly one Internal;
    // anything that pointed at a folded-away builtin must be re-pointed at the kept one so it survives
    // the required-FK drop.
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [
        { ...client('b1', 'src'), name: 'Internal', color: '#9c3ace', builtin: true },
        { ...client('b2', 'src'), name: 'Internal', color: '#9c3ace', builtin: true },
      ],
      projects: [project('p', 'src', 'b2')], // under the SECOND (folded-away) builtin
    }
    const { data } = remapAndValidateImport(base(), A1, incoming, TS)
    const builtins = data.clients.filter((c) => c.accountId === A1 && c.builtin)
    expect(builtins).toHaveLength(1) // duplicates folded to one
    const proj = data.projects.find((p) => p.accountId === A1)
    expect(proj).toBeDefined() // rewired to the kept Internal ⇒ survives the required-FK drop
    expect(proj?.clientId).toBe(builtins[0].id)
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
