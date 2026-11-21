import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasqueradeState, MasqueradeStatus } from '@capacitylens/shared/domain/masquerade';
import { resetStoreWithCompany } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import { state, inactiveStatus, createHarness } from './masqueradeControllerTestKit';
import { createDeferred } from '@/test/createDeferred';

beforeEach(async () => {
  await resetStoreWithCompany();
  useStore.getState().setMasquerade({ kind: 'inactive' });
  useStore.getState().setNotice(null);
});

describe('MasqueradeController', () => {
  it('invalidates a captured reconciliation when its company or identity changes', async () => {
    await resetStoreWithCompany('a-studio');
    const { controller } = createHarness({
      switchCompany: vi.fn(async (companyId: string | null) => {
        useStore.getState().setActiveCompany(companyId);
        return { kind: 'reloaded' as const };
      }),
    });
    const beforeCompanySwitch = controller.captureStatusReconciliation();

    await expect(controller.transitionCompany('a-loft')).resolves.toBe(true);
    expect(beforeCompanySwitch()).toBe(false);

    const beforeIdentityChange = controller.captureStatusReconciliation();
    controller.invalidate();
    expect(beforeIdentityChange()).toBe(false);
  });

  it('holds a newly adopted status behind a blocked old-actor read until a fresh retry finishes', async () => {
    await resetStoreWithCompany('a-studio');
    const oldRead = createDeferred<void>();
    const freshRead = createDeferred<boolean>();
    const otherRelease = useStore.getState().suspendPlanningCommands();
    expect(otherRelease).toBeTypeOf('function');
    useStore.setState((current) => ({
      planning: { ...current.planning, phase: { kind: 'loading', lastWrite: null } },
    }));
    const { controller, dependencies } = createHarness({
      suspend: vi.fn(() => useStore.getState().suspendPlanningCommands()),
      reproject: vi.fn(() => freshRead.promise),
    });

    await controller.adoptStatus({ active: true, ...state });
    expect(useStore.getState().masquerade.kind).toBe('starting');
    expect(dependencies.reproject).not.toHaveBeenCalled();
    expect(useStore.getState().notice).toMatchObject({ tone: 'error' });

    oldRead.resolve();
    await oldRead.promise;
    otherRelease?.();
    useStore.setState((current) => ({
      planning: { ...current.planning, phase: { kind: 'ready', lastWrite: null } },
    }));
    const retry = controller.retryProjection();
    expect(dependencies.reproject).toHaveBeenCalledExactlyOnceWith('a-studio', false);
    expect(useStore.getState().masquerade.kind).toBe('starting');
    freshRead.resolve(true);
    await expect(retry).resolves.toBe(true);
    expect(useStore.getState().masquerade.kind).toBe('active');
  });

  it('lets a newer server status supersede a pending local start without publishing its late response', async () => {
    await resetStoreWithCompany('a-studio');
    const oldStart = createDeferred<MasqueradeState>();
    const newer = {
      ...state,
      token: 'token-2',
      contextToken: 'token-2',
      targetUserId: 'u-editor',
      targetName: 'Dick Grayson',
    };
    const { controller, dependencies } = createHarness({
      api: {
        status: vi.fn(async () => ({ active: true, ...newer })),
        start: vi.fn(() => oldStart.promise),
        end: vi.fn(async () => {}),
      },
    });

    const starting = controller.start(state.companyId, state.targetUserId);
    await vi.waitFor(() => expect(dependencies.api.start).toHaveBeenCalledOnce());
    await controller.adoptStatus({ active: true, ...newer });
    expect(useStore.getState().masquerade).toMatchObject({ kind: 'active', state: newer });
    oldStart.resolve(state);
    await expect(starting).resolves.toBe(false);
    expect(useStore.getState().masquerade).toMatchObject({ kind: 'active', state: newer });
  });

  it('reconciles an idle-context failure when another tab starts masquerade', async () => {
    await resetStoreWithCompany('a-studio');
    const remote = {
      ...state,
      token: 'remote-mode-token',
      contextToken: 'remote-mode-token',
      targetUserId: 'u-editor',
      targetName: 'Dick Grayson',
    };
    const { controller, dependencies } = createHarness({
      api: {
        status: vi.fn(async (): Promise<MasqueradeStatus> => ({ active: true, ...remote })),
        start: vi.fn(async () => state),
        end: vi.fn(async () => {}),
      },
    });

    controller.restoreServerEndedProjection();

    await vi.waitFor(() =>
      expect(useStore.getState().masquerade).toMatchObject({ kind: 'active', state: remote }),
    );
    expect(dependencies.api.status).toHaveBeenCalledOnce();
    expect(dependencies.reproject).toHaveBeenCalledWith(state.companyId, false);
    expect(useStore.getState().masquerade).toMatchObject({ kind: 'active', state: remote });
  });
});

describe('MasqueradeController shared-session reconciliation', () => {
  it('restores the real projection when another tab has ended the shared session masquerade', async () => {
    const { controller, dependencies, resume } = createHarness();
    await controller.adoptStatus({ active: true, ...state });

    await controller.adoptStatus(inactiveStatus);
    await vi.waitFor(() => expect(useStore.getState().masquerade.kind).toBe('inactive'));

    expect(dependencies.reproject).toHaveBeenCalledWith(state.companyId);
    expect(resume).toHaveBeenCalledWith({ dropParkedEdits: true });
  });

  it('keeps the real projection suspended until its reload succeeds', async () => {
    const { controller, resume } = createHarness({ reproject: vi.fn(async () => false) });
    await controller.adoptStatus({ active: true, ...state });

    controller.restoreServerEndedProjection();
    await vi.waitFor(() =>
      expect(useStore.getState().notice?.message).toContain('could not be restored'),
    );

    expect(useStore.getState().masquerade.kind).toBe('ending');
    expect(resume).not.toHaveBeenCalled();
  });
});
