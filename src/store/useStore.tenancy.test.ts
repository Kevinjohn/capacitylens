import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { makeAccount, makeAppData } from '../test/fixtures'
import type { AppData } from '@capacitylens/shared/types/entities'

// The store is the strict per-account WRITE boundary: an update/delete must own
// the target row, and every foreign key on an add/update must point inside the
// active account. Reads are scoped elsewhere (useScopedData); these tests pin the
// write side, which forms can't reach but a direct call could.

const s = () => useStore.getState()

const A = 'acct-a'
const B = 'acct-b'

// Two accounts, with a client + project + activity + resource filed under B so we can
// try (and fail) to touch them while acting as A.
function twoAccountData(): AppData {
  return makeAppData({
    accounts: [makeAccount({ id: A, name: 'Company A' }), makeAccount({ id: B, name: 'Company B' })],
    clients: [{ id: 'cB', accountId: B, name: 'B Client', color: '#111111', createdAt: 't', updatedAt: 't' }],
    projects: [{ id: 'pB', accountId: B, name: 'B Project', clientId: 'cB', color: '#222222', createdAt: 't', updatedAt: 't' }],
    activities: [{ id: 'tB', accountId: B, name: 'B Activity', kind: 'project', projectId: 'pB', createdAt: 't', updatedAt: 't' }],
    resources: [
      {
        id: 'rB', accountId: B, kind: 'person', role: 'Dev', employmentType: 'permanent',
        workingHoursPerDay: 8, workingDays: [1, 2, 3, 4, 5], color: '#333333', createdAt: 't', updatedAt: 't',
      },
    ],
  })
}

beforeEach(() => {
  s().replaceAll(twoAccountData())
  s().setActiveAccount(A) // act as Company A throughout
})

describe('ownership guard on update/delete', () => {
  it('refuses to update a row owned by another account', () => {
    expect(() => s().updateClient('cB', { name: 'hijacked' })).toThrow()
    expect(s().data.clients.find((c) => c.id === 'cB')!.name).toBe('B Client')
  })

  it('refuses to archive a row owned by another account (cross-account lifecycle throw, no cascade)', () => {
    // The removal path is now the lifecycle machine (archive → soft-delete → purge), not an immediate
    // hard-delete. A lifecycle action targeting a row OWNED BY ANOTHER ACCOUNT is a tenancy violation:
    // findOwned THROWS a display-safe message (a cross-account id, unlike a stale/non-existent one).
    // The foreign row stays untouched (still active) and nothing cascades.
    expect(() => s().archiveEntity('projects', 'pB')).toThrow()
    const proj = s().data.projects.find((p) => p.id === 'pB')!
    expect(proj.archivedAt).toBeUndefined() // unchanged — not archived across the tenant boundary
    expect(s().data.activities.find((t) => t.id === 'tB')).toBeDefined()
  })

  it('treats a stale / non-existent id as a silent no-op (does not throw)', () => {
    // A drag committed after an undo, or a double Delete keypress, can target an id
    // that no longer exists. That must NOT throw (it fires from window listeners
    // outside React's error boundary) — only a cross-account hit is a violation.
    expect(() => s().updateAllocation('gone', { status: 'tentative' })).not.toThrow()
    expect(() => s().deleteAllocation('gone')).not.toThrow()
    expect(() => s().updateClient('gone', { name: 'x' })).not.toThrow()
    expect(() => s().archiveEntity('projects', 'gone')).not.toThrow()
    expect(() => s().updateTimeOff('gone', { type: 'sick' })).not.toThrow()
  })

  it('refuses to update/delete an allocation owned by another account', () => {
    const withAlloc = twoAccountData()
    withAlloc.allocations.push({
      id: 'aB', accountId: B, resourceId: 'rB', activityId: 'tB',
      startDate: '2026-01-01', endDate: '2026-01-02', hoursPerDay: 8, status: 'confirmed',
      createdAt: 't', updatedAt: 't',
    })
    s().replaceAll(withAlloc)
    s().setActiveAccount(A)
    expect(() => s().updateAllocation('aB', { status: 'tentative' })).toThrow()
    expect(() => s().deleteAllocation('aB')).toThrow()
    expect(s().data.allocations.find((a) => a.id === 'aB')!.status).toBe('confirmed')
  })
})

describe('foreign-key refs must stay in the active account', () => {
  it('addProject rejects a client from another account', () => {
    expect(() => s().addProject({ name: 'X', clientId: 'cB', color: '#444444' })).toThrow()
    expect(s().data.projects.some((p) => p.name === 'X')).toBe(false)
  })

  it('addActivity rejects a project from another account', () => {
    expect(() => s().addActivity({ name: 'X', kind: 'project', projectId: 'pB' })).toThrow()
  })

  it('addPhase rejects a project from another account', () => {
    expect(() => s().addPhase({ name: 'X', projectId: 'pB' })).toThrow()
  })

  it('addAllocation rejects a resource/activity from another account', () => {
    expect(() =>
      s().addAllocation({
        resourceId: 'rB', activityId: 'tB', startDate: '2026-01-01', endDate: '2026-01-02',
        hoursPerDay: 8, status: 'confirmed',
      }),
    ).toThrow()
    expect(s().data.allocations).toHaveLength(0)
  })

  it('addTimeOff rejects a resource from another account', () => {
    expect(() =>
      s().addTimeOff({ resourceId: 'rB', startDate: '2026-01-01', endDate: '2026-01-02', type: 'holiday' }),
    ).toThrow()
    expect(s().data.timeOff).toHaveLength(0)
  })

  it('still allows valid in-account references', () => {
    const c = s().addClient({ name: 'A Client', color: '#555555' })
    const p = s().addProject({ name: 'A Project', clientId: c.id, color: '#666666' })
    const t = s().addActivity({ name: 'An Activity', kind: 'project', projectId: p.id })
    expect(t.accountId).toBe(A)
    expect(s().data.projects.find((x) => x.id === p.id)!.clientId).toBe(c.id)
  })
})
