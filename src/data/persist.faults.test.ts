import { describe, it, expect, beforeEach, vi } from "vitest";
import { attachPersistence, flushPendingWrites, refreshActiveAccountSlice, suspendServerWrites } from "./persist";
import { BatchCommitUncertainError, BatchConflictError } from "./ServerSyncAdapter";
import { useStore } from "../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { resetStoreWithAccount } from "../test/fixtures";
import { readPersistenceDiagnosticsSnapshot } from "./persistenceDiagnostics";
import { a2Slice, attachActiveA2 } from "./__tests__/persistTestKit";

beforeEach(() => {
  localStorage.clear();
  // Seeds a single account AND makes it active, so the add* calls below
  // (which now require an active account) work.
  resetStoreWithAccount();
});

describe("persistence coordinator fault-injection branches", () => {
  it("owns a reconciliation failure after sign-out without starting a reload", async () => {
    let rejectSave!: (error: Error) => void;
    const saveAll = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const loadAll = vi.fn().mockResolvedValue(emptyAppData());
    const onError = vi.fn();
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll },
      debounceMs: 0,
      onError: onError,
      serverMode: true,
    });
    useStore.getState().addClient({ name: "Pending", color: "#111111" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    useStore.getState().setActiveAccount(null);
    rejectSave(new BatchCommitUncertainError("uncertain"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(onError.mock.calls[0]?.[0]).toBeInstanceOf(BatchCommitUncertainError);
    expect(loadAll).not.toHaveBeenCalled();
    await expect(flushPendingWrites()).resolves.toEqual({ kind: "blocked" });
    detach();
  });

  it("discards a superseded non-null account load without running the sign-out rebase", async () => {
    const a1 = {
      ...emptyAppData(),
      accounts: [{ id: "a1", name: "Alpha", color: "#1", createdAt: "t", updatedAt: "t" }],
    };
    const a2 = a2Slice();
    let releaseA2!: () => void;
    const loadAll = vi.fn((id?: string) =>
      id === "a2"
        ? new Promise<AppData>((resolve) => {
            releaseA2 = () => resolve(a2);
          })
        : Promise.resolve(a1),
    );
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([
      { id: "a1", name: "Alpha", role: "owner" },
      { id: "a2", name: "Beta", role: "owner" },
    ]);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll: vi.fn().mockResolvedValue(undefined) },
      debounceMs: 0,
      serverMode: true,
    });
    useStore.getState().setActiveAccount("a2");
    await new Promise((resolve) => setTimeout(resolve, 0));
    useStore.getState().setActiveAccount("a1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseA2();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(useStore.getState().activeAccountId).toBe("a1");
    expect(useStore.getState().data.accounts.map((row) => row.id)).toEqual(["a1"]);
    expect(readPersistenceDiagnosticsSnapshot().reloadsSuperseded).toBeGreaterThan(0);
    detach();
  });

  it("retries the current store data when an older failure lands after the latest snapshot was acknowledged", async () => {
    let rejectFirst!: (error: Error) => void;
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    const saveAll = vi.fn().mockReturnValueOnce(first).mockResolvedValue(undefined);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll: async () => emptyAppData(), saveAll },
      debounceMs: 0,
    });
    useStore.getState().addClient({ name: "First", color: "#111111" });
    useStore.getState().addClient({ name: "Latest", color: "#222222" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    rejectFirst(new Error("older failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    window.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveAll).toHaveBeenCalledTimes(3);
    expect((saveAll.mock.calls[2]?.[0] as AppData).clients.map((row) => row.name)).toEqual(["First", "Latest"]);
    detach();
  });

  it("does not replay an armed retry after disposal", async () => {
    vi.useFakeTimers();
    try {
      const saveAll = vi.fn().mockRejectedValue(new Error("offline"));
      const detach = attachPersistence({
        store: useStore,
        adapter: { loadAll: async () => emptyAppData(), saveAll },
        debounceMs: 0,
      });
      useStore.getState().addClient({ name: "Retry", color: "#111111" });
      await vi.advanceTimersByTimeAsync(0);
      expect(saveAll).toHaveBeenCalledOnce();

      detach();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(saveAll).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not replay an armed retry while an external suspension is active", async () => {
    vi.useFakeTimers();
    try {
      const saveAll = vi.fn().mockRejectedValue(new Error("offline"));
      const detach = attachPersistence({
        store: useStore,
        adapter: { loadAll: async () => emptyAppData(), saveAll },
        debounceMs: 0,
        serverMode: true,
      });
      useStore.getState().addClient({ name: "Retry", color: "#111111" });
      await vi.advanceTimersByTimeAsync(0);
      const resume = suspendServerWrites();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(saveAll).toHaveBeenCalledOnce();
      resume();
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["resolve", "reject"] as const)(
    "ignores a teardown keepalive that settles after disposal (%s)",
    async (settlement) => {
      let settleKeepalive!: () => void;
      const keepalive = new Promise<void>((resolve, reject) => {
        settleKeepalive = () => (settlement === "resolve" ? resolve() : reject(new Error("late failure")));
      });
      const ordinary = new Promise<void>(() => undefined);
      const saveAll = vi.fn((_data: AppData, opts?: { unload?: boolean }) => (opts?.unload ? keepalive : ordinary));
      const onError = vi.fn();
      const onSuccess = vi.fn();
      const detach = attachPersistence({
        store: useStore,
        adapter: { loadAll: async () => emptyAppData(), saveAll },
        debounceMs: 0,
        onError: onError,
        onSuccess: onSuccess,
      });
      useStore.getState().addClient({ name: "Pending", color: "#111111" });
      await new Promise((resolve) => setTimeout(resolve, 0));
      window.dispatchEvent(new Event("pagehide"));
      expect(saveAll).toHaveBeenCalledTimes(2);
      detach();
      settleKeepalive();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(onError).not.toHaveBeenCalled();
      expect(onSuccess).not.toHaveBeenCalled();
    },
  );

  it("makes resume idempotent and keeps a nested external suspension active until its final owner resumes", async () => {
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll: async () => emptyAppData(), saveAll },
      debounceMs: 0,
      serverMode: true,
    });
    const resumeOuter = suspendServerWrites();
    const resumeInner = suspendServerWrites();
    useStore.getState().addClient({ name: "Parked", color: "#111111" });

    resumeInner();
    resumeInner();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveAll).not.toHaveBeenCalled();

    resumeOuter();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveAll).toHaveBeenCalledOnce();
    detach();
  });

  it("returns skipped without onError when a detached owner receives a late refresh rejection", async () => {
    const initial = a2Slice();
    let rejectRefresh!: (error: Error) => void;
    let calls = 0;
    const loadAll = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(initial);
      return new Promise<AppData>((_resolve, reject) => {
        rejectRefresh = reject;
      });
    });
    const onError = vi.fn();
    const detach = await attachActiveA2({
      adapter: { loadAll, saveAll: vi.fn().mockResolvedValue(undefined) },
      debounceMs: 0,
      onError: onError,
    });
    const refreshing = refreshActiveAccountSlice("a2");
    await new Promise((resolve) => setTimeout(resolve, 0));
    detach();
    rejectRefresh(new Error("late load failure"));

    await expect(refreshing).resolves.toEqual({ kind: "skipped" });
    expect(onError).not.toHaveBeenCalled();
  });

  it("collapses concurrent focus refreshes behind one in-flight load", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const initial = a2Slice();
    let releaseRefresh!: () => void;
    let calls = 0;
    const loadAll = vi.fn(() => {
      calls += 1;
      if (calls === 1) return Promise.resolve(initial);
      return new Promise<AppData>((resolve) => {
        releaseRefresh = () => resolve(initial);
      });
    });
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll: vi.fn().mockResolvedValue(undefined) } });
    now.mockReturnValue(131_000);

    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(loadAll).toHaveBeenCalledTimes(2);
    releaseRefresh();
    await new Promise((resolve) => setTimeout(resolve, 0));
    detach();
    now.mockRestore();
  });

  it("leaves a failed account switch for explicit recovery instead of focus refresh", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(100_000);
    const loadAll = vi.fn().mockRejectedValueOnce(new Error("switch failed")).mockResolvedValueOnce(a2Slice());
    useStore.getState().replaceAll(emptyAppData());
    useStore.getState().setActiveAccount(null);
    useStore.getState().setAccountSummaries([{ id: "a2", name: "Beta", role: "owner" }]);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll, saveAll: vi.fn().mockResolvedValue(undefined) },
      debounceMs: 0,
      onError: vi.fn(),
      serverMode: true,
    });
    useStore.getState().setActiveAccount("a2");
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 0));

    detach();
    expect(loadAll).toHaveBeenCalledTimes(1);
    now.mockRestore();
  });

  it("waits for an in-flight-only flush round and reports quiescence after it settles", async () => {
    let resolveSave!: () => void;
    const saveAll = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        }),
    );
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll: async () => emptyAppData(), saveAll },
      debounceMs: 0,
      serverMode: true,
    });
    useStore.getState().addClient({ name: "In flight", color: "#111111" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const flushing = flushPendingWrites();
    resolveSave();
    await expect(flushing).resolves.toEqual({ kind: "clean" });
    detach();
  });

  it("refuses coordinator flushes while an authoritative reload is required", async () => {
    const initial = a2Slice();
    let holdReload = false;
    const loadAll = vi.fn(() => (holdReload ? new Promise<AppData>(() => undefined) : Promise.resolve(initial)));
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll } });
    holdReload = true;
    saveAll.mockRejectedValueOnce(new BatchCommitUncertainError("uncertain"));
    useStore.getState().addClient({ name: "Uncertain", color: "#111111" });
    await new Promise((resolve) => setTimeout(resolve, 0));

    await expect(flushPendingWrites()).resolves.toEqual({ kind: "blocked" });
    detach();
  });

  it("routes a teardown reconciliation failure to an authoritative reload instead of backoff", async () => {
    vi.useFakeTimers();
    try {
      const slice = a2Slice();
      const loadAll = vi.fn().mockResolvedValue(slice);
      const saveAll = vi.fn((_data: AppData, opts?: { unload?: boolean }) =>
        opts?.unload ? Promise.reject(new BatchConflictError("teardown conflict")) : Promise.resolve(undefined),
      );
      const detachPromise = attachActiveA2({ adapter: { loadAll, saveAll }, debounceMs: 300 });
      await vi.advanceTimersByTimeAsync(5);
      const detach = await detachPromise;
      const loadsAfterPick = loadAll.mock.calls.length;
      useStore.getState().addClient({ name: "Pending", color: "#111111" });
      window.dispatchEvent(new Event("pagehide"));
      await vi.advanceTimersByTimeAsync(5);

      expect(loadAll.mock.calls.length).toBe(loadsAfterPick + 1);
      const savesAfterReload = saveAll.mock.calls.length;
      await vi.advanceTimersByTimeAsync(35_000);
      expect(saveAll.mock.calls.length).toBe(savesAfterReload);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it("skips the post-reconciliation acknowledgement when the active account changes mid-reload", async () => {
    const slice = a2Slice();
    let releaseReload!: () => void;
    let loads = 0;
    const loadAll = vi.fn(() => {
      loads += 1;
      if (loads === 1) return Promise.resolve(slice);
      return new Promise<AppData>((resolve) => {
        releaseReload = () => resolve(slice);
      });
    });
    const saveAll = vi.fn().mockRejectedValueOnce(new BatchCommitUncertainError("uncertain"));
    const detach = await attachActiveA2({ adapter: { loadAll, saveAll } });
    saveAll.mockClear();
    saveAll.mockRejectedValueOnce(new BatchCommitUncertainError("uncertain"));
    useStore.getState().addClient({ name: "Uncertain", color: "#111111" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(releaseReload).toBeTypeOf("function");

    useStore.getState().setActiveAccount(null);
    releaseReload();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(saveAll).toHaveBeenCalledOnce();
    detach();
  });
});
