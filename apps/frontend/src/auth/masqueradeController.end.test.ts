import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasqueradeStatus } from '@capacitylens/shared/domain/masquerade';
import { loadPlanningData, makeCompany, makeAppData, resetStoreWithCompany } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { state, inactiveStatus, harness } from './masqueradeController.testSupport';

beforeEach(async () => {
  await resetStoreWithCompany();
  useStore.getState().setMasquerade({ kind: 'inactive' });
  useStore.getState().setNotice(null);
});

describe('MasqueradeController', () => {
  it('restores the real projection when End fails after another tab already stopped the mode', async () => {
    await resetStoreWithCompany('a-studio');
    const { controller, dependencies, resume } = harness({
      api: {
        status: vi.fn(async (): Promise<MasqueradeStatus> => inactiveStatus),
        start: vi.fn(async () => state),
        end: vi.fn(async () => {
          throw new Error('The mode was already ended remotely.');
        }),
      },
    });
    await controller.adoptStatus({ active: true, ...state });

    await expect(controller.end()).resolves.toBe(true);
    expect(dependencies.api.status).toHaveBeenCalledOnce();
    expect(dependencies.reproject).toHaveBeenCalledWith(state.companyId);
    expect(useStore.getState().masquerade).toEqual({ kind: 'inactive' });
    expect(resume).toHaveBeenCalledWith({ dropParkedEdits: true });
  });

  it('retains a replacement server mode after an ambiguous End response', async () => {
    await resetStoreWithCompany('a-studio');
    const replacement = {
      ...state,
      token: 'replacement-mode-token',
      contextToken: 'replacement-mode-token',
      targetUserId: 'u-editor',
      targetName: 'Dick Grayson',
    };
    const { controller, dependencies } = harness({
      api: {
        status: vi.fn(async (): Promise<MasqueradeStatus> => ({ active: true, ...replacement })),
        start: vi.fn(async () => state),
        end: vi.fn(async () => {
          throw new Error('The End response was lost.');
        }),
      },
    });
    await controller.adoptStatus({ active: true, ...state });

    await expect(controller.end()).resolves.toBe(true);
    await vi.waitFor(() =>
      expect(useStore.getState().masquerade).toMatchObject({ kind: 'active', state: replacement }),
    );
    expect(dependencies.api.status).toHaveBeenCalledOnce();
    expect(dependencies.reproject).toHaveBeenLastCalledWith(state.companyId, false);
  });

  it("preserves a failed cold End attempt's retry ownership after server confirms it remains active", async () => {
    useStore.getState().clearPlanning();
    loadPlanningData(
      makeAppData({ accounts: [makeCompany({ id: state.companyId, name: 'Wayne Enterprises' })] }),
    );
    const { controller, dependencies } = harness({
      suspend: vi.fn(() => useStore.getState().suspendPlanningCommands()),
      readBootstrapCompany: vi
        .fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('Wayne Enterprises'),
      reproject: vi.fn(() => useStore.getState().refreshPlanning({ fresh: true })),
      api: {
        status: vi.fn(async () => ({ active: true, ...state })),
        start: vi.fn(async () => state),
        end: vi.fn(async () => {
          throw new Error('End refused');
        }),
      },
    });
    await controller.adoptStatus({ active: true, ...state });
    expect(useStore.getState().masquerade.kind).toBe('starting');
    await expect(controller.end()).resolves.toBe(true);
    expect(dependencies.api.end).toHaveBeenCalledExactlyOnceWith(state.token, 'explicit');
    expect(useStore.getState().masquerade.kind).toBe('active');
    await expect(controller.retryProjection()).resolves.toBe(true);
    expect(useStore.getState().masquerade.kind).toBe('active');
  });

  it("keeps retry ownership when a non-cold End cannot acquire another writer's lock", async () => {
    await resetStoreWithCompany('a-studio');
    const resume = vi.fn();
    const { controller, dependencies } = harness({
      suspend: vi.fn().mockReturnValueOnce(null).mockReturnValueOnce(resume),
    });
    useStore.getState().setMasquerade({
      kind: 'starting',
      pending: { companyId: state.companyId, targetUserId: state.targetUserId },
      state,
      generation: 0,
    });
    await expect(controller.end()).resolves.toBe(false);
    expect(dependencies.api.end).not.toHaveBeenCalled();
    expect(useStore.getState().masquerade.kind).toBe('starting');
    await expect(controller.retryProjection()).resolves.toBe(true);
    expect(useStore.getState().masquerade.kind).toBe('active');
  });

  it('ends a cold server projection without requiring a loaded planning context', async () => {
    useStore.getState().clearPlanning();
    const { controller, dependencies } = harness({
      suspend: vi.fn(() => useStore.getState().suspendPlanningCommands()),
      readBootstrapCompany: vi.fn(async () => null),
    });
    await controller.adoptStatus({ active: true, ...state });
    const navigate = vi.fn();
    await expect(controller.end('explicit', navigate)).resolves.toBe(true);
    expect(dependencies.api.end).toHaveBeenCalledExactlyOnceWith(state.token, 'explicit');
    expect(dependencies.suspend).not.toHaveBeenCalled();
    expect(dependencies.switchCompany).toHaveBeenCalledExactlyOnceWith(null);
    expect(useStore.getState().masquerade.kind).toBe('inactive');
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('succeeds while inactive without navigating or touching masquerade dependencies', async () => {
    const { controller, dependencies, resume } = harness();
    const navigate = vi.fn();

    await expect(controller.end('explicit', navigate)).resolves.toBe(true);
    expect(navigate).not.toHaveBeenCalled();
    expect(dependencies.suspend).not.toHaveBeenCalled();
    expect(dependencies.api.end).not.toHaveBeenCalled();
    expect(dependencies.api.status).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });
});

describe('MasqueradeController cross-tab reconciliation', () => {
  it('adopts a newer cross-tab masquerade returned after DELETE', async () => {
    const newer = {
      ...state,
      targetUserId: 'u-editor',
      targetName: 'Dick Grayson',
      token: 'token-2',
      contextToken: 'token-2',
    };
    const { controller, resume } = harness({
      api: {
        status: vi.fn(async () => ({ active: true, ...newer })),
        start: vi.fn(async () => state),
        end: vi.fn(async () => {}),
      },
    });
    const navigate = vi.fn();
    await controller.adoptStatus({ active: true, ...state });
    await expect(controller.end('explicit', navigate)).resolves.toBe(true);
    expect(useStore.getState().masquerade).toMatchObject({ kind: 'active', state: newer });
    expect(navigate).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
  });

  it('refuses an account switch when DELETE is superseded by a newer masquerade', async () => {
    const newer = {
      ...state,
      targetUserId: 'u-editor',
      targetName: 'Dick Grayson',
      token: 'token-2',
      contextToken: 'token-2',
    };
    const { controller, dependencies, resume } = harness({
      api: {
        status: vi.fn(async () => ({ active: true, ...newer })),
        start: vi.fn(async () => state),
        end: vi.fn(async () => {}),
      },
    });
    await controller.adoptStatus({ active: true, ...state });

    await expect(controller.transitionCompany('a-loft')).resolves.toBe(false);
    expect(useStore.getState().notice).toMatchObject({
      message: 'A newer masquerade is active. End it before switching companies.',
      tone: 'error',
    });
    expect(dependencies.switchCompany).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(useStore.getState().masquerade).toMatchObject({ kind: 'active', state: newer });
  });

  it('refuses an account switch when DELETE fails and keeps writes suspended', async () => {
    const { controller, dependencies, resume } = harness({
      api: {
        status: vi.fn(async () => ({ active: true, ...state })),
        start: vi.fn(async () => state),
        end: vi.fn(async () => {
          throw new Error('offline');
        }),
      },
    });
    await controller.adoptStatus({ active: true, ...state });
    await expect(controller.transitionCompany('a-loft')).resolves.toBe(false);
    expect(dependencies.switchCompany).not.toHaveBeenCalled();
    expect(useStore.getState().masquerade).toMatchObject({ kind: 'active', state });
    expect(resume).not.toHaveBeenCalled();
  });
});
