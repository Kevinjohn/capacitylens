import { readPlanningError } from './planningNotices'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createEmptyAppData } from '@capacitylens/shared/types/entities'
import type { PlanningMutationSuccess } from '@/api/planningContracts'
import type { PlanningSnapshot, PlanningTransport } from './planningCacheTypes'
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
  it('accepts a matching commitment after a read reaches the pending write revision, then clears history on a later external revision', async () => {
    let release!: (receipt: PlanningMutationSuccess) => void
    const execute = vi.fn<PlanningTransport['execute']>(
      () =>
        new Promise<PlanningMutationSuccess>((resolve) => {
          release = resolve
        })
    )
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
    const draft = h.cache.begin()
    const write = h.cache.execute(draft, intent)
    await h.readSnapshot({
      revision: 2,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
    })
    expect(h.state().planning.history.canUndo).toBe(false)
    release(makeReceipt('mutation-1', 2))
    await write
    expect(h.state().planning.history.canUndo).toBe(true)
    await h.readSnapshot({
      revision: 3,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
    })
    expect(h.state().planning.history.canUndo).toBe(false)
  })

  it.each([
    {},
    {
      revision: 2,
      access: makePlanningAccess(),
      data: { ...createEmptyAppData(), companies: [{ id: 'other-company' }] },
      today: companyToday,
    },
    {
      revision: 3,
      data: { ...createEmptyAppData(), companies: [{ id: 'company-1', name: 'Unverified' }] },
      today: companyToday,
    },
    {
      revision: 4,
      access: makePlanningAccess(),
      data: { ...makeCanonicalData(), companies: [] },
      today: companyToday,
    },
    {
      revision: 5,
      access: makePlanningAccess(),
      data: {
        ...makeCanonicalData(),
        companies: [...makeCanonicalData().companies, ...makeCanonicalData().companies],
      },
      today: companyToday,
    },
    {
      revision: 6,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: '2026-02-30',
    },
    { revision: 7, access: makePlanningAccess(), data: makeCanonicalData() },
  ])('surfaces invalid canonical reads instead of remaining loading: %j', async (snapshot) => {
    const read = vi.fn<PlanningTransport['read']>().mockResolvedValue(snapshot as PlanningSnapshot)
    const h = createHarness({ execute: vi.fn(), read })
    h.cache.setContext(context)
    await expect(h.cache.refresh()).resolves.toBe(false)
    expect(h.state().planning.phase.kind).toBe('failed')
    expect(readPlanningError(h.state().planning.phase)).toBeInstanceOf(Error)
    expect(h.state().data).toEqual(createEmptyAppData())
    expect(h.state().planning.access).toBeNull()
    expect(h.state().planning.history.canUndo).toBe(false)
    expect(() => h.cache.begin()).toThrow(/read-only/)
  })
})
