import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyAppData } from '@capacitylens/shared/types/entities'
import type { PlanningTransport } from './planningCacheTypes'
import { setMasqueradeToken } from '@/api/masqueradeToken'
import {
  context,
  intent,
  makeCanonicalData,
  companyToday,
  makeReceipt,
  createHarness,
} from './planningCacheTestKit'
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures'

afterEach(() => setMasqueradeToken(null))

describe('planning cache', () => {
  it('keeps context and history for every 403 execute refusal, including membership loss', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce({ status: 403, code: 'E_AUTHORIZATION_DENIED' })
      .mockRejectedValueOnce({ status: 403, code: 'E_ACCOUNT_MEMBERSHIP_LOST' })
    const h = createHarness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
    })
    h.cache.setContext(context)
    await h.readSnapshot({
      revision: 1,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
    })
    const first = h.cache.begin()
    await expect(h.cache.execute(first, intent)).rejects.toMatchObject({
      code: 'E_AUTHORIZATION_DENIED',
    })
    expect(h.state().planning.context).toEqual(context)
    const second = h.cache.begin()
    await expect(h.cache.execute(second, intent)).rejects.toMatchObject({
      code: 'E_ACCOUNT_MEMBERSHIP_LOST',
    })
    expect(h.state().planning.context).toEqual(context)
    expect(h.state().planning).toMatchObject({
      phase: { kind: 'ready', lastWrite: { kind: 'refused' } },
      revision: 1,
    })
  })

  it('invalidates drafts and history when the canonical access projection changes', async () => {
    const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
      Promise.resolve(makeReceipt(execution.mutationId, execution.baseRevision + 1))
    )
    const h = createHarness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
    })
    h.cache.setContext(context)
    await h.readSnapshot({
      revision: 1,
      data: makeCanonicalData(),
      today: companyToday,
      access: makePlanningAccess(),
    })
    await h.cache.execute(h.cache.begin(), intent)
    const draft = h.cache.begin()
    expect(h.state().planning.history.canUndo).toBe(true)
    await expect(
      h.readSnapshot({
        revision: 2,
        data: makeCanonicalData(),
        today: companyToday,
        access: makePlanningAccess({ role: 'editor' }),
      })
    ).resolves.toBe(true)
    expect(h.state().planning.history.canUndo).toBe(false)
    await expect(h.cache.execute(draft, intent)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('drops the previous projection if an access change arrives with an older snapshot', async () => {
    const h = createHarness({
      execute: vi.fn<PlanningTransport['execute']>(),
      read: vi.fn<PlanningTransport['read']>(),
    })
    h.cache.setContext(context)
    const cached = makeCanonicalData()
    await expect(
      h.readSnapshot({
        revision: 4,
        data: cached,
        today: companyToday,
        access: makePlanningAccess(),
      })
    ).resolves.toBe(true)
    expect(h.state().data.companies).toHaveLength(1)
    await expect(
      h.readSnapshot({
        revision: 3,
        data: makeCanonicalData(),
        today: companyToday,
        access: makePlanningAccess({ role: 'viewer' }),
      })
    ).resolves.toBe(false)
    expect(h.state().data).toEqual(createEmptyAppData())
    expect(h.state().planning.revision).toBeNull()
    expect(h.state().planning.phase.kind).toBe('failed')
  })

  it('keeps a refresh scoped for every 403, including membership loss', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        revision: 1,
        access: makePlanningAccess(),
        data: makeCanonicalData(),
        today: companyToday,
      })
      .mockRejectedValueOnce({ status: 403, code: 'E_AUTHORIZATION_DENIED' })
      .mockRejectedValueOnce({ status: 403, code: 'E_ACCOUNT_MEMBERSHIP_LOST' })
    const h = createHarness({
      execute: vi.fn<PlanningTransport['execute']>(),
      read,
    })
    h.cache.setContext(context)
    await h.cache.refresh()
    await h.cache.refresh()
    expect(h.state().planning.context).toEqual(context)
    await h.cache.refresh()
    expect(h.state().planning.context).toEqual(context)
    expect(h.state().planning).toMatchObject({ phase: { kind: 'failed' }, revision: 1 })
  })
})

describe('canonical planning write permission', () => {
  it('clears acknowledged history and invalidates drafts when the read becomes read-only', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockImplementation(async (_context, execution) =>
        makeReceipt(execution.mutationId, execution.baseRevision + 1)
      )
    const h = createHarness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
    })
    h.cache.setContext(context)
    await h.readSnapshot({
      revision: 0,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
    })
    await h.cache.execute(h.cache.begin(), intent)
    expect(h.state().planning.history.canUndo).toBe(true)
    const draft = h.cache.begin()
    await h.readSnapshot({
      revision: 1,
      access: makePlanningAccess({ canWrite: false }),
      data: makeCanonicalData(),
      today: companyToday,
    })
    expect(h.state().planning.history.canUndo).toBe(false)
    expect(() => h.cache.begin()).toThrow(/read-only/)
    await expect(h.cache.execute(draft, intent)).rejects.toThrow()
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
