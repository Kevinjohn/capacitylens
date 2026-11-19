import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningSnapshot, PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import {
  context,
  intent,
  canonicalData,
  companyToday,
  makeReceipt,
  harness,
} from './planningCacheController.testSupport';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAuthority } from '@/test/planning/planningAuthorityFixtures';

afterEach(() => setMasqueradeContextToken(null));

describe('planning cache controller', () => {
  it('accepts a matching commitment after a read reaches the pending write revision, then clears history on a later external revision', async () => {
    let release!: (receipt: PlanningMutationSuccess) => void;
    const execute = vi.fn<PlanningTransport['execute']>(
      () =>
        new Promise<PlanningMutationSuccess>((resolve) => {
          release = resolve;
        }),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({
      revision: 1,
      authority: makePlanningAuthority(),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const draft = h.controller.begin();
    const write = h.controller.execute(draft, intent);
    await h.readSnapshot({
      revision: 2,
      authority: makePlanningAuthority(),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    expect(h.state().planning.history.canUndo).toBe(false);
    release(makeReceipt('mutation-1', 2));
    await write;
    expect(h.state().planning.history.canUndo).toBe(true);
    await h.readSnapshot({
      revision: 3,
      authority: makePlanningAuthority(),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    expect(h.state().planning.history.canUndo).toBe(false);
  });

  it.each([
    {},
    {
      revision: 2,
      authority: makePlanningAuthority(),
      data: { ...emptyAppData(), accounts: [{ id: 'other-company' }] },
      today: companyToday,
      capacity: emptyCapacity(),
    },
    {
      revision: 3,
      data: { ...emptyAppData(), accounts: [{ id: 'company-1', name: 'Unverified' }] },
      today: companyToday,
      capacity: emptyCapacity(),
    },
    {
      revision: 4,
      authority: makePlanningAuthority(),
      data: { ...canonicalData(), accounts: [] },
      today: companyToday,
      capacity: emptyCapacity(),
    },
    {
      revision: 5,
      authority: makePlanningAuthority(),
      data: {
        ...canonicalData(),
        accounts: [...canonicalData().accounts, ...canonicalData().accounts],
      },
      today: companyToday,
      capacity: emptyCapacity(),
    },
    { revision: 6, authority: makePlanningAuthority(), data: canonicalData(), today: '2026-02-30' },
    { revision: 7, authority: makePlanningAuthority(), data: canonicalData() },
  ])('surfaces invalid canonical reads instead of remaining loading: %j', async (snapshot) => {
    const read = vi.fn<PlanningTransport['read']>().mockResolvedValue(snapshot as PlanningSnapshot);
    const h = harness({ execute: vi.fn(), read });
    h.controller.setContext(context);
    await expect(h.controller.refresh()).resolves.toBe(false);
    expect(h.state().planning.status).toBe('error');
    expect(h.state().planning.error).toBeInstanceOf(Error);
    expect(h.state().data).toEqual(emptyAppData());
    expect(h.state().planning.authority).toBeNull();
    expect(h.state().planning.history.canUndo).toBe(false);
    expect(() => h.controller.begin()).toThrow(/read-only/);
  });
});
