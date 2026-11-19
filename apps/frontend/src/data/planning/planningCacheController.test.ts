import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntent } from '@/api/planningContracts';
import type { PlanningTransport } from './planningCacheTypes';
import { readPlanningProblem } from './planningNotices';
import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import {
  context,
  intent,
  canonicalData,
  companyToday,
  success,
  harness,
} from './planningCacheController.testSupport';
import { emptyCapacity } from '@/test/capacityFixtures';
import { makePlanningAuthority } from '@/test/planning/planningAuthorityFixtures';

afterEach(() => setMasqueradeContextToken(null));

describe('planning cache controller', () => {
  it('retains the draft revision through refresh and refuses the stale attempt without replay', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue({ status: 409, code: 'STALE_REVISION' });
    const read = vi.fn<PlanningTransport['read']>().mockResolvedValue({
      revision: 4,
      authority: makePlanningAuthority(),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const h = harness({ execute, read });
    h.controller.setContext(context);
    await h.readSnapshot({
      revision: 3,
      authority: makePlanningAuthority(),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const draft = h.controller.begin();
    await h.readSnapshot({
      revision: 4,
      authority: makePlanningAuthority(),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    expect(draft.baseRevision).toBe(3);
    await expect(h.controller.execute(draft, intent)).rejects.toMatchObject({
      code: 'STALE_REVISION',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]?.[1].baseRevision).toBe(3);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('uses the final submitted intent with the revision captured when the gesture began', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue({ status: 409, code: 'STALE_REVISION' });
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport['read']>().mockResolvedValue({
        revision: 2,
        authority: makePlanningAuthority(),
        data: canonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
      }),
    });
    h.controller.setContext(context);
    await h.readSnapshot({
      revision: 1,
      authority: makePlanningAuthority(),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const gesture = h.controller.begin();
    await h.readSnapshot({
      revision: 2,
      authority: makePlanningAuthority(),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    const finalIntent = {
      operation: 'settings.update',
      changes: { timezone: 'Europe/Paris' },
    } as PlanningIntent;
    await expect(h.controller.execute(gesture, finalIntent)).rejects.toMatchObject({
      code: 'STALE_REVISION',
    });
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ baseRevision: 1, intent: finalIntent });
  });

  it('keeps acknowledged writes locked until every operation receives a canonical refresh', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        revision: 1,
        authority: makePlanningAuthority(),
        data: canonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
      })
      .mockRejectedValueOnce(new TypeError('read unavailable'));
    const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
      Promise.resolve(success(execution.mutationId, 2)),
    );
    const h = harness({ execute, read });
    h.controller.setContext(context);
    await h.controller.refresh();
    const draft = h.controller.begin();
    await expect(h.controller.execute(draft, intent)).resolves.toMatchObject({
      revision: 2,
    });
    const { phase } = h.state().planning;
    expect(phase).toMatchObject({ kind: 'writing', write: { commitment: { revision: 2 } } });
    expect(phase.kind === 'writing' && phase.readError).toBeInstanceOf(TypeError);
    expect(readPlanningProblem(h.state().planning)).toBe('unavailable');
    expect(() => h.controller.begin()).toThrow();
    await expect(h.controller.execute(draft, intent)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
