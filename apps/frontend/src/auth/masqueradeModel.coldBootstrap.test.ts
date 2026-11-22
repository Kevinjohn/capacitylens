import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeCompany, makeAppData, resetStoreWithCompany } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { state, inactiveStatus, createHarness } from './masqueradeModelTestKit';
import { createDeferred } from '@/test/createDeferred';

beforeEach(async () => {
  await resetStoreWithCompany();
  useStore.getState().setMasquerade({ kind: 'inactive' });
  useStore.getState().setNotice(null);
});

describe('MasqueradeModel', () => {
  it('discards a cold failed projection when validated server status says the masquerade ended', async () => {
    useStore.getState().clearPlanning();
    const { model } = createHarness({ readBootstrapCompany: vi.fn(async () => null) });
    await model.adoptStatus({ active: true, ...state });
    expect(useStore.getState().masquerade.kind).toBe('starting');
    await model.adoptStatus(inactiveStatus);
    expect(useStore.getState().masquerade.kind).toBe('inactive');
    expect(useStore.getState().activeCompanyId).toBeNull();
  });

  it('loads a cold validated masquerade from canonical company data before selecting it', async () => {
    useStore.getState().clearPlanning();
    const read = createDeferred<string | null>();
    const { model, dependencies } = createHarness({
      readBootstrapCompany: vi.fn(() => read.promise),
      reproject: vi.fn(async () => {
        useStore.setState({
          data: makeAppData({
            companies: [makeCompany({ id: 'a-studio', name: 'Wayne Enterprises' })],
          }),
        });
        return true;
      }),
    });
    const adoption = model.adoptStatus({ active: true, ...state });
    expect(useStore.getState().activeCompanyId).toBeNull();
    expect(useStore.getState().masquerade.kind).toBe('starting');
    read.resolve('Wayne Enterprises');
    await adoption;
    expect(dependencies.readBootstrapCompany).toHaveBeenCalledExactlyOnceWith('a-studio');
    expect(dependencies.reproject).toHaveBeenCalledExactlyOnceWith('a-studio', false);
    expect(useStore.getState().activeCompanyId).toBe('a-studio');
    expect(useStore.getState().masquerade.kind).toBe('active');
  });

  it('keeps a failed cold read gated and lets retry load the canonical company', async () => {
    useStore.getState().clearPlanning();
    const { model, dependencies } = createHarness({
      readBootstrapCompany: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('Wayne Enterprises'),
    });
    await model.adoptStatus({ active: true, ...state });
    expect(useStore.getState().masquerade.kind).toBe('starting');
    expect(useStore.getState().activeCompanyId).toBeNull();
    await expect(model.retryProjection()).resolves.toBe(true);
    expect(dependencies.readBootstrapCompany).toHaveBeenCalledTimes(2);
    expect(useStore.getState().masquerade.kind).toBe('active');
  });

  it('invalidates a deferred cold read on auth loss without republishing private state', async () => {
    useStore.getState().clearPlanning();
    const read = createDeferred<string | null>();
    const { model } = createHarness({ readBootstrapCompany: vi.fn(() => read.promise) });
    const adoption = model.adoptStatus({ active: true, ...state });
    model.invalidate();
    read.resolve('Wayne Enterprises');
    await adoption;
    expect(useStore.getState().activeCompanyId).toBeNull();
    expect(useStore.getState().companySummaries).toEqual([]);
    expect(useStore.getState().masquerade.kind).toBe('inactive');
  });
});
