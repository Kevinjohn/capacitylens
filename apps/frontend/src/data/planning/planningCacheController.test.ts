import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningIntent } from '@/api/planningContracts';
import type { PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/auth/masqueradeContext';
import {
  context,
  intent,
  inverse,
  canonicalData,
  success,
  harness,
} from './planningCacheController.testSupport';

afterEach(() => setMasqueradeContextToken(null));

describe('planning cache controller', () => {
  it('retains the draft revision through refresh and refuses the stale attempt without replay', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue({ status: 409, code: 'STALE_REVISION' });
    const read = vi
      .fn<PlanningTransport['read']>()
      .mockResolvedValue({ revision: 4, canWrite: true, data: canonicalData() });
    const h = harness({ execute, read });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 3, canWrite: true, data: canonicalData() });
    const draft = h.controller.begin();
    await h.readSnapshot({ revision: 4, canWrite: true, data: canonicalData() });
    expect(draft.baseRevision).toBe(3);
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toMatchObject({
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
      read: vi
        .fn<PlanningTransport['read']>()
        .mockResolvedValue({ revision: 2, canWrite: true, data: canonicalData() }),
    });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 1, canWrite: true, data: canonicalData() });
    const gesture = h.controller.begin();
    await h.readSnapshot({ revision: 2, canWrite: true, data: canonicalData() });
    const finalIntent = {
      operation: 'settings.update',
      changes: { timezone: 'Europe/Paris' },
    } as PlanningIntent;
    await expect(h.controller.execute(gesture, finalIntent, inverse)).rejects.toMatchObject({
      code: 'STALE_REVISION',
    });
    expect(execute.mock.calls[0]?.[1]).toMatchObject({ baseRevision: 1, intent: finalIntent });
  });

  it('keeps acknowledged writes locked until every operation receives a canonical refresh', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, canWrite: true, data: canonicalData() })
      .mockRejectedValueOnce(new TypeError('read unavailable'));
    const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
      Promise.resolve(success(execution.mutationId, 2)),
    );
    const h = harness({ execute, read });
    h.controller.setContext(context);
    await h.controller.refresh();
    const draft = h.controller.begin();
    await expect(h.controller.execute(draft, intent, inverse)).resolves.toMatchObject({
      revision: 2,
    });
    expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision: 2 });
    expect(h.state().planning.status).toBe('error');
    expect(h.state().planning.pending).not.toBeNull();
    expect(() => h.controller.begin()).toThrow();
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
