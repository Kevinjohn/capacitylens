import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { PlanningTransport } from './planningCacheTypes';
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
  it('keeps context and history for every 403 execute refusal, including membership loss', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce({ status: 403, code: 'AUTHORIZATION_DENIED' })
      .mockRejectedValueOnce({ status: 403, code: 'ACCOUNT_MEMBERSHIP_LOST' });
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
    const first = h.controller.begin();
    await expect(h.controller.execute(first, intent)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(h.state().planning.context).toEqual(context);
    const second = h.controller.begin();
    await expect(h.controller.execute(second, intent)).rejects.toMatchObject({
      code: 'ACCOUNT_MEMBERSHIP_LOST',
    });
    expect(h.state().planning.context).toEqual(context);
    expect(h.state().planning).toMatchObject({
      phase: { kind: 'ready', lastWrite: { kind: 'refused' } },
      revision: 1,
    });
  });

  it('invalidates drafts and history when the canonical access projection changes', async () => {
    const execute = vi.fn<PlanningTransport['execute']>((_context, execution) =>
      Promise.resolve(success(execution.mutationId, execution.baseRevision + 1)),
    );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({
      revision: 1,
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
      authority: makePlanningAuthority(),
    });
    await h.controller.execute(h.controller.begin(), intent);
    const draft = h.controller.begin();
    expect(h.state().planning.history.canUndo).toBe(true);
    await expect(
      h.readSnapshot({
        revision: 2,
        data: canonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
        authority: makePlanningAuthority({ role: 'editor' }),
      }),
    ).resolves.toBe(true);
    expect(h.state().planning.history.canUndo).toBe(false);
    await expect(h.controller.execute(draft, intent)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('drops the previous projection if an access change arrives with an older snapshot', async () => {
    const h = harness({
      execute: vi.fn<PlanningTransport['execute']>(),
      read: vi.fn<PlanningTransport['read']>(),
    });
    h.controller.setContext(context);
    const cached = canonicalData();
    await expect(
      h.readSnapshot({
        revision: 4,
        data: cached,
        today: companyToday,
        capacity: emptyCapacity(),
        authority: makePlanningAuthority(),
      }),
    ).resolves.toBe(true);
    expect(h.state().data.accounts).toHaveLength(1);
    await expect(
      h.readSnapshot({
        revision: 3,
        data: canonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
        authority: makePlanningAuthority({ role: 'viewer' }),
      }),
    ).resolves.toBe(false);
    expect(h.state().data).toEqual(emptyAppData());
    expect(h.state().planning.revision).toBeNull();
    expect(h.state().planning.phase.kind).toBe('failed');
  });

  it('keeps a refresh scoped for every 403, including membership loss', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        revision: 1,
        authority: makePlanningAuthority(),
        data: canonicalData(),
        today: companyToday,
        capacity: emptyCapacity(),
      })
      .mockRejectedValueOnce({ status: 403, code: 'AUTHORIZATION_DENIED' })
      .mockRejectedValueOnce({ status: 403, code: 'ACCOUNT_MEMBERSHIP_LOST' });
    const h = harness({
      execute: vi.fn<PlanningTransport['execute']>(),
      read,
    });
    h.controller.setContext(context);
    await h.controller.refresh();
    await h.controller.refresh();
    expect(h.state().planning.context).toEqual(context);
    await h.controller.refresh();
    expect(h.state().planning.context).toEqual(context);
    expect(h.state().planning).toMatchObject({ phase: { kind: 'failed' }, revision: 1 });
  });
});

describe('canonical planning write capability', () => {
  it('clears acknowledged history and invalidates drafts when the read becomes read-only', async () => {
    const execute = vi
      .fn<PlanningTransport['execute']>()
      .mockImplementation(async (_context, execution) =>
        success(execution.mutationId, execution.baseRevision + 1),
      );
    const h = harness({
      execute,
      read: vi.fn<PlanningTransport['read']>(),
    });
    h.controller.setContext(context);
    await h.readSnapshot({
      revision: 0,
      authority: makePlanningAuthority(),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    await h.controller.execute(h.controller.begin(), intent);
    expect(h.state().planning.history.canUndo).toBe(true);
    const draft = h.controller.begin();
    await h.readSnapshot({
      revision: 1,
      authority: makePlanningAuthority({ canWrite: false }),
      data: canonicalData(),
      today: companyToday,
      capacity: emptyCapacity(),
    });
    expect(h.state().planning.history.canUndo).toBe(false);
    expect(() => h.controller.begin()).toThrow(/read-only/);
    await expect(h.controller.execute(draft, intent)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
