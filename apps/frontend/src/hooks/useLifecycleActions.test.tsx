import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStore } from "@/store/useStore";
import { DEFAULT_ACCOUNT_ID, resetStoreWithAccount } from "@/test/fixtures";
import { useLifecycleActions } from "./useLifecycleActions";
import type { PlanningCommand } from "@/data/planning/planningCommands";

vi.mock("@/data/apiConfig", () => ({
  API_BASE: "http://api.test",
  isServerConfigured: () => true,
}));
vi.mock("@/data/persist", () => ({
  refreshActiveAccountSlice: async () => ({ kind: "reloaded" }),
}));

beforeEach(async () => {
  await resetStoreWithAccount();
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
    expect(send.mock.calls.map(([command]) => command.intent)).toEqual([
      { operation: "catalogue.archive", entity: { entity: "clients", id: "c-1" } },
      { operation: "catalogue.unarchive", entity: { entity: "clients", id: "c-1" } },
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
});
