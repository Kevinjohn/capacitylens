import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/queryClient';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthContext } from '@/auth/authContext';
import { PermissionContext } from '@/auth/permissionContext';
import type { PlanningSnapshot } from '@/data/planning/planningCacheController';
import { useAppShellController } from '@/components/useAppShellController';
import { useStore } from '@/store/useStore';
import { makeResource, resetStoreWithAccount, requireValue } from '@/test/fixtures';
import { getPlanningTransportHandle } from '@/test/planningTransportHandle';
import { m } from '@/i18n';
import { SettingsDataSection } from './SettingsDataSection';

const hold = vi.hoisted(() => ({
  promise: null as Promise<void> | null,
  entered: false,
  fail: false,
}));
vi.mock('@/data/planning/storePlanningTransport', async () => {
  const actual = await vi.importActual<typeof import('@/test/createTestPlanningTransport')>(
    '@/test/createTestPlanningTransport',
  );
  return { createStorePlanningTransport: actual.createTestPlanningTransport };
});
function ShellListener() {
  useAppShellController();
  return null;
}
beforeEach(async () => {
  hold.promise = null;
  hold.entered = false;
  hold.fail = false;
  await resetStoreWithAccount();
});
afterEach(() => {
  useStore.getState().clearPlanning();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it.each(
  (['accepted', 'context changed', 'failed'] as const).flatMap((outcome) =>
    [true, false].map((warning) => ({ outcome, warning })),
  ),
)(
  'retains the action outcome after a delayed $outcome read (audit warning: $warning)',
  async ({ outcome, warning }) => {
    const accountId = requireValue(
      useStore.getState().activeAccountId ?? undefined,
      'active company',
    );
    const revision = requireValue(
      useStore.getState().planning.revision ?? undefined,
      'planning revision',
    );
    const writes = vi.fn();
    let finishPost!: (response: Response) => void;
    const postResponse = new Promise<Response>((resolve) => {
      finishPost = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const method = init?.method ?? (input instanceof Request ? input.method : undefined);
        if (url.endsWith('/example-data') && method === 'POST') {
          writes();
          return postResponse;
        }
        return Response.json([]);
      }),
    );
    const notices: Array<{ message: string; tone: string | undefined }> = [];
    const setNotice = useStore.getState().setNotice;
    useStore.setState({
      setNotice: (message, tone) => {
        if (message) notices.push({ message, tone });
        setNotice(message, tone);
      },
    });
    let release!: () => void;
    hold.promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <AuthContext.Provider
            value={{
              user: { id: 'bruce' },
              refreshAuth: async () => {},
              signOut: async () => {},
            }}
          >
            <PermissionContext.Provider value={{ role: 'owner' }}>
              <ShellListener />
              <SettingsDataSection />
            </PermissionContext.Provider>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    try {
      fireEvent.click(screen.getByTestId('add-example-data'));
      await waitFor(() => expect(writes).toHaveBeenCalledOnce());
      const canonicalData = structuredClone(useStore.getState().data);
      canonicalData.resources = [makeResource({ accountId, name: 'Bruce Wayne' })];
      const canonicalSnapshot: PlanningSnapshot = {
        data: canonicalData,
        revision: revision + 1,
        canWrite: true,
      };
      vi.spyOn(getPlanningTransportHandle(), 'read').mockImplementationOnce(async () => {
        hold.entered = true;
        await hold.promise;
        if (hold.fail) throw new Error('Planning read failed');
        return canonicalSnapshot;
      });
      finishPost(
        Response.json(
          { added: true },
          { headers: warning ? { 'x-capacitylens-audit-warning': 'true' } : {} },
        ),
      );
      await waitFor(() => expect(hold.entered).toBe(true));
      if (warning) {
        await waitFor(() =>
          expect(notices.some((notice) => notice.message === m.app_audit_log_warning())).toBe(true),
        );
      }
      if (outcome === 'context changed') {
        act(() => {
          useStore.getState().setActiveAccount(null);
          useStore.getState().setNotice('New context notice');
        });
      }
      hold.fail = outcome === 'failed';
      await act(async () => release());
      if (outcome === 'context changed') {
        expect(notices.at(-1)?.message).toBe('New context notice');
        expect(writes).toHaveBeenCalledOnce();
        return;
      }
      if (outcome === 'failed') {
        expect(notices.at(-1)?.message).toBe(m.settings_example_data_reload());
        expect(useStore.getState().planningReadyForReplacement()).toBe(false);
        expect(writes).toHaveBeenCalledOnce();
        return;
      }
      await waitFor(() => expect(useStore.getState().planning.revision).toBe(revision + 1));
      expect(writes).toHaveBeenCalledOnce();
      const final = notices.at(-1);
      expect(final?.message).toContain(m.settings_example_data_added());
      if (warning) {
        expect(final?.message).toContain(m.app_audit_log_warning());
        expect(final?.tone).toBe('warning');
      } else expect(final?.message).toBe(m.settings_example_data_added());
      expect(useStore.getState().planningReadyForReplacement()).toBe(true);
    } finally {
      await act(async () => release());
      hold.promise = null;
      useStore.setState({ setNotice });
    }
  },
);
