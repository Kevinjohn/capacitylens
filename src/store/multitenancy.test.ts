import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { scopeData } from './selectors'
import { emptyAppData } from '../types/entities'
import type { AppData } from '../types/entities'
import { makeAccount } from '../test/fixtures'

const s = () => useStore.getState()

// Two accounts, each with one client + one project, used to prove isolation.
function twoAccountData(): AppData {
  return {
    ...emptyAppData(),
    accounts: [makeAccount({ id: 'a1', name: 'One' }), makeAccount({ id: 'a2', name: 'Two' })],
    clients: [
      { id: 'c1', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Client A1', color: '#1' },
      { id: 'c2', accountId: 'a2', createdAt: 't', updatedAt: 't', name: 'Client A2', color: '#2' },
    ],
    projects: [
      { id: 'p1', accountId: 'a1', createdAt: 't', updatedAt: 't', name: 'Proj A1', clientId: 'c1', color: '#1' },
      { id: 'p2', accountId: 'a2', createdAt: 't', updatedAt: 't', name: 'Proj A2', clientId: 'c2', color: '#2' },
    ],
  }
}

describe('scopeData', () => {
  it('returns only the matching account’s scoped entities and blanks the accounts list', () => {
    const scoped = scopeData(twoAccountData(), 'a1')
    expect(scoped.clients.map((c) => c.id)).toEqual(['c1'])
    expect(scoped.projects.map((p) => p.id)).toEqual(['p1'])
    expect(scoped.accounts).toEqual([])
  })

  it('returns empty slices for an unknown account', () => {
    const scoped = scopeData(twoAccountData(), 'nope')
    expect(scoped.clients).toEqual([])
    expect(scoped.projects).toEqual([])
  })
})

describe('account CRUD', () => {
  beforeEach(() => s().replaceAll(emptyAppData()))

  it('addAccount works with no active account (bootstraps the first tenant)', () => {
    expect(s().activeAccountId).toBeNull()
    const a = s().addAccount({ name: 'Acme Co', color: '#6366f1' })
    expect(a.id).toBeTruthy()
    expect(s().data.accounts).toHaveLength(1)
  })

  it('updateAccount renames', () => {
    const a = s().addAccount({ name: 'Old', color: '#1' })
    s().updateAccount(a.id, { name: 'New' })
    expect(s().data.accounts[0].name).toBe('New')
  })

  it('scoped add* throws without an active account', () => {
    expect(() => s().addClient({ name: 'X', color: '#1' })).toThrow()
  })

  it('deleteAccount cascade-drops all of that account’s scoped data and clears it if active', () => {
    s().replaceAll(twoAccountData())
    s().setActiveAccount('a1')
    s().deleteAccount('a1')
    expect(s().data.accounts.map((a) => a.id)).toEqual(['a2'])
    // a1's data is gone, a2's survives.
    expect(s().data.clients.map((c) => c.id)).toEqual(['c2'])
    expect(s().data.projects.map((p) => p.id)).toEqual(['p2'])
    // active account fell back to the picker.
    expect(s().activeAccountId).toBeNull()
  })

  it('deleting a non-active account leaves the active selection intact', () => {
    s().replaceAll(twoAccountData())
    s().setActiveAccount('a1')
    s().deleteAccount('a2')
    expect(s().activeAccountId).toBe('a1')
    expect(s().data.clients.map((c) => c.id)).toEqual(['c1'])
  })
})

describe('setActiveAccount resets per-account view state', () => {
  beforeEach(() => s().replaceAll(twoAccountData()))

  it('clears filters, collapsed groups, selection and history on switch', () => {
    s().setActiveAccount('a1')
    s().setFilters({ search: 'x' })
    s().toggleGroup('g')
    s().selectAllocation('alloc')
    s().addClient({ name: 'New', color: '#1' }) // pushes onto past
    expect(s().past.length).toBeGreaterThan(0)

    s().setActiveAccount('a2')
    expect(s().ui.filters.search).toBe('')
    expect(s().ui.collapsedGroups).toEqual([])
    expect(s().ui.selectedAllocationId).toBeNull()
    expect(s().past).toEqual([])
    expect(s().future).toEqual([])
  })
})

describe('importData (account-scoped)', () => {
  beforeEach(() => {
    s().replaceAll(twoAccountData())
    s().setActiveAccount('a1')
  })

  it('replaces only the active account’s slice, re-stamps incoming, keeps other accounts', () => {
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [{ id: 'imp-c', accountId: 'WRONG', createdAt: 't', updatedAt: 't', name: 'Imported', color: '#9' }],
    }
    s().importData(incoming)

    // a1's old client replaced by the imported one, re-stamped to a1.
    const a1Clients = s().data.clients.filter((c) => c.accountId === 'a1')
    expect(a1Clients.map((c) => c.name)).toEqual(['Imported'])
    expect(a1Clients[0].accountId).toBe('a1')
    // a2 untouched; accounts list untouched.
    expect(s().data.clients.some((c) => c.id === 'c2')).toBe(true)
    expect(s().data.accounts).toHaveLength(2)
  })

  it('gives imported entities fresh ids so a re-import into another account can’t corrupt the source', () => {
    // Import a file that reuses account a1's client id (c1) into a2.
    s().setActiveAccount('a2')
    s().importData({
      ...emptyAppData(),
      clients: [{ id: 'c1', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'Dupe', color: '#9' }],
    })
    // Editing the imported row in a2 must NOT touch a1's original c1.
    const importedId = s().data.clients.find((c) => c.accountId === 'a2')!.id
    expect(importedId).not.toBe('c1')
    s().updateClient(importedId, { name: 'Changed' })
    expect(s().data.clients.find((c) => c.accountId === 'a1')!.name).toBe('Client A1')
  })

  it('remaps foreign keys among imported entities to the new ids', () => {
    s().setActiveAccount('a2')
    s().importData({
      ...emptyAppData(),
      clients: [{ id: 'imp-c', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'C', color: '#1' }],
      projects: [{ id: 'imp-p', accountId: 'X', createdAt: 't', updatedAt: 't', name: 'P', clientId: 'imp-c', color: '#2' }],
    })
    const a2 = scopeData(s().data, 'a2')
    const client = a2.clients.find((c) => c.name === 'C')!
    const project = a2.projects.find((p) => p.name === 'P')!
    // The project's clientId was rewritten to the imported client's new id.
    expect(project.clientId).toBe(client.id)
    expect(client.id).not.toBe('imp-c')
  })

  it('is undoable via ⌘Z', () => {
    s().importData(emptyAppData())
    expect(s().data.clients.filter((c) => c.accountId === 'a1')).toHaveLength(0)
    s().undo()
    expect(s().data.clients.filter((c) => c.accountId === 'a1').map((c) => c.id)).toEqual(['c1'])
  })

  it('drops imported allocations/time-off that violate the integrity rules', () => {
    // The store is the integrity boundary on every write — import is no exception.
    const incoming: AppData = {
      ...emptyAppData(),
      clients: [{ id: 'old-c1', accountId: 'foreign', createdAt: 't', updatedAt: 't', name: 'Acme', color: '#ef4444' }],
      projects: [{ id: 'old-p1', accountId: 'foreign', createdAt: 't', updatedAt: 't', name: 'Site', clientId: 'old-c1', color: '#10b981' }],
      resources: [
        {
          id: 'old-r1',
          accountId: 'foreign',
          createdAt: 't',
          updatedAt: 't',
          kind: 'person',
          role: 'Dev',
          employmentType: 'permanent',
          workingHoursPerDay: 8,
          workingDays: [1, 2, 3, 4, 5],
          color: '#777777',
        },
      ],
      tasks: [{ id: 'old-t1', accountId: 'foreign', createdAt: 't', updatedAt: 't', name: 'Build', projectId: 'old-p1' }],
      allocations: [
        // valid
        { id: 'ok', accountId: 'foreign', createdAt: 't', updatedAt: 't', resourceId: 'old-r1', taskId: 'old-t1', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
        // reversed range — dropped
        { id: 'rev', accountId: 'foreign', createdAt: 't', updatedAt: 't', resourceId: 'old-r1', taskId: 'old-t1', startDate: '2026-06-05', endDate: '2026-06-01', hoursPerDay: 8, status: 'confirmed' },
        // dangling task — dropped
        { id: 'dangle', accountId: 'foreign', createdAt: 't', updatedAt: 't', resourceId: 'old-r1', taskId: 'missing', startDate: '2026-06-01', endDate: '2026-06-05', hoursPerDay: 8, status: 'confirmed' },
      ],
      timeOff: [
        // valid
        { id: 'to-ok', accountId: 'foreign', createdAt: 't', updatedAt: 't', resourceId: 'old-r1', startDate: '2026-07-01', endDate: '2026-07-03', type: 'holiday' },
        // dangling resource — dropped
        { id: 'to-bad', accountId: 'foreign', createdAt: 't', updatedAt: 't', resourceId: 'missing', startDate: '2026-07-01', endDate: '2026-07-03', type: 'holiday' },
      ],
    }
    s().importData(incoming)

    const a1Allocs = s().data.allocations.filter((a) => a.accountId === 'a1')
    const a1TimeOff = s().data.timeOff.filter((t) => t.accountId === 'a1')
    // Only the single valid allocation and time-off survive, remapped + scoped to a1
    // and still pointing at real imported entities.
    expect(a1Allocs).toHaveLength(1)
    expect(a1TimeOff).toHaveLength(1)
    expect(s().data.tasks.some((t) => t.id === a1Allocs[0].taskId)).toBe(true)
    expect(s().data.resources.some((r) => r.id === a1Allocs[0].resourceId)).toBe(true)
  })
})
