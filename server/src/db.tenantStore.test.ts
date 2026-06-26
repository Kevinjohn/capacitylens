import { describe, it, expect } from 'vitest'
import type { AppData } from '@capacitylens/shared/types/entities'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { openDb, insertAll, loadState, readSlice } from './db'
import { sqliteTenantStore } from './tenantStore'

// P1.4: prove the per-account scoped read primitive (readSlice) + the TenantStore seam isolate one
// account's slice and NEVER leak another tenant's rows — the no-cross-tenant invariant the whole
// tenancy seam rests on. Mirrors app.test.ts's openDb(':memory:') + plain-row fixture pattern; seeds
// directly via insertAll (parent-first) so it tests the db layer, not the routes.

const TS = '2026-01-01T00:00:00.000Z'
const meta = () => ({ createdAt: TS, updatedAt: TS })

const account = (id: string) => ({ id, name: `Studio ${id}`, color: '#3b82f6', ...meta() })
const client = (id: string, accountId: string) => ({ id, accountId, name: 'Acme', color: '#3b82f6', ...meta() })
const discipline = (id: string, accountId: string) => ({ id, accountId, name: 'Design', sortOrder: 0, ...meta() })
const project = (id: string, accountId: string, clientId: string) => ({ id, accountId, name: 'Web', clientId, color: '#3b82f6', ...meta() })
const phase = (id: string, accountId: string, projectId: string) => ({ id, accountId, name: 'Build', projectId, ...meta() })
const person = (id: string, accountId: string, disciplineId?: string) => ({
  id,
  accountId,
  kind: 'person',
  role: 'Designer',
  disciplineId,
  employmentType: 'permanent',
  workingHoursPerDay: 8,
  // json column — must round-trip through the codec.
  workingDays: [1, 2, 3, 4, 5],
  color: '#3b82f6',
  ...meta(),
})
const activity = (id: string, accountId: string, projectId: string) => ({ id, accountId, name: 'Activity', kind: 'project', projectId, ...meta() })
const allocation = (id: string, accountId: string, resourceId: string, activityId: string) => ({
  id,
  accountId,
  resourceId,
  activityId,
  startDate: '2026-01-01',
  endDate: '2026-01-05',
  hoursPerDay: 8,
  status: 'confirmed',
  // optional note + json ignoreWeekends — exercise the codec round-trip.
  note: 'hi',
  ignoreWeekends: true,
  ...meta(),
})
const timeOff = (id: string, accountId: string, resourceId: string) => ({
  id,
  accountId,
  resourceId,
  startDate: '2026-02-01',
  endDate: '2026-02-03',
  type: 'vacation',
  ...meta(),
})

/** A full two-account dataset: a1 and a2 each carry rows in every scoped table. */
function seedTwoAccounts(): AppData {
  const d = emptyAppData() as unknown as Record<string, unknown[]>
  d.accounts = [account('a1'), account('a2')]
  d.clients = [client('c1', 'a1'), client('c2', 'a2')]
  d.disciplines = [discipline('d1', 'a1'), discipline('d2', 'a2')]
  d.projects = [project('p1', 'a1', 'c1'), project('p2', 'a2', 'c2')]
  d.phases = [phase('ph1', 'a1', 'p1'), phase('ph2', 'a2', 'p2')]
  d.resources = [person('r1', 'a1', 'd1'), person('r2', 'a2', 'd2')]
  d.activities = [activity('act1', 'a1', 'p1'), activity('act2', 'a2', 'p2')]
  d.allocations = [allocation('al1', 'a1', 'r1', 'act1'), allocation('al2', 'a2', 'r2', 'act2')]
  d.timeOff = [timeOff('to1', 'a1', 'r1'), timeOff('to2', 'a2', 'r2')]
  return d as unknown as AppData
}

const SCOPED_KEYS = ['clients', 'disciplines', 'projects', 'phases', 'resources', 'activities', 'allocations', 'timeOff'] as const

describe('readSlice — tenant isolation', () => {
  it('returns ONLY the requested account in every table (a1)', () => {
    const db = openDb(':memory:')
    insertAll(db, seedTwoAccounts())
    const slice = readSlice(db, 'a1')
    expect(slice.accounts.map((a) => a.id)).toEqual(['a1'])
    for (const key of SCOPED_KEYS) {
      const rows = slice[key]
      expect(rows.length).toBe(1)
      // ZERO rows from a2 in any scoped table — the no-cross-tenant invariant.
      expect(rows.every((r) => (r as { accountId: string }).accountId === 'a1')).toBe(true)
    }
  })

  it('is symmetric for a2 (no a1 rows leak)', () => {
    const db = openDb(':memory:')
    insertAll(db, seedTwoAccounts())
    const slice = readSlice(db, 'a2')
    expect(slice.accounts.map((a) => a.id)).toEqual(['a2'])
    for (const key of SCOPED_KEYS) {
      expect(slice[key].every((r) => (r as { accountId: string }).accountId === 'a2')).toBe(true)
      expect(slice[key].some((r) => (r as { accountId: string }).accountId === 'a1')).toBe(false)
    }
  })

  it('unknown accountId → empty slice (accounts:[], every scoped array empty), no throw', () => {
    const db = openDb(':memory:')
    insertAll(db, seedTwoAccounts())
    const slice = readSlice(db, 'does-not-exist')
    expect(slice.accounts).toEqual([])
    for (const key of SCOPED_KEYS) expect(slice[key]).toEqual([])
    // Result has EVERY AppData key present (starts from emptyAppData), not a partial object.
    expect(Object.keys(slice).sort()).toEqual(Object.keys(emptyAppData()).sort())
  })

  it('round-trips optional + json columns through the codec', () => {
    const db = openDb(':memory:')
    insertAll(db, seedTwoAccounts())
    const slice = readSlice(db, 'a1')
    // workingDays json + omitted optionals survive exactly (deep-equals the seeded object).
    expect(slice.resources[0]).toEqual(person('r1', 'a1', 'd1'))
    // optional note + json ignoreWeekends survive.
    expect(slice.allocations[0]).toEqual(allocation('al1', 'a1', 'r1', 'act1'))
  })
})

describe('sqliteTenantStore', () => {
  it('readSlice(id) equals the standalone readSlice(db, id)', () => {
    const db = openDb(':memory:')
    insertAll(db, seedTwoAccounts())
    const storeSlice = sqliteTenantStore(db).readSlice('a1')
    expect(storeSlice).toEqual(readSlice(db, 'a1'))
  })

  it('write(id, slice) replaces ONLY that account; the other account is untouched', () => {
    const db = openDb(':memory:')
    insertAll(db, seedTwoAccounts())
    const store = sqliteTenantStore(db)

    // Replace a1's slice with a single new allocation (drop everything else of a1's).
    const next = emptyAppData() as unknown as Record<string, unknown[]>
    next.accounts = [account('a1')]
    next.clients = [client('c1', 'a1')]
    next.disciplines = [discipline('d1', 'a1')]
    next.projects = [project('p1', 'a1', 'c1')]
    next.resources = [person('r1', 'a1', 'd1')]
    next.activities = [activity('act1', 'a1', 'p1')]
    next.allocations = [allocation('al1b', 'a1', 'r1', 'act1')] // a NEW allocation id; old al1 must be gone
    store.write('a1', next as unknown as AppData)

    const a1 = store.readSlice('a1')
    expect(a1.allocations.map((r) => r.id)).toEqual(['al1b']) // a1's scoped rows were REPLACED
    expect(a1.phases).toEqual([]) // dropped phase ph1

    // a2 is fully intact — write touched ONLY a1's scoped rows.
    const a2 = store.readSlice('a2')
    expect(a2.accounts.map((a) => a.id)).toEqual(['a2'])
    for (const key of SCOPED_KEYS) {
      expect(a2[key].length).toBe(1)
      expect((a2[key][0] as { accountId: string }).accountId).toBe('a2')
    }
    // The global accounts row for a2 still loads from the whole tree.
    expect(loadState(db).accounts.map((a) => a.id).sort()).toEqual(['a1', 'a2'])
  })
})
