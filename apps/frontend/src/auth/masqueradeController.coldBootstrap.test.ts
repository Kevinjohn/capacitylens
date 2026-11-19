import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeAccount, makeAppData, resetStoreWithAccount } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { state, inactiveStatus, deferred, harness } from './masqueradeController.testSupport';

beforeEach(async () => {
  await resetStoreWithAccount();
  useStore.getState().setMasquerade({ kind: 'inactive' });
  useStore.getState().setNotice(null);
});

describe('MasqueradeController', () => {
  it('discards a cold failed projection when validated server status says the masquerade ended', async () => {
    useStore.getState().clearPlanning();
    const { controller } = harness({ readBootstrapAccount: vi.fn(async () => null) });
    await controller.adoptStatus({ active: true, ...state });
    expect(useStore.getState().masquerade.kind).toBe('starting');
    await controller.adoptStatus(inactiveStatus);
    expect(useStore.getState().masquerade.kind).toBe('inactive');
    expect(useStore.getState().activeCompanyId).toBeNull();
  });

  it('loads a cold validated member view from canonical account data before selecting it', async () => {
    useStore.getState().clearPlanning();
    const read = deferred<string | null>();
    const { controller, dependencies } = harness({
      readBootstrapAccount: vi.fn(() => read.promise),
      reproject: vi.fn(async () => {
        useStore.setState({
          data: makeAppData({
            accounts: [makeAccount({ id: 'a-studio', name: 'Wayne Enterprises' })],
          }),
        });
        return true;
      }),
    });
    const adoption = controller.adoptStatus({ active: true, ...state });
    expect(useStore.getState().activeCompanyId).toBeNull();
    expect(useStore.getState().masquerade.kind).toBe('starting');
    read.resolve('Wayne Enterprises');
    await adoption;
    expect(dependencies.readBootstrapAccount).toHaveBeenCalledExactlyOnceWith('a-studio');
    expect(dependencies.reproject).toHaveBeenCalledExactlyOnceWith('a-studio', false);
    expect(useStore.getState().activeCompanyId).toBe('a-studio');
    expect(useStore.getState().masquerade.kind).toBe('active');
  });

  it('keeps a failed cold read gated and lets retry load the canonical company', async () => {
    useStore.getState().clearPlanning();
    const { controller, dependencies } = harness({
      readBootstrapAccount: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('Wayne Enterprises'),
    });
    await controller.adoptStatus({ active: true, ...state });
    expect(useStore.getState().masquerade.kind).toBe('starting');
    expect(useStore.getState().activeCompanyId).toBeNull();
    await expect(controller.retryProjection()).resolves.toBe(true);
    expect(dependencies.readBootstrapAccount).toHaveBeenCalledTimes(2);
    expect(useStore.getState().masquerade.kind).toBe('active');
  });

  it('invalidates a deferred cold read on auth loss without republishing private state', async () => {
    useStore.getState().clearPlanning();
    const read = deferred<string | null>();
    const { controller } = harness({ readBootstrapAccount: vi.fn(() => read.promise) });
    const adoption = controller.adoptStatus({ active: true, ...state });
    controller.invalidate();
    read.resolve('Wayne Enterprises');
    await adoption;
    expect(useStore.getState().activeCompanyId).toBeNull();
    expect(useStore.getState().companySummaries).toEqual([]);
    expect(useStore.getState().masquerade.kind).toBe('inactive');
  });
});
