import { afterEach, describe, expect, it, vi } from "vitest";
import { createStore } from "zustand/vanilla";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { useStore } from "@/store/useStore";
import type { StoreState } from "@/store/types";
import { createPlanningCacheState } from "./planningCacheController";
import type { PlanningTransport } from "./planningCacheController";
import type { MasqueradeState } from "@capacitylens/shared/domain/masquerade";
import { makeAccount, makeAppData } from "@/test/fixtures";
import { attachPlanningRuntime } from "./planningRuntime";
import { flushPendingWrites, refreshActiveAccountSlice, suspendServerWrites } from "@/data/persist";
import { planningActions } from "./planningActions";
import type { PlanningMutationSuccess } from "@capacitylens/backend/planning";

const disposers: Array<() => void> = [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
  vi.useRealTimers();
});

function setup(data = emptyAppData(), canWrite = true) {
  const read = vi.fn<PlanningTransport["read"]>().mockResolvedValue({ revision: 0, canWrite, data });
  const execute = vi.fn<PlanningTransport["execute"]>();
  const transport: PlanningTransport = { read, execute, lookup: vi.fn() };
  const store = createStore<StoreState>(() => ({
    ...useStore.getState(),
    ...createPlanningCacheState(),
    activeAccountId: null,
    previousAccountId: null,
    accountSummaries: [],
    accountSummariesComplete: false,
    masquerade: { kind: "inactive" },
  }));
  const runtime = attachPlanningRuntime(store, transport);
  disposers.push(runtime.dispose);
  return { store, runtime, read, execute };
}

describe("production planning runtime", () => {
  it("hydrates a selected company through the controller without installing a diff subscriber", async () => {
    const { store, runtime, read } = setup();
    store.setState({ activeAccountId: "wayne" });
    await runtime.ready();
    expect(read).toHaveBeenCalledTimes(1);
    expect(store.getState().planning.context?.companyId).toBe("wayne");
    expect(store.getState().planning.revision).toBe(0);
    expect(store.getState().activeAccountLoadFailed).toBeNull();
  });

  it("anchors the first canonical hydration to company calendar settings and preserves a later pan", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T00:30:00.000Z"));
    const data = makeAppData({
      accounts: [makeAccount({ id: "wayne", timezone: "America/Los_Angeles", weekStartsOn: 0 })],
    });
    const { store, runtime, read } = setup(data);
    store.setState({ activeAccountId: "wayne" });

    await runtime.ready();

    expect(read).toHaveBeenCalledOnce();
    expect(store.getState().ui.focusDate).toBe("2026-10-18");
    expect(store.getState().ui.originDate).not.toBe("2026-10-19");

    store.setState((state) => ({ ui: { ...state.ui, originDate: "2026-12-07" } }));
    const focusDate = store.getState().ui.focusDate;
    read.mockResolvedValueOnce({ revision: 1, canWrite: true, data });
    await expect(refreshActiveAccountSlice("wayne")).resolves.toEqual({ kind: "reloaded" });

    expect(store.getState().ui.originDate).toBe("2026-12-07");
    expect(store.getState().ui.focusDate).toBe(focusDate);
  });

  it("selects a cold verified masquerade projection without directory rows", async () => {
    const data = makeAppData({
      accounts: [makeAccount({ id: "wayne", timezone: "Pacific/Auckland", weekStartsOn: 1 })],
    });
    const { store, runtime, read } = setup(data, false);
    const state: MasqueradeState = {
      accountId: "wayne",
      targetUserId: "selina",
      targetName: "Selina Kyle",
      effectiveRole: "viewer",
      startedAt: "2026-10-20T10:00:00.000Z",
      token: "verified-session-token",
    };

    store.setState({ masquerade: { kind: "active", state, generation: 1 } });
    await runtime.ready();

    expect(store.getState().activeAccountId).toBe("wayne");
    expect(store.getState().accountSummaries).toEqual([]);
    expect(store.getState().planning.context?.companyId).toBe("wayne");
    expect(store.getState().planning.canWrite).toBe(false);
    expect(read).toHaveBeenCalledOnce();
    expect(read.mock.calls[0]?.[0].companyId).toBe("wayne");
    expect(store.getState().data.accounts).toEqual(data.accounts);
  });

  it("starts a new planning context for a live projection change and ignores the old read", async () => {
    const data = makeAppData({ accounts: [makeAccount({ id: "stark", name: "Stark Industries" })] });
    const { store, runtime, read } = setup(data, false);
    const readA = deferred<Awaited<ReturnType<PlanningTransport["read"]>>>();
    read.mockImplementationOnce(() => readA.promise);
    const projection = (accountId: string): MasqueradeState => ({
      accountId,
      targetUserId: "target",
      targetName: "Selina Kyle",
      effectiveRole: "viewer",
      startedAt: "2026-10-20T10:00:00.000Z",
      token: `verified-${accountId}`,
    });

    store.setState({ masquerade: { kind: "active", state: projection("wayne"), generation: 1 } });
    const firstHydration = runtime.ready();
    await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
    store.setState({ masquerade: { kind: "active", state: projection("stark"), generation: 2 } });
    await runtime.ready();
    readA.resolve({ revision: 1, canWrite: false, data: makeAppData({ accounts: [makeAccount({ id: "wayne" })] }) });
    await firstHydration;

    expect(store.getState().activeAccountId).toBe("stark");
    expect(store.getState().planning.context?.companyId).toBe("stark");
    expect(store.getState().data.accounts).toEqual(data.accounts);
  });

  it("clears data and aborts the previous company's late read when access changes", async () => {
    const { store, runtime, read } = setup();
    let complete!: (value: { revision: number; canWrite: boolean; data: ReturnType<typeof emptyAppData> }) => void;
    read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    store.setState({ activeAccountId: "wayne" });
    store.setState({ activeAccountId: null });
    complete({ revision: 1, canWrite: true, data: emptyAppData() });
    await runtime.ready();
    expect(store.getState().planning.context).toBeNull();
    expect(store.getState().planning.revision).toBeNull();
  });
  it.each([
    { status: 401, code: "unauthenticated" },
    { status: 403, code: "account_membership_lost" },
  ])("drops company selection and the denied directory entry on $code", async (error) => {
    const { store, runtime, execute } = setup();
    store.setState({ activeAccountId: "wayne" });
    await runtime.ready();
    store.setState({
      accountSummaries: [
        { id: "wayne", name: "Wayne Enterprises", role: "owner" },
        { id: "stark", name: "Stark Industries", role: "owner" },
      ],
      accountSummariesComplete: true,
      accountSummariesRequestId: 9,
    });
    const draft = runtime.controller.begin(undefined);
    execute.mockRejectedValue(error);
    await expect(
      runtime.controller.execute(draft, { operation: "closure.delete", id: "closure" }, null),
    ).rejects.toMatchObject(error);
    expect(store.getState().activeAccountId).toBeNull();
    expect(store.getState().planning.context).toBeNull();
    expect(store.getState().accountSummaries.map((account) => account.id)).toEqual(["stark"]);
    expect(store.getState().accountSummariesComplete).toBe(false);
    expect(store.getState().accountSummariesRequestId).toBe(10);
  });

  it("keeps the readable cache when an unknown commitment cannot yet be looked up", async () => {
    const { store, runtime, execute } = setup();
    store.setState({ activeAccountId: "wayne" });
    await runtime.ready();
    const data = store.getState().data;
    execute.mockRejectedValueOnce(new TypeError("Connection lost"));
    await expect(
      runtime.controller.execute(
        runtime.controller.begin(undefined),
        { operation: "closure.delete", id: "closure" },
        null,
      ),
    ).rejects.toThrow();
    await expect(refreshActiveAccountSlice("wayne")).resolves.toEqual({ kind: "failed" });
    expect(store.getState().data).toBe(data);
    expect(store.getState().activeAccountLoadFailed).toBeNull();
    expect(store.getState().connectionError).toBe(false);
    expect(store.getState().planning.pending).not.toBeNull();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("refuses Undo and Redo while an external company replacement suspends writes", async () => {
    const { store, runtime, execute } = setup();
    store.setState({ activeAccountId: "wayne" });
    await runtime.ready();
    const resume = suspendServerWrites();
    await expect(planningActions.undo()).rejects.toThrow(/suspended/);
    await expect(planningActions.redo()).rejects.toThrow(/suspended/);
    expect(execute).not.toHaveBeenCalled();
    resume();
    await expect(planningActions.undo()).resolves.toBe(false);
  });

  it("waits for an in-flight acknowledgement before reporting a clean handoff", async () => {
    const { store, runtime, execute, read } = setup();
    store.setState({ activeAccountId: "wayne" });
    await runtime.ready();
    const draft = runtime.controller.begin(undefined);
    let finish!: (receipt: PlanningMutationSuccess) => void;
    execute.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const saving = runtime.controller.execute(draft, { operation: "closure.delete", id: "closure" }, null);
    let resolved = false;
    const flushing = flushPendingWrites().then((outcome) => {
      resolved = true;
      return outcome;
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(resolved).toBe(false);
    const pending = store.getState().planning.pending;
    if (!pending) throw new Error("Expected an in-flight planning mutation.");
    read.mockResolvedValue({ revision: 1, canWrite: true, data: emptyAppData() });
    finish({
      status: "committed",
      mutationId: pending.execution.mutationId,
      revision: 1,
      restoration: { consumedGroupId: null, replacementGroupId: null },
      projection: { mode: "patch", history: "retain", changed: { upserts: [], removed: [] } },
    });
    await saving;
    await expect(flushing).resolves.toEqual({ kind: "clean" });
  });
});
