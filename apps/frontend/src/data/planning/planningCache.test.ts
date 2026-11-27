import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntent } from '@/api/planningContracts';
import type { PlanningTransport } from './planningCacheTypes';
import { readPlanningProblem } from './planningNotices';
import { setMasqueradeToken } from '@/api/masqueradeToken';
import {
  context,
  intent,
  makeCanonicalData,
  companyToday,
  makeReceipt,
  createHarness,
} from './planningCacheTestKit';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures';

afterEach(() => setMasqueradeToken(null));

describe('planning cache', () => {
  it('retains the draft revision through refresh and refuses the stale attempt without replay', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue({ status: 409, code: 'E_STALE_REVISION' });
    const read = vi.fn<PlanningTransport['read']>().mockResolvedValue({
      revision: 4,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const h = createHarness({ execute, read });
    h.cache.setContext(context);
    await h.readSnapshot({
      revision: 3,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const draft = h.cache.begin();
    await h.readSnapshot({
      revision: 4,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    expect(draft.baseRevision).toBe(3);
    await expect(h.cache.execute(draft, intent)).rejects.toMatchObject({
      code: 'E_STALE_REVISION',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[1].baseRevision).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('uses the final submitted intent with the revision captured when the gesture began', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue({ status: 409, code: 'E_STALE_REVISION' });
    const h = createHarness({
      execute,
      read: vi.fn<PlanningTransport['read']>().mockResolvedValue({
        revision: 2,
        access: makePlanningAccess(),
        data: makeCanonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
      }),
    });
    h.cache.setContext(context);
    await h.readSnapshot({
      revision: 1,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const gesture = h.cache.begin();
    await h.readSnapshot({
      revision: 2,
      access: makePlanningAccess(),
      data: makeCanonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const finalIntent = {
      operation: 'settings.update',
      changes: { timezone: 'Europe/Paris' },
    } as PlanningIntent;
    await expect(h.cache.execute(gesture, finalIntent)).rejects.toMatchObject({
      code: 'E_STALE_REVISION',
    });
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ baseRevision: 1, intent: finalIntent });
  });

  it('keeps acknowledged writes locked until every operation receives a canonical refresh', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        revision: 1,
        access: makePlanningAccess(),
        data: makeCanonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
      })
      .mockRejectedValueOnce(new TypeError('read unavailable'));
    const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
      Promise.resolve(makeReceipt(execution.mutationId, 2)),
    );
    const h = createHarness({ execute, read });
    h.cache.setContext(context);
    await h.cache.refresh();
    const draft = h.cache.begin();
    await expect(h.cache.execute(draft, intent)).resolves.toMatchObject({
      revision: 2,
    });
    const { phase } = h.state().planning;
    expect(phase).toMatchObject({ kind: 'writing', write: { commitment: { revision: 2 } } });
    expect(phase.kind === 'writing' && phase.readError).toBeInstanceOf(TypeError);
    expect(readPlanningProblem(h.state().planning)).toBe('unavailable');
    expect(() => h.cache.begin()).toThrow();
    await expect(h.cache.execute(draft, intent)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
