import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/store/useStore";
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from "@/test/fixtures";
import { useLifecycleActions } from "./useLifecycleActions";
import type { PlanningCommand } from "@/data/planning/planningCommands";
import { refreshActiveAccountSlice } from "@/data/persist";

vi.mock("@/data/apiConfig", () => ({
  API_BASE: "http://api.test",
  isServerConfigured: () => true,
}));
vi.mock("@/data/persist", () => ({
  refreshActiveAccountSlice: vi.fn(async () => ({ kind: "reloaded" })),
}));

beforeEach(async () => {
  await resetStoreWithAccount();
  vi.clearAllMocks();
  vi.mocked(refreshActiveAccountSlice).mockResolvedValue({ kind: "reloaded" });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("named lifecycle actions", () => {
  it("sends archive and restore through typed planning commands", async () => {
    const send = vi.fn(async (command: PlanningCommand) => {
      void command;
    });
    useStore.setState({ sendPlanningCommand: send });
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useLifecycleActions());
    await act(async () => {
      await result.current.archive("clients", "c-1");
      await result.current.unarchive("clients", "c-1");
    });
    expect(send.mock.calls.map(([command]) => command)).toEqual([
      { intent: { operation: "catalogue.archive", entity: { entity: "clients", id: "c-1" } }, inverse: null },
      { intent: { operation: "catalogue.unarchive", entity: { entity: "clients", id: "c-1" } }, inverse: null },
    ]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("only resource anonymisation calls the named destructive endpoint", async () => {
    const fetch = vi.fn(async (url: RequestInfo | URL, options?: RequestInit) => {
      void url;
      void options;
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetch);
    const { result } = renderHook(() => useLifecycleActions());
    await act(async () => result.current.anonymise("r-1"));
    expect(fetch).toHaveBeenCalledOnce();
    const call = fetch.mock.calls[0];
    if (!call) throw new Error("Anonymisation request was not sent.");
    const [url, options] = call;
    expect(url).toBe(`http://api.test/api/accounts/${DEFAULT_ACCOUNT_ID}/resources/r-1/anonymise`);
    expect(options).toMatchObject({ method: "POST", body: "{}" });
  });

  it("drops a queued action after the selected company changes", async () => {
    const send = vi.fn(async (command: PlanningCommand) => {
      void command;
    });
    useStore.setState({ sendPlanningCommand: send });
    const { result } = renderHook(() => useLifecycleActions());
    const queued = result.current.archive("clients", "c-1");
    useStore.getState().setActiveAccount(null);
    await act(async () => queued);
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["failed", "skipped"] as const)(
    "blocks another anonymisation after a %s refresh, including after remount",
    async (kind) => {
      useStore.setState({ activeAccountId: `a-recovery-${kind}` });
      vi.mocked(refreshActiveAccountSlice).mockResolvedValue({ kind });
      const fetch = vi.fn(async () => new Response(null, { status: 204 }));
      vi.stubGlobal("fetch", fetch);
      const first = renderHook(() => useLifecycleActions());
      await act(async () => first.result.current.anonymise("r-one"));
      first.unmount();
      const second = renderHook(() => useLifecycleActions());
      await act(async () => second.result.current.anonymise("r-two"));
      expect(fetch).toHaveBeenCalledOnce();
      expect(useStore.getState().notice?.message).toMatch(/Reload this page before anonymising another resource/);
    },
  );

  it("does not publish a stale tenant response after the selected company changes", async () => {
    let finishRefresh!: (value: { kind: "reloaded" }) => void;
    vi.mocked(refreshActiveAccountSlice).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRefresh = resolve;
        }),
    );
    const fetch = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const onReloaded = vi.fn();
    const { result } = renderHook(() => useLifecycleActions(onReloaded));
    const operation = result.current.anonymise("r-one");
    await vi.waitFor(() => expect(refreshActiveAccountSlice).toHaveBeenCalledOnce());
    act(() => useStore.setState({ activeAccountId: "a-loft" }));
    finishRefresh({ kind: "reloaded" });
    await act(async () => operation);
    expect(onReloaded).not.toHaveBeenCalled();
    expect(useStore.getState().activeAccountId).toBe("a-loft");
  });
});
