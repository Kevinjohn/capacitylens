import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasqueradeState, MasqueradeStatus } from '@capacitylens/shared/domain/masquerade';
import { loadPlanningData, makeCompany, makeAppData, resetStoreWithCompany } from '@/test/fixtures';
import { useStore } from '@/store/useStore';
import type { FlushPendingWritesResult } from './masqueradeController';
import { state, inactiveStatus, deferred, harness } from './masqueradeController.testSupport';

beforeEach(async () => {
  await resetStoreWithCompany();
  useStore.getState().setMasquerade({ kind: 'inactive' });
  useStore.getState().setNotice(null);
});

describe('MasqueradeController', () => {
  it('does not dispatch a start while another replacement owns the planning lock', async () => {
    const { controller, dependencies } = harness({ suspend: vi.fn(() => null) });
    await expect(controller.start(state.companyId, state.targetUserId)).resolves.toBe(false);
    expect(dependencies.api.start).not.toHaveBeenCalled();
    expect(useStore.getState().masquerade.kind).toBe('inactive');
  });

  it('acquires one suspension across start and end, then releases it once after the real reload', async () => {
    const { controller, dependencies, resume } = harness();
    const navigate = vi.fn(() => {
      expect(useStore.getState().masquerade).toEqual({ kind: 'inactive' });
    });

    await expect(controller.start(state.companyId, state.targetUserId)).resolves.toBe(true);
    expect(useStore.getState().masquerade.kind).toBe('active');
    expect(dependencies.suspend).toHaveBeenCalledTimes(1);

    await expect(controller.end('explicit', navigate)).resolves.toBe(true);
    expect(dependencies.suspend).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledOnce();
    expect(resume).toHaveBeenCalledWith({ dropParkedEdits: true });
    expect(useStore.getState().masquerade).toEqual({ kind: 'inactive' });
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('publishes the company name from the loaded account projection, not the member name', async () => {
    loadPlanningData(
      makeAppData({ accounts: [makeCompany({ id: 'a-studio', name: 'Wayne Enterprises' })] }),
    );
    useStore.getState().setActiveCompany('a-studio');
    await useStore.getState().refreshPlanning();
    const { controller } = harness();

    await expect(controller.start(state.companyId, state.targetUserId)).resolves.toBe(true);

    expect(useStore.getState().companySummaries).toEqual([
      { id: 'a-studio', name: 'Wayne Enterprises', role: 'viewer' },
    ]);
  });

  it('does not publish a cached company or target name before the projection is loaded', async () => {
    useStore.getState().setCompanySummaries({
      list: [{ id: 'old-company', name: 'Stark Industries', role: 'owner' }],
    });
    const { controller } = harness();

    await controller.adoptStatus({ active: true, ...state });

    expect(useStore.getState().companySummaries).toEqual([]);
    expect(useStore.getState().companySummariesComplete).toBe(false);
  });

  it('aborts before suspension when pending writes cannot be flushed', async () => {
    const { controller, dependencies } = harness({
      flush: vi.fn(async () => ({ kind: 'blocked' as const })),
    });
    await expect(controller.start(state.companyId, state.targetUserId)).resolves.toBe(false);
    expect(dependencies.suspend).not.toHaveBeenCalled();
    expect(dependencies.api.start).not.toHaveBeenCalled();
  });

  it('releases without dropping edits when the start request fails', async () => {
    const { controller, resume } = harness({
      api: {
        status: vi.fn(async (): Promise<MasqueradeStatus> => inactiveStatus),
        start: vi.fn(async () => {
          throw new Error('denied');
        }),
        end: vi.fn(async () => {}),
      },
    });
    await expect(controller.start(state.companyId, state.targetUserId)).resolves.toBe(false);
    expect(resume).toHaveBeenCalledWith({ dropParkedEdits: false });
    expect(useStore.getState().masquerade).toEqual({ kind: 'inactive' });
  });

  it('stays suspended and starting when projection fails after a successful start', async () => {
    const { controller, resume } = harness({ reproject: vi.fn(async () => false) });
    await expect(controller.start(state.companyId, state.targetUserId)).resolves.toBe(false);
    expect(useStore.getState().masquerade).toMatchObject({ kind: 'starting', state });
    expect(resume).not.toHaveBeenCalled();
  });
});

describe('MasqueradeController transitions', () => {
  it('cancels a pending member-view start when switching companies before flush completes', async () => {
    const flush = deferred<FlushPendingWritesResult>();
    const { controller, dependencies, resume } = harness({ flush: vi.fn(() => flush.promise) });

    const starting = controller.start(state.companyId, state.targetUserId);
    await expect(controller.transitionCompany('a-loft')).resolves.toBe(true);
    flush.resolve({ kind: 'clean' });

    await expect(starting).resolves.toBe(false);
    expect(dependencies.api.start).not.toHaveBeenCalled();
    expect(dependencies.reproject).not.toHaveBeenCalled();
    expect(dependencies.suspend).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(useStore.getState().masquerade).toEqual({ kind: 'inactive' });
  });

  it('allows only one start to cross a pending flush', async () => {
    const flush = deferred<FlushPendingWritesResult>();
    const { controller, dependencies } = harness({ flush: vi.fn(() => flush.promise) });

    const first = controller.start(state.companyId, state.targetUserId);
    const second = controller.start(state.companyId, 'u-editor');
    flush.resolve({ kind: 'clean' });

    await expect(second).resolves.toBe(false);
    await expect(first).resolves.toBe(true);
    expect(dependencies.flush).toHaveBeenCalledOnce();
    expect(dependencies.api.start).toHaveBeenCalledOnce();
    // Informational, not an error: the first start succeeds, and an error notice never
    // auto-dismisses, so an error tone here would leave a permanent banner over a working view.
    expect(useStore.getState().notice).toMatchObject({
      message: 'A member view is already starting.',
      tone: 'info',
    });
  });

  it('reports an account switch requested while the start request is still in flight', async () => {
    let resolveStart!: (value: MasqueradeState) => void;
    const startResponse = new Promise<MasqueradeState>((resolve) => {
      resolveStart = resolve;
    });
    const { controller, dependencies } = harness({
      api: {
        status: vi.fn(async (): Promise<MasqueradeStatus> => inactiveStatus),
        start: vi.fn(() => startResponse),
        end: vi.fn(async () => {}),
      },
    });

    const starting = controller.start(state.companyId, state.targetUserId);
    await vi.waitFor(() => expect(useStore.getState().masquerade.kind).toBe('starting'));

    await expect(controller.transitionCompany('a-loft')).resolves.toBe(false);
    expect(useStore.getState().notice).toMatchObject({
      message: 'Wait for the current masquerade transition to finish.',
      tone: 'error',
    });
    expect(dependencies.api.end).not.toHaveBeenCalled();
    expect(dependencies.switchCompany).not.toHaveBeenCalled();

    resolveStart(state);
    await expect(starting).resolves.toBe(true);
  });

  it('keeps a failed projection retry contained and suspended', async () => {
    const { controller, resume } = harness({
      reproject: vi.fn().mockResolvedValueOnce(false).mockRejectedValueOnce(new Error('offline')),
    });
    await controller.start(state.companyId, state.targetUserId);

    await expect(controller.retryProjection()).resolves.toBe(false);
    expect(useStore.getState().masquerade.kind).toBe('starting');
    expect(resume).not.toHaveBeenCalled();
  });
});
