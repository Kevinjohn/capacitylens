import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanningMutationSuccess } from '@/api/planningContracts';
import type { PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/auth/masqueradeContext';
import {
  context,
  intent,
  inverse,
  canonicalData,
  harness,
} from './planningCacheController.testSupport';

afterEach(() => setMasqueradeContextToken(null));

describe('planning cache controller', () => {
  it('treats an empty acknowledgement as uncertain instead of a declined restoration', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockResolvedValue(null as unknown as PlanningMutationSuccess);
    const h = harness({ execute, read: vi.fn(), lookup: vi.fn() });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 3, canWrite: true, data: canonicalData() });

    await expect(h.controller.execute(h.controller.begin(), intent, inverse)).rejects.toMatchObject(
      { uncertain: true },
    );
    expect(h.state().planning.status).toBe('uncertain');
    expect(h.state().planning.outcome?.kind).toBe('uncertain');
  });

  it('keeps unknown commitment uncertain and reconciles without resending', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue(new TypeError('offline'));
    const lookup = vi
      .fn<PlanningTransport['lookup']>()
      .mockResolvedValue({ status: 'unknown', mutationId: 'mutation-1' });
    const h = harness({ execute, read: vi.fn<PlanningTransport['read']>(), lookup });
    h.controller.setContext(context);
    await h.readSnapshot({ revision: 8, canWrite: true, data: canonicalData() });
    const draft = h.controller.begin();
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toMatchObject({
      uncertain: true,
    });
    expect(h.state().planning.pending?.execution.mutationId).toBe('mutation-1');
    await h.controller.reconcile();
    expect(h.state().planning.status).toBe('uncertain');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledWith(
      { ...context, masqueradeContextToken: null },
      'mutation-1',
      expect.any(AbortSignal),
    );
  });

  it.each([undefined, 'request_timeout'])(
    'reconciles HTTP 408 (%s) without releasing or resending the original attempt',
    async (code) => {
      const execute = vi
        .fn<PlanningTransport['execute']>()
        .mockRejectedValue({ status: 408, code });
      const lookup = vi
        .fn<PlanningTransport['lookup']>()
        .mockResolvedValueOnce({ status: 'unknown', mutationId: 'mutation-1' })
        .mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-1', revision: 9 });
      const h = harness({ execute, read: vi.fn<PlanningTransport['read']>(), lookup });
      h.controller.setContext(context);
      await h.readSnapshot({ revision: 8, canWrite: true, data: canonicalData() });
      await expect(
        h.controller.execute(h.controller.begin(), intent, inverse),
      ).rejects.toMatchObject({
        status: 408,
        uncertain: true,
      });
      const original = h.state().planning.pending?.execution;
      expect(original).toMatchObject({ mutationId: 'mutation-1', baseRevision: 8 });
      expect(h.state().planning.outcome).toEqual({ kind: 'uncertain', execution: original });
      expect(() => h.controller.begin()).toThrow();
      await expect(h.controller.reconcile()).resolves.toBe(false);
      expect(h.state().planning.pending?.execution).toBe(original);
      expect(() => h.controller.begin()).toThrow();
      await h.readSnapshot({ revision: 9, canWrite: true, data: canonicalData() });
      await expect(h.controller.reconcile()).resolves.toBe(true);
      expect(h.state().planning.status).toBe('ready');
      expect(h.state().planning.pending).toBeNull();
      expect(h.state().planning.history.past).toEqual([{ forward: intent, inverse }]);
      expect(execute).toHaveBeenCalledOnce();
      expect(lookup.mock.calls.map((call) => call[1])).toEqual(['mutation-1', 'mutation-1']);
    },
  );

  it('uses lookup after a duplicate-id 409 and recovers commitment from the base revision', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockRejectedValue({ status: 409, code: 'MUTATION_ID_REUSED' });
    const read = vi
      .fn()
      .mockResolvedValueOnce({ revision: 1, canWrite: true, data: canonicalData() })
      .mockResolvedValueOnce({ revision: 2, canWrite: true, data: canonicalData() });
    const lookup = vi.fn<PlanningTransport['lookup']>(async (_context, mutationId) => ({
      status: 'committed',
      mutationId,
      revision: 2,
    }));
    const h = harness({ execute, read, lookup });
    h.controller.setContext(context);
    await h.controller.refresh();
    await h.controller.execute(h.controller.begin(), intent, inverse);
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(h.state().planning.outcome).toMatchObject({ kind: 'acknowledged', revision: 2 });
    expect(h.state().planning.history.past).toHaveLength(1);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
