import { describe, expect, it } from 'vitest';
import { PlanningControllerError } from './planningCacheController';
import { uncertain } from '@/test/planningTransitionHarness';

// Pins the coordinator transitions that no other controller test asserts directly.

describe('planning reconciliation transitions', () => {
  it.each([
    { name: 'a revision other than base + 1', mutationId: 'mutation-1', revision: 5 },
    { name: 'another mutation id', mutationId: 'mutation-9', revision: 2 },
  ])(
    'keeps the write uncertain when lookup answers with $name',
    async ({ mutationId, revision }) => {
      const h = await uncertain();
      h.lookup.mockResolvedValueOnce({ status: 'committed', mutationId, revision });
      await expect(h.controller.reconcile()).resolves.toBe(false);
      expect(h.state().planning.status).toBe('uncertain');
      expect(h.state().planning.outcome?.kind).toBe('uncertain');
      expect(h.state().planning.pending?.commitment).toBeUndefined();
      expect(h.state().planning.error).toBeInstanceOf(PlanningControllerError);

      h.lookup.mockResolvedValueOnce({
        status: 'committed',
        mutationId: 'mutation-1',
        revision: 2,
      });
      h.server.revision = 2;
      await expect(h.controller.reconcile()).resolves.toBe(true);
      expect(h.state().planning).toMatchObject({ status: 'ready', pending: null, error: null });
      expect(h.execute).toHaveBeenCalledOnce();
    },
  );

  it('keeps an uncertain write reconcilable after its lookup request fails', async () => {
    const h = await uncertain();
    const failure = new TypeError('lookup unavailable');
    h.lookup.mockRejectedValueOnce(failure);
    await expect(h.controller.reconcile()).resolves.toBe(false);
    expect(h.state().planning).toMatchObject({ status: 'uncertain', error: failure });
    expect(h.state().planning.pending?.execution.mutationId).toBe('mutation-1');

    h.lookup.mockResolvedValueOnce({ status: 'unknown', mutationId: 'mutation-1' });
    await expect(h.controller.reconcile()).resolves.toBe(false);
    expect(h.state().planning.status).toBe('uncertain');
    expect(h.execute).toHaveBeenCalledOnce();
  });

  it('keeps the write unresolved and writes locked across failed and successful reads until lookup proves it', async () => {
    const h = await uncertain();
    h.read.mockRejectedValueOnce(new TypeError('focus read failed'));
    await h.controller.refresh();
    expect(h.state().planning.status).toBe('error');
    expect(h.state().planning.outcome?.kind).toBe('uncertain');
    expect(() => h.controller.begin({})).toThrow();

    await expect(h.controller.refresh()).resolves.toBe(true);
    expect(h.state().planning.outcome?.kind).toBe('uncertain');
    expect(() => h.controller.begin({})).toThrow();
    expect(h.execute).toHaveBeenCalledOnce();

    h.lookup.mockResolvedValueOnce({ status: 'committed', mutationId: 'mutation-1', revision: 2 });
    h.server.revision = 2;
    await expect(h.controller.reconcile()).resolves.toBe(true);
    expect(h.state().planning).toMatchObject({ status: 'ready', pending: null });
  });
});
