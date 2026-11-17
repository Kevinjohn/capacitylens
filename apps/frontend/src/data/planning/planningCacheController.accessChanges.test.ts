import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyAppData } from '@capacitylens/shared/types/entities';
import type { PlanningTransport } from './planningCacheTypes';
import { setMasqueradeContextToken } from '@/api/masqueradeContext';
import {
  context,
  intent,
  inverse,
  canonicalData,
  companyToday,
  success,
  harness,
} from './planningCacheController.testSupport';

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
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
    });
    const first = h.controller.begin();
    await expect(h.controller.execute(first, intent, inverse)).rejects.toMatchObject({
      code: 'AUTHORIZATION_DENIED',
    });
    expect(h.state().planning.context).toEqual(context);
    const second = h.controller.begin();
    await expect(h.controller.execute(second, intent, inverse)).rejects.toMatchObject({
      code: 'ACCOUNT_MEMBERSHIP_LOST',
    });
    expect(h.state().planning.context).toEqual(context);
    expect(h.state().planning).toMatchObject({ status: 'refused', revision: 1 });
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
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
      accessKey: 'owner:private',
    });
    await h.controller.execute(h.controller.begin(), intent, inverse);
    const draft = h.controller.begin();
    expect(h.state().planning.history.past).toHaveLength(1);
    await expect(
      h.readSnapshot({
        revision: 2,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
        accessKey: 'editor:public',
      }),
    ).resolves.toBe(true);
    expect(h.state().planning.history.past).toHaveLength(0);
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toThrow();
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
        canWrite: true,
        data: cached,
        today: companyToday,
        accessKey: 'owner:private',
      }),
    ).resolves.toBe(true);
    expect(h.state().data.accounts).toHaveLength(1);
    await expect(
      h.readSnapshot({
        revision: 3,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
        accessKey: 'viewer:public',
      }),
    ).resolves.toBe(false);
    expect(h.state().data).toEqual(emptyAppData());
    expect(h.state().planning.revision).toBeNull();
    expect(h.state().planning.status).toBe('error');
  });

  it('keeps a refresh scoped for every 403, including membership loss', async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        revision: 1,
        canWrite: true,
        data: canonicalData(),
        today: companyToday,
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
    expect(h.state().planning).toMatchObject({ status: 'error', revision: 1 });
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
      canWrite: true,
      data: canonicalData(),
      today: companyToday,
    });
    await h.controller.execute(h.controller.begin(), intent, inverse);
    expect(h.state().planning.history.past).toHaveLength(1);
    const draft = h.controller.begin();
    await h.readSnapshot({
      revision: 1,
      canWrite: false,
      data: canonicalData(),
      today: companyToday,
    });
    expect(h.state().planning.history.past).toHaveLength(0);
    expect(() => h.controller.begin()).toThrow(/read-only/);
    await expect(h.controller.execute(draft, intent, inverse)).rejects.toThrow();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
