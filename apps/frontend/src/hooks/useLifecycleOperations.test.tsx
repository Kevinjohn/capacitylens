import type { ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/store/useStore';
import {
  loadPlanningData,
  DEFAULT_COMPANY_ID,
  makeCompany,
  resetStoreWithCompany,
} from '@/test/fixtures';
import { useLifecycleOperations } from './useLifecycleOperations';
import type { PlanningIntentRequest } from '@/data/planning/planningIntents';
import { readDataSettingsCalls } from '@/test/dataSettingsRequests';

const originalRefreshPlanning = useStore.getState().refreshPlanning;
const queryCache = new QueryClient();
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryCache}>{children}</QueryClientProvider>
);

beforeEach(async () => {
  await resetStoreWithCompany();
  vi.clearAllMocks();
});
afterEach(() => {
  useStore.setState({ refreshPlanning: originalRefreshPlanning });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('named lifecycle actions', () => {
  it('sends archive and restore through typed planning intents', async () => {
    const send = vi.fn(async (intentRequest: PlanningIntentRequest) => {
      void intentRequest;
      return undefined;
    });
    useStore.setState({ sendPlanningIntent: send });
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLifecycleOperations(), { wrapper });
    await act(async () => {
      await result.current.archive('clients', 'c-1');
      await result.current.restore('clients', 'c-1');
    });
    expect(send.mock.calls.map(([intentRequest]) => intentRequest)).toEqual([
      {
        intent: { operation: 'catalogue.archive', entity: { entity: 'clients', id: 'c-1' } },
        endsHistory: true,
      },
      {
        intent: { operation: 'catalogue.restore', entity: { entity: 'clients', id: 'c-1' } },
        endsHistory: true,
      },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('marks the inactive-row reads stale after an archive, and no other query', async () => {
    useStore.setState({ sendPlanningIntent: vi.fn(async () => undefined) });
    const key = (route: string) => ['capacitylens', 'bruce', DEFAULT_COMPANY_ID, 0, route];
    for (const route of ['archive-recovery', 'inactive-company-data', 'team-directory']) {
      queryCache.setQueryData(key(route), route);
    }
    const { result } = renderHook(() => useLifecycleOperations(), { wrapper });
    await act(async () => result.current.archive('clients', 'c-1'));
    const stale = (route: string) => queryCache.getQueryState(key(route))?.isInvalidated;
    expect([stale('archive-recovery'), stale('inactive-company-data')]).toEqual([true, true]);
    expect(stale('team-directory')).toBe(false);
  });

  it('reports what the server says a client archive hid', async () => {
    const send = vi.fn(async (intentRequest: PlanningIntentRequest) => {
      void intentRequest;
      return {
        status: 'committed' as const,
        mutationId: 'm-archive',
        revision: 1,
        restoration: { consumedGroupId: null, replacementGroupId: null },
        changes: { upserts: [], removed: [] },
        archived: { projects: 1, phases: 1, activities: 1, allocations: 2, timeOff: 0 },
      };
    });
    useStore.setState({ sendPlanningIntent: send });
    const { result } = renderHook(() => useLifecycleOperations(), { wrapper });
    await act(async () => result.current.archive('clients', 'c-1'));
    expect(useStore.getState().notice).toEqual({
      message:
        'Archiving the client also hid 1 project, 1 phase and 2 allocations from the schedule; restore it to bring them back.',
      tone: 'info',
    });
  });

  it('only resource anonymisation calls the named destructive endpoint', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLifecycleOperations(), { wrapper });
    await act(async () => result.current.anonymise('r-1'));
    expect(fetch).toHaveBeenCalledOnce();
    const [request] = await readDataSettingsCalls(fetch);
    if (!request) throw new Error('Anonymisation request was not sent.');
    expect(request.path).toBe(`/api/v1/companies/${DEFAULT_COMPANY_ID}/resources/r-1/anonymise`);
    // The action sends no body since the API client migration; it used to send `{}`.
    expect(request).toMatchObject({ method: 'POST', body: undefined });
    expect(request.headers.has('content-type')).toBe(false);
  });

  it('refuses resource anonymisation while another replacement owns the planning context', async () => {
    const release = useStore.getState().suspendPlanningIntents();
    if (!release) throw new Error('The test planning context was not ready.');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { result } = renderHook(() => useLifecycleOperations(), { wrapper });

    await act(async () => result.current.anonymise('r-1'));

    expect(fetch).not.toHaveBeenCalled();
    expect(useStore.getState().notice?.tone).toBe('error');
    release();
    expect(useStore.getState().planningReadyForReplacement()).toBe(true);
  });

  it('drops a queued action after the selected company changes', async () => {
    const send = vi.fn(async (intentRequest: PlanningIntentRequest) => {
      void intentRequest;
      return undefined;
    });
    useStore.setState({ sendPlanningIntent: send });
    const { result } = renderHook(() => useLifecycleOperations(), { wrapper });
    const queued = result.current.archive('clients', 'c-1');
    useStore.getState().setActiveCompany(null);
    await act(async () => queued);
    expect(send).not.toHaveBeenCalled();
  });

  it('blocks another anonymisation after a failed canonical refresh, including after remount', async () => {
    loadPlanningData({
      ...useStore.getState().data,
      companies: [makeCompany({ id: 'a-recovery-failed' })],
    });
    useStore.getState().setActiveCompany('a-recovery-failed');
    await useStore.getState().refreshPlanning();
    useStore.setState({ refreshPlanning: async () => false });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const first = renderHook(() => useLifecycleOperations(), { wrapper });
    await act(async () => first.result.current.anonymise('r-one'));
    first.unmount();
    const second = renderHook(() => useLifecycleOperations(), { wrapper });
    await act(async () => second.result.current.anonymise('r-two'));
    expect(fetch).toHaveBeenCalledOnce();
    expect(useStore.getState().notice?.message).toMatch(
      /Reload this page before anonymising another resource/,
    );
  });

  it('does not publish a stale company response after the selected company changes', async () => {
    let finishRefresh!: (value: boolean) => void;
    const refresh = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<boolean>((resolve) => {
            finishRefresh = resolve;
          }),
      )
      .mockResolvedValue(true);
    useStore.setState({ refreshPlanning: refresh });
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const onReloaded = vi.fn();
    const { result } = renderHook(() => useLifecycleOperations(onReloaded), { wrapper });
    const operation = result.current.anonymise('r-one');
    await vi.waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    act(() => useStore.setState({ activeCompanyId: 'a-loft' }));
    finishRefresh(true);
    await act(async () => operation);
    expect(onReloaded).not.toHaveBeenCalled();
    expect(useStore.getState().activeCompanyId).toBe('a-loft');
  });
});
