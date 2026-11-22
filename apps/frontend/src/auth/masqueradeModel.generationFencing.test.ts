import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetStoreWithCompany } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { state, inactiveStatus, createHarness } from './masqueradeModelTestKit';
import { createDeferred } from '@/test/createDeferred';

beforeEach(async () => {
  await resetStoreWithCompany();
  useStore.getState().setMasquerade({ kind: 'inactive' });
  useStore.getState().setNotice(null);
});

describe('MasqueradeModel transitions', () => {
  it('does not let a stale start rejection overwrite server-end restoration', async () => {
    const initialProjection = createDeferred<boolean>();
    const reproject = vi
      .fn()
      .mockImplementationOnce(() => initialProjection.promise)
      .mockResolvedValueOnce(true);
    const { model, resume } = createHarness({ reproject });

    const starting = model.start(state.companyId, state.targetUserId);
    await vi.waitFor(() =>
      expect(useStore.getState().masquerade).toMatchObject({ kind: 'starting', state }),
    );
    await model.adoptStatus(inactiveStatus);
    await vi.waitFor(() => expect(useStore.getState().masquerade).toEqual({ kind: 'inactive' }));
    useStore.getState().setNotice('newer transition', 'info');

    initialProjection.reject(new Error('stale projection failure'));
    await expect(starting).resolves.toBe(false);
    expect(useStore.getState().notice).toMatchObject({ message: 'newer transition', tone: 'info' });
    expect(resume).toHaveBeenCalledOnce();
  });
});

describe('MasqueradeModel generation fencing', () => {
  it('does not let a projection retry publish after an explicit end', async () => {
    const retryProjection = createDeferred<boolean>();
    const reproject = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockImplementationOnce(() => retryProjection.promise)
      .mockResolvedValueOnce(true);
    const { model } = createHarness({ reproject });
    await model.start(state.companyId, state.targetUserId);

    const retrying = model.retryProjection();
    await vi.waitFor(() => expect(reproject).toHaveBeenCalledTimes(2));
    await expect(model.end()).resolves.toBe(true);
    retryProjection.resolve(true);

    await expect(retrying).resolves.toBe(false);
    expect(useStore.getState().masquerade).toEqual({ kind: 'inactive' });
  });

  it('does not let server-end restoration release suspension owned by a newer end', async () => {
    const restoration = createDeferred<boolean>();
    const reproject = vi
      .fn()
      .mockResolvedValueOnce(true)
      .mockImplementationOnce(() => restoration.promise)
      .mockResolvedValueOnce(true);
    const { model, resume } = createHarness({ reproject });
    await model.adoptStatus({ active: true, ...state });
    await model.adoptStatus(inactiveStatus);
    await vi.waitFor(() => expect(reproject).toHaveBeenCalledTimes(2));

    await expect(model.end()).resolves.toBe(true);
    expect(resume).toHaveBeenCalledOnce();
    useStore.getState().setNotice('newer transition', 'info');
    restoration.resolve(true);
    await Promise.resolve();

    expect(resume).toHaveBeenCalledOnce();
    expect(useStore.getState().masquerade).toEqual({ kind: 'inactive' });
    expect(useStore.getState().notice).toMatchObject({ message: 'newer transition', tone: 'info' });
  });
});
