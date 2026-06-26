import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './useStore'
import { activeOnly, lifecycleStatus, PURGE_MIN_AGE_DAYS } from '@capacitylens/shared/domain/lifecycle'
import { internalClientFor } from '@capacitylens/shared/data/internalClient'
import { addDaysISO, todayISO } from '@capacitylens/shared/lib/dateMath'
import type { Resource } from '@capacitylens/shared/types/entities'
import { makeResourceDraft, resetStoreWithAccount } from '../test/fixtures'

// Store-level coverage for the P2.5b data-lifecycle actions (the LOCAL/OFF-mode path): archiveEntity /
// unarchiveEntity / softDeleteEntity / purgeEntity. They COMPOSE the pure shared lifecycle helpers and
// mutate the local `data` blob through the same mutate()/undo machinery as the CRUD actions, so these
// specs mirror the existing store-test idiom (resetStoreWithAccount + s().data assertions).

const s = () => useStore.getState()

beforeEach(() => {
  resetStoreWithAccount()
  s().clearFilters()
})

// A correctly-typed person draft (Weekday[] working days) — the original name is the subject of the
// soft-delete PII-scrub assertion below.
const personDraft = makeResourceDraft({ name: 'Ada Lovelace' })

/** A timestamp older than the purge grace window (so canPurge passes). */
const longAgoISO = () => addDaysISO(todayISO(), -(PURGE_MIN_AGE_DAYS + 1)) + 'T00:00:00.000Z'

describe('archiveEntity', () => {
  it('sets archivedAt + stamps updatedAt; the row reads archived and is hidden from active views', () => {
    const r = s().addResource(personDraft)
    expect(lifecycleStatus(s().data.resources[0])).toBe('active')

    s().archiveEntity('resources', r.id)
    const row = s().data.resources.find((x) => x.id === r.id)!
    expect(row.archivedAt).toBeTruthy()
    expect(lifecycleStatus(row)).toBe('archived')
    // updatedAt is re-stamped to a fresh ISO timestamp. Deterministic: assert the SHAPE (a valid ISO
    // instant), not time progression — a same-millisecond run made the old `>=` check tautological +
    // a real-timer sleep made it flaky. archivedAt being set already proves the archive landed.
    expect(typeof row.updatedAt).toBe('string')
    expect(new Date(row.updatedAt).toISOString()).toBe(row.updatedAt) // round-trips → a valid ISO instant

    // Present in the RAW data, ABSENT from the active-only projection (and the live active hook source).
    expect(s().data.resources.some((x) => x.id === r.id)).toBe(true)
    expect(activeOnly(s().data).resources.some((x) => x.id === r.id)).toBe(false)
  })

  it('throws on a row that is already archived (defense-in-depth, no double-archive)', () => {
    const r = s().addResource(personDraft)
    s().archiveEntity('resources', r.id)
    expect(() => s().archiveEntity('resources', r.id)).toThrow(/already archived/i)
  })
})

describe('unarchiveEntity', () => {
  it('clears archivedAt → active + bumps updatedAt', () => {
    const r = s().addResource(personDraft)
    s().archiveEntity('resources', r.id)
    s().unarchiveEntity('resources', r.id)
    const row = s().data.resources.find((x) => x.id === r.id)!
    expect(row.archivedAt).toBeUndefined()
    expect(lifecycleStatus(row)).toBe('active')
    // Restored into the active view.
    expect(activeOnly(s().data).resources.some((x) => x.id === r.id)).toBe(true)
  })

  it('throws on a row that is not archived', () => {
    const r = s().addResource(personDraft)
    expect(() => s().unarchiveEntity('resources', r.id)).toThrow(/not archived/i)
  })
})

describe('softDeleteEntity', () => {
  it('throws unless the row is archived first (prior-archival rule)', () => {
    const r = s().addResource(personDraft)
    // Active, not archived → cannot delete directly.
    expect(() => s().softDeleteEntity('resources', r.id)).toThrow(/archived first/i)
    expect(s().data.resources[0].deletedAt).toBeUndefined()
  })

  it('on a RESOURCE, scrubs the name to "Removed person #…" (the load-bearing local PII erasure)', () => {
    const r = s().addResource(personDraft)
    s().archiveEntity('resources', r.id)
    s().softDeleteEntity('resources', r.id)
    const row = s().data.resources.find((x) => x.id === r.id)!
    expect(lifecycleStatus(row)).toBe('deleted')
    expect(row.deletedAt).toBeTruthy()
    expect(row.name).toMatch(/^Removed person #/)
    expect(row.name).not.toContain('Ada') // the original name is gone
  })

  it('on a non-resource (client/project), the name is unchanged', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    s().archiveEntity('clients', c.id)
    s().softDeleteEntity('clients', c.id)
    const row = s().data.clients.find((x) => x.id === c.id)!
    expect(lifecycleStatus(row)).toBe('deleted')
    expect(row.name).toBe('Acme')

    const c2 = s().addClient({ name: 'Beta', color: '#2' })
    const p = s().addProject({ name: 'Project X', clientId: c2.id, color: '#3' })
    s().archiveEntity('projects', p.id)
    s().softDeleteEntity('projects', p.id)
    const prow = s().data.projects.find((x) => x.id === p.id)!
    expect(lifecycleStatus(prow)).toBe('deleted')
    expect(prow.name).toBe('Project X')
  })
})

describe('purgeEntity', () => {
  it('does NOT purge a tombstone deleted < 30 days ago — fires a notice instead', () => {
    const r = s().addResource(personDraft)
    s().archiveEntity('resources', r.id)
    s().softDeleteEntity('resources', r.id) // deletedAt = now (well within the grace window)

    s().purgeEntity('resources', r.id)
    expect(s().data.resources.some((x) => x.id === r.id)).toBe(true) // still present
    expect(s().notice?.tone).toBe('error')
    expect(s().notice?.message).toMatch(/30 days/i)
  })

  it('purges a tombstone deleted ≥ 30 days ago AND cascades its children', () => {
    // Seed a resource with an allocation, then back-date the soft-delete past the grace window so
    // canPurge passes. Build the deleted state directly (the store owns the clock, so we can't fake
    // "30 days ago" through the live actions) and re-activate the account.
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    const r = s().addResource(personDraft)
    const a = s().addAllocation({ resourceId: r.id, activityId: t.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })
    expect(s().data.allocations).toHaveLength(1)

    // Mark the resource as a soft-deleted tombstone aged past the window (directly on the blob).
    const old = longAgoISO()
    const data = s().data
    s().replaceAll({
      ...data,
      resources: data.resources.map((res): Resource =>
        res.id === r.id ? { ...res, archivedAt: old, deletedAt: old } : res,
      ),
    })
    s().setActiveAccount(data.accounts[0].id)

    s().purgeEntity('resources', r.id)
    expect(s().data.resources.some((x) => x.id === r.id)).toBe(false) // row removed
    expect(s().data.allocations.some((x) => x.id === a.id)).toBe(false) // child allocation cascaded out
  })

  it('cascades a purged client through its projects/activities/allocations', () => {
    const c = s().addClient({ name: 'Acme', color: '#1' })
    const p = s().addProject({ name: 'P', clientId: c.id, color: '#2' })
    const t = s().addActivity({ name: 'T', kind: 'project', projectId: p.id })
    const r = s().addResource(personDraft)
    s().addAllocation({ resourceId: r.id, activityId: t.id, startDate: '2026-06-01', endDate: '2026-06-02', hoursPerDay: 8, status: 'confirmed' })

    const old = longAgoISO()
    const data = s().data
    s().replaceAll({
      ...data,
      clients: data.clients.map((cl) => (cl.id === c.id ? { ...cl, archivedAt: old, deletedAt: old } : cl)),
    })
    s().setActiveAccount(data.accounts[0].id)

    s().purgeEntity('clients', c.id)
    const d = s().data
    expect(d.clients.some((x) => x.id === c.id)).toBe(false)
    expect(d.projects).toHaveLength(0)
    expect(d.activities).toHaveLength(0)
    expect(d.allocations).toHaveLength(0)
    expect(d.resources).toHaveLength(1) // resources are not cascaded by a client purge
  })
})

describe('built-in Internal client is protected from every lifecycle action', () => {
  // resetStoreWithAccount seeds an account with NO clients, so mint the builtin via addAccount (the
  // privileged path) — matching internalClient.test.ts.
  const seedWithInternal = () => {
    s().replaceAll({ ...s().data, accounts: [], clients: [] })
    const a = s().addAccount({ name: 'Acme Co', color: '#6366f1' })
    s().setActiveAccount(a.id)
    return internalClientFor(s().data.clients, a.id)!
  }

  it('archiveEntity / softDeleteEntity / purgeEntity all THROW on the Internal client', () => {
    const internal = seedWithInternal()
    expect(() => s().archiveEntity('clients', internal.id)).toThrow(/built in/i)
    expect(() => s().softDeleteEntity('clients', internal.id)).toThrow(/built in/i)
    expect(() => s().purgeEntity('clients', internal.id)).toThrow(/built in/i)
    // Still present and active throughout.
    expect(internalClientFor(s().data.clients, internal.accountId)).toBeDefined()
    expect(lifecycleStatus(s().data.clients.find((x) => x.id === internal.id)!)).toBe('active')
  })
})

describe('viewer guard no-ops every lifecycle action (defense-in-depth)', () => {
  it('archive / unarchive / softDelete / purge all no-op for a viewer', () => {
    // Seed an archived row as an editor, then flip to viewer and prove no transition lands.
    const r = s().addResource(personDraft)
    s().archiveEntity('resources', r.id)
    const archivedAt = s().data.resources[0].archivedAt

    s().setActiveRole('viewer')
    s().unarchiveEntity('resources', r.id)
    expect(s().data.resources[0].archivedAt).toBe(archivedAt) // unchanged — still archived

    s().archiveEntity('resources', r.id) // already archived; a viewer must no-op BEFORE the throw
    expect(s().data.resources[0].archivedAt).toBe(archivedAt)

    s().softDeleteEntity('resources', r.id)
    expect(s().data.resources[0].deletedAt).toBeUndefined() // no tombstone

    s().purgeEntity('resources', r.id)
    expect(s().data.resources.some((x) => x.id === r.id)).toBe(true) // still present
    expect(s().notice?.message).toMatch(/read-only/i)
  })
})

describe('lifecycle actions are undoable (⌘Z)', () => {
  it('undo after archiveEntity restores the pre-archive (active) state', () => {
    const r = s().addResource(personDraft)
    expect(lifecycleStatus(s().data.resources[0])).toBe('active')

    s().archiveEntity('resources', r.id)
    expect(lifecycleStatus(s().data.resources[0])).toBe('archived')

    s().undo()
    const row = s().data.resources.find((x) => x.id === r.id)!
    expect(lifecycleStatus(row)).toBe('active')
    expect(row.archivedAt).toBeUndefined()
  })
})
