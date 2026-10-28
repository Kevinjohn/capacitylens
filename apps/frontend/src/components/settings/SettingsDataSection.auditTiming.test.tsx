import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/api/queryClient";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import type { AppData } from "@capacitylens/shared/types/entities";
import { AuthContext } from "@/auth/authContext";
import { PermissionContext } from "@/auth/permissionContext";
import { useAppShellController } from "@/components/useAppShellController";
import { useStore } from "@/store/useStore";
import { makeResource, resetStoreWithAccount, requireValue } from "@/test/fixtures";
import { m } from "@/i18n";
import { SettingsDataSection } from "./SettingsDataSection";

const hold = vi.hoisted(() => ({ promise: null as Promise<void> | null, entered: false, fail: false }));
vi.mock("@/data/planning/volatilePlanningTransport", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/planning/volatilePlanningTransport")>();
  return {
    ...actual,
    createStorePlanningTransport: (read: () => AppData) => {
      const transport = actual.createVolatilePlanningTransport(read);
      return {
        ...transport,
        read: async (...args: Parameters<typeof transport.read>) => {
          const snapshot = await transport.read(...args);
          if (hold.promise) {
            hold.entered = true;
            await hold.promise;
            if (hold.fail) throw new Error("Planning read failed");
          }
          return snapshot;
        },
      };
    },
  };
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
  (["accepted", "context changed", "failed"] as const).flatMap((outcome) =>
    [true, false].map((warning) => ({ outcome, warning })),
  ),
)(
  "retains the action outcome after a delayed $outcome read (audit warning: $warning)",
  async ({ outcome, warning }) => {
    const accountId = requireValue(useStore.getState().activeAccountId ?? undefined, "active company");
    const revision = requireValue(useStore.getState().planning.revision ?? undefined, "planning revision");
    const writes = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (String(url).endsWith("/example-data") && init?.method === "POST") {
          writes();
          useStore.setState((state) => ({
            data: { ...state.data, resources: [makeResource({ accountId, name: "Bruce Wayne" })] },
          }));
          return Response.json({ added: true }, { headers: warning ? { "x-capacitylens-audit-warning": "true" } : {} });
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
              authMode: "password-only",
              user: { id: "bruce" },
              canCreateAccount: false,
              refreshAuth: async () => {},
              signOut: async () => {},
            }}
          >
            <PermissionContext.Provider value={{ role: "owner" }}>
              <ShellListener />
              <SettingsDataSection serverMode />
            </PermissionContext.Provider>
          </AuthContext.Provider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    try {
      fireEvent.click(screen.getByTestId("add-example-data"));
      await waitFor(() => expect(hold.entered).toBe(true));
      if (warning)
        await waitFor(() => expect(notices.some((notice) => notice.message === m.app_audit_log_warning())).toBe(true));
      if (outcome === "context changed") {
        act(() => {
          useStore.getState().setActiveAccount(null);
          useStore.getState().setNotice("New context notice");
        });
      }
      hold.fail = outcome === "failed";
      await act(async () => release());
      if (outcome === "context changed") {
        expect(notices.at(-1)?.message).toBe("New context notice");
        expect(writes).toHaveBeenCalledOnce();
        return;
      }
      if (outcome === "failed") {
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
        expect(final?.tone).toBe("warning");
      } else expect(final?.message).toBe(m.settings_example_data_added());
      expect(useStore.getState().planningReadyForReplacement()).toBe(true);
    } finally {
      await act(async () => release());
      hold.promise = null;
      useStore.setState({ setNotice });
    }
  },
);
