import { it, expect, beforeEach, vi } from "vitest";
import { attachPersistence, hasUnsavedPersistenceWrites } from "./persist";
import { InMemoryDemoAdapter } from "./InMemoryDemoAdapter";
import { ServerSyncAdapter, BatchConflictError } from "./ServerSyncAdapter";
import type { AllocationRewriteRevision, PersistenceAdapter } from "./PersistenceAdapter";
import { useStore } from "../store/useStore";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AppData } from "@capacitylens/shared/types/entities";
import { deleteProjectCascade } from "@capacitylens/shared/lib/integrity";
import { resetStoreWithAccount, requireValue } from "../test/fixtures";
import { readPersistenceDiagnosticsSnapshot } from "./persistenceDiagnostics";
import { requireCallback, a2Slice, attachActiveA2 } from "./__tests__/persistTestKit";

beforeEach(() => {
  localStorage.clear();
  // Seeds a single account AND makes it active, so the add* calls below
  // (which now require an active account) work.
  resetStoreWithAccount();
});

const addAllocationFixture = (projectName: string) => {
  const resource = useStore.getState().addResource({
    kind: "person",
    name: "Bruce Wayne",
    role: "Designer",
    employmentType: "permanent",
    engagement: "studio",
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#111111",
  });
  const client = useStore.getState().addClient({ name: "Wayne Enterprises", color: "#111111" });
  const project = useStore.getState().addProject({ name: projectName, clientId: client.id, color: "#222222" });
  const activity = useStore.getState().addActivity({ name: "Shared", kind: "repeatable" });
  const allocation = useStore.getState().addAllocation({
    resourceId: resource.id,
    activityId: activity.id,
    projectId: project.id,
    startDate: "2026-06-01",
    endDate: "2026-06-01",
    hoursPerDay: 8,
    status: "confirmed",
  });
  return { allocation, client };
};
it("attachPersistence publishes allocation rewrites into the visible Zustand row", async () => {
  const { allocation } = addAllocationFixture("Project");
  const rewrittenAt = "2030-01-02T00:00:00.000Z";
  let publish: ((revisions: readonly AllocationRewriteRevision[]) => void) | null = null;
  let rewrote = false;
  const adapter: PersistenceAdapter = {
    loadAll: async () => emptyAppData(),
    saveAll: async (data) => {
      if (!rewrote) {
        rewrote = true;
        const flushedAllocation = requireValue(
          data.allocations.find((row) => row.id === allocation.id),
          "flushed allocation",
        );
        publish?.([
          {
            id: allocation.id,
            createdAt: allocation.createdAt,
            updatedAt: rewrittenAt,
            flushedUpdatedAt: flushedAllocation.updatedAt,
          },
        ]);
      }
    },
    setAllocationRewriteHandler: (handler) => {
      publish = handler;
    },
  };
  const detach = attachPersistence({ store: useStore, adapter: adapter, debounceMs: 0 });

  useStore.getState().updateAllocation(allocation.id, { note: "Trigger save" });
  await vi.waitFor(() => expect(useStore.getState().data.allocations[0]?.updatedAt).toBe(rewrittenAt));

  expect(useStore.getState().data.allocations[0]).not.toHaveProperty("projectId");
  detach();
});

it("attachPersistence keeps an allocation edit made while its rewrite receipt is in flight dirty", async () => {
  const { allocation, client } = addAllocationFixture("First");
  const secondProject = useStore.getState().addProject({ name: "Second", clientId: client.id, color: "#333333" });
  const rewrittenAt = "2030-01-02T00:00:00.000Z";
  let publish: ((revisions: readonly AllocationRewriteRevision[]) => void) | null = null;
  let releaseReceipt: (() => void) | null = null;
  const flushed = new Promise<void>((resolve) => {
    releaseReceipt = resolve;
  });
  const saved: AppData[] = [];
  const adapter: PersistenceAdapter = {
    loadAll: async () => emptyAppData(),
    saveAll: async (data) => {
      saved.push(data);
      if (saved.length !== 1) return;
      await flushed;
      const flushedAllocation = requireValue(
        data.allocations.find((row) => row.id === allocation.id),
        "flushed allocation",
      );
      publish?.([
        {
          id: allocation.id,
          createdAt: allocation.createdAt,
          updatedAt: rewrittenAt,
          flushedUpdatedAt: flushedAllocation.updatedAt,
        },
      ]);
    },
    setAllocationRewriteHandler: (handler) => {
      publish = handler;
    },
  };
  const detach = attachPersistence({ store: useStore, adapter: adapter, debounceMs: 0 });

  useStore.getState().updateAllocation(allocation.id, { note: "Flushed edit" });
  await vi.waitFor(() => expect(saved).toHaveLength(1));
  const flushedStamp = requireValue(
    requireValue(saved[0], "flushed snapshot").allocations.find((row) => row.id === allocation.id),
    "flushed allocation",
  ).updatedAt;
  useStore.getState().updateAllocation(allocation.id, { projectId: secondProject.id });
  const concurrentStamp = requireValue(
    useStore.getState().data.allocations.find((row) => row.id === allocation.id),
    "concurrently edited allocation",
  ).updatedAt;
  expect(concurrentStamp).not.toBe(flushedStamp);

  requireCallback(releaseReceipt, "rewrite receipt release")();
  await vi.waitFor(() => expect(saved).toHaveLength(2));

  const visible = requireValue(
    useStore.getState().data.allocations.find((row) => row.id === allocation.id),
    "visible allocation",
  );
  expect(visible.projectId).toBe(secondProject.id);
  expect(visible.updatedAt).toBe(concurrentStamp);
  expect(saved[1]?.allocations.find((row) => row.id === allocation.id)).toMatchObject({
    projectId: secondProject.id,
    updatedAt: concurrentStamp,
  });
  detach();
});

it("attachPersistence rejects a second live persistence owner", () => {
  const detach = attachPersistence({ store: useStore, adapter: new InMemoryDemoAdapter(), debounceMs: 0 });
  try {
    expect(() => attachPersistence({ store: useStore, adapter: new InMemoryDemoAdapter(), debounceMs: 0 })).toThrow(
      "Persistence is already attached.",
    );
  } finally {
    detach();
  }
});

it("attachPersistence persists data changes (immediate mode)", async () => {
  const adapter = new InMemoryDemoAdapter();
  const detach = attachPersistence({ store: useStore, adapter: adapter, debounceMs: 0 });
  useStore.getState().addClient({ name: "Acme", color: "#1" });
  const loaded = await adapter.loadAll();
  expect(loaded.clients).toHaveLength(1);
  detach();
});

it("attachPersistence persists the demo project cascade with attributed bookings unbound", async () => {
  const adapter = new InMemoryDemoAdapter();
  const resource = useStore.getState().addResource({
    kind: "person",
    name: "Bruce Wayne",
    role: "Designer",
    employmentType: "permanent",
    engagement: "studio",
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#111111",
  });
  const client = useStore.getState().addClient({ name: "Wayne Enterprises", color: "#111111" });
  const project = useStore.getState().addProject({ name: "Project", clientId: client.id, color: "#222222" });
  const activity = useStore.getState().addActivity({ name: "Shared", kind: "repeatable" });
  const allocation = useStore.getState().addAllocation({
    resourceId: resource.id,
    activityId: activity.id,
    projectId: project.id,
    startDate: "2026-06-01",
    endDate: "2026-06-01",
    hoursPerDay: 8,
    status: "confirmed",
  });

  await adapter.saveAll(deleteProjectCascade(useStore.getState().data, project.id, "2026-06-02T00:00:00.000Z"));
  const saved = await adapter.loadAll();
  expect(saved.allocations.find((row) => row.id === allocation.id)?.projectId).toBeUndefined();
});

it("attachPersistence stops persisting after detach", async () => {
  const adapter = new InMemoryDemoAdapter();
  const detach = attachPersistence({ store: useStore, adapter: adapter, debounceMs: 0 });
  detach();
  useStore.getState().addClient({ name: "Acme", color: "#1" });
  expect(await adapter.loadAll()).toEqual(emptyAppData());
});

it("attachPersistence detach cancels a pending debounce without initiating a cleanup write", async () => {
  vi.useFakeTimers();
  try {
    const saveAll = vi.fn().mockResolvedValue(undefined);
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll: async () => emptyAppData(), saveAll },
      debounceMs: 300,
    });
    useStore.getState().addClient({ name: "Pending at detach", color: "#111111" });
    detach();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(saveAll).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});

it("attachPersistence a rejected save settling after detach cannot callback, retry, or write over a new owner", async () => {
  vi.useFakeTimers();
  try {
    let rejectOld!: (error: unknown) => void;
    const oldSave = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectOld = reject;
        }),
    );
    const oldError = vi.fn();
    const oldSuccess = vi.fn();
    const detachOld = attachPersistence({
      store: useStore,
      adapter: { loadAll: async () => emptyAppData(), saveAll: oldSave },
      debounceMs: 0,
      onError: oldError,
      onSuccess: oldSuccess,
      serverMode: true,
    });
    useStore.getState().addClient({ name: "Old owner edit", color: "#111111" });
    expect(oldSave).toHaveBeenCalledOnce();
    detachOld();

    const newSave = vi.fn().mockResolvedValue(undefined);
    const detachNew = attachPersistence({
      store: useStore,
      adapter: { loadAll: async () => emptyAppData(), saveAll: newSave },
      debounceMs: 0,
      serverMode: true,
    });
    rejectOld(new Error("late network failure"));
    // The complete retry horizon is 31 seconds; stay below the independent one-minute
    // visible-session refresh owned by the replacement adapter.
    await vi.advanceTimersByTimeAsync(35_000);

    expect(oldSave).toHaveBeenCalledOnce();
    expect(oldError).not.toHaveBeenCalled();
    expect(oldSuccess).not.toHaveBeenCalled();
    useStore.getState().addClient({ name: "New owner edit", color: "#222222" });
    await vi.advanceTimersByTimeAsync(0);
    expect(newSave).toHaveBeenCalledOnce();
    expect(oldSave).toHaveBeenCalledOnce();
    detachNew();
  } finally {
    vi.useRealTimers();
  }
});

it("attachPersistence a conflict settling after detach cannot start the old owner's resolution reload", async () => {
  let rejectSave!: (error: unknown) => void;
  const saveAll = vi.fn(
    () =>
      new Promise<void>((_resolve, reject) => {
        rejectSave = reject;
      }),
  );
  const loadAll = vi.fn(async () => emptyAppData());
  const onError = vi.fn();
  const detach = attachPersistence({
    store: useStore,
    adapter: { loadAll, saveAll },
    debounceMs: 0,
    onError: onError,
    serverMode: true,
  });
  useStore.getState().addClient({ name: "Conflicted old edit", color: "#111111" });
  detach();

  rejectSave(new BatchConflictError("late conflict"));
  await Promise.resolve();
  await Promise.resolve();

  expect(loadAll).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(saveAll).toHaveBeenCalledOnce();
});

it("attachPersistence a successful save settling after detach cannot call the old owner's success callback", async () => {
  let resolveSave!: () => void;
  const saveAll = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  const onSuccess = vi.fn();
  const detach = attachPersistence({
    store: useStore,
    adapter: { loadAll: async () => emptyAppData(), saveAll },
    debounceMs: 0,
    onSuccess: onSuccess,
  });
  useStore.getState().addClient({ name: "Late success", color: "#111111" });
  detach();

  resolveSave();
  await Promise.resolve();
  await Promise.resolve();

  expect(onSuccess).not.toHaveBeenCalled();
  expect(saveAll).toHaveBeenCalledOnce();
});

it("attachPersistence flushes a pending debounced write on pagehide (so a tab close does not lose it)", async () => {
  const adapter = new InMemoryDemoAdapter();
  const detach = attachPersistence({ store: useStore, adapter: adapter, debounceMs: 300 }); // debounced, NOT immediate
  useStore.getState().addClient({ name: "Acme", color: "#1" });
  expect((await adapter.loadAll()).clients).toHaveLength(0); // still inside the debounce window
  window.dispatchEvent(new Event("pagehide"));
  expect((await adapter.loadAll()).clients).toHaveLength(1); // flushed synchronously
  detach();
});

it("attachPersistence uses the normal save path when a surviving tab becomes hidden", async () => {
  const saveAll = vi.fn().mockResolvedValue(undefined);
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  const detach = attachPersistence({
    store: useStore,
    adapter: { loadAll: async () => emptyAppData(), saveAll },
    debounceMs: 300,
  });
  useStore.getState().addClient({ name: "Hidden tab", color: "#111111" });

  document.dispatchEvent(new Event("visibilitychange"));
  await Promise.resolve();

  expect(saveAll).toHaveBeenCalledOnce();
  expect(requireValue(saveAll.mock.calls[0], "initial saveAll call")[1]).toBeUndefined();
  visibility.mockRestore();
  detach();
});

it("attachPersistence keeps a newer failed teardown snapshot dirty when an older normal save later succeeds", async () => {
  vi.useFakeTimers();
  try {
    let releaseFirst: (() => void) | null = null;
    const normalSnapshots: AppData[] = [];
    const saveAll = vi.fn((data: AppData, opts?: { unload?: boolean }): Promise<void> => {
      if (opts?.unload) return Promise.reject(new Error("keepalive dropped"));
      normalSnapshots.push(data);
      if (normalSnapshots.length === 1) {
        return new Promise((resolve) => {
          releaseFirst = resolve;
        });
      }
      return Promise.resolve();
    });
    const onError = vi.fn();
    const detach = attachPersistence({
      store: useStore,
      adapter: { loadAll: async () => emptyAppData(), saveAll },
      debounceMs: 300,
      onError: onError,
    });

    useStore.getState().addClient({ name: "First", color: "#111111" });
    await vi.advanceTimersByTimeAsync(300); // first normal save is now in flight
    useStore.getState().addClient({ name: "Latest", color: "#222222" }); // still debounced
    window.dispatchEvent(new Event("pagehide")); // newer teardown save rejects
    await Promise.resolve();
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "keepalive dropped" }));
    expect(hasUnsavedPersistenceWrites()).toBe(true);

    requireCallback(releaseFirst, "first save release")(); // the older success must not cancel the newer snapshot's retry
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);

    expect(normalSnapshots).toHaveLength(2);
    expect(normalSnapshots[1]?.clients.some((client) => client.name === "Latest")).toBe(true);
    expect(hasUnsavedPersistenceWrites()).toBe(false);
    detach();
  } finally {
    vi.useRealTimers();
  }
});

it("attachPersistence keeps a lifecycle-only pagehide deletion dirty until its archive keepalive is confirmed", async () => {
  const slice = a2Slice();
  let failKeepalive = true;
  const archiveRequests: Array<{ keepalive?: boolean }> = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes("/api/state")) return new Response(JSON.stringify(slice), { status: 200 });
    if (url.endsWith("/api/batch") && init?.keepalive) {
      const ops = (JSON.parse(init.body as string) as { ops: Array<{ method: string }> }).ops;
      if (ops.some((op) => op.method === "ARCHIVE")) {
        archiveRequests.push({ keepalive: true });
        if (failKeepalive) throw new Error("lifecycle keepalive dropped");
      }
      return new Response(
        JSON.stringify({
          ok: true,
          applied: ops.length,
          revisions: [],
          archives: ops
            .filter((op) => op.method === "ARCHIVE")
            .map(() => ({ table: "clients", id: "c2", archived: true })),
        }),
        { status: 200 },
      );
    }
    if (url.endsWith("/clients/c2/archive")) {
      archiveRequests.push(init?.keepalive === undefined ? {} : { keepalive: init.keepalive });
      if (failKeepalive) throw new Error("lifecycle keepalive dropped");
      return new Response("{}", { status: 200 });
    }
    return new Response(JSON.stringify({ ok: true, applied: 0, revisions: [] }), { status: 200 });
  }) as unknown as typeof fetch;
  const adapter = new ServerSyncAdapter("http://x", fetchImpl);
  const onError = vi.fn();
  const detach = await attachActiveA2({ adapter: adapter, debounceMs: 300, onError: onError });

  useStore.getState().replaceAll({
    ...useStore.getState().data,
    clients: useStore.getState().data.clients.filter((client) => client.id !== "c2"),
  });
  window.dispatchEvent(new Event("pagehide"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(archiveRequests).toEqual([{ keepalive: true }]);
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "lifecycle keepalive dropped" }));
  expect(hasUnsavedPersistenceWrites()).toBe(true);

  // A bfcache-surviving page retries through the ordinary foreground path and only then becomes
  // clean. visibilitychange also cancels the scheduled backoff, keeping this deterministic.
  failKeepalive = false;
  const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
  document.dispatchEvent(new Event("visibilitychange"));
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(archiveRequests).toEqual([{ keepalive: true }, { keepalive: undefined }]);
  expect(hasUnsavedPersistenceWrites()).toBe(false);
  visibility.mockRestore();
  detach();
});

it("attachPersistence reports a failed write via onError, then a recovered write via onSuccess", async () => {
  // A transient write failure (e.g. server unreachable) should fire onError; the
  // next successful write must fire onSuccess so the caller can clear the banner.
  const adapter = new InMemoryDemoAdapter();
  const realSave = adapter.saveAll.bind(adapter);
  let calls = 0;
  vi.spyOn(adapter, "saveAll").mockImplementation(async (d) => {
    calls += 1;
    if (calls === 1) throw new Error("write unavailable");
    return realSave(d);
  });
  const onError = vi.fn();
  const onSuccess = vi.fn();
  const detach = attachPersistence({
    store: useStore,
    adapter: adapter,
    debounceMs: 0,
    onError: onError,
    onSuccess: onSuccess,
  });

  useStore.getState().addClient({ name: "A", color: "#111111" });
  await new Promise((r) => setTimeout(r, 5));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onSuccess).not.toHaveBeenCalled();

  useStore.getState().addClient({ name: "B", color: "#222222" });
  await new Promise((r) => setTimeout(r, 5));
  expect(onSuccess).toHaveBeenCalled();
  detach();
});

it("attachPersistence retries a failed write in the background without waiting for another edit", async () => {
  // Server-backed mode has no localStorage fallback: if a write fails and the user
  // reloads before their next edit, unsynced changes would be lost. A bounded
  // background retry (re-sending the latest store state) self-heals once the
  // adapter recovers — proven here with a one-shot failure + a short backoff.
  vi.useFakeTimers();
  try {
    const adapter = new InMemoryDemoAdapter();
    const realSave = adapter.saveAll.bind(adapter);
    let calls = 0;
    vi.spyOn(adapter, "saveAll").mockImplementation(async (d) => {
      calls += 1;
      if (calls === 1) throw new Error("temporarily unavailable");
      return realSave(d);
    });
    const onSuccess = vi.fn();
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 0,
      onSuccess: onSuccess,
    });

    useStore.getState().addClient({ name: "Retry Me", color: "#333333" });
    await vi.advanceTimersByTimeAsync(0); // first attempt → fails, schedules retry
    expect(calls).toBe(1);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(readPersistenceDiagnosticsSnapshot()).toMatchObject({ savesFailed: 1, retriesArmed: 1 });

    await vi.advanceTimersByTimeAsync(1000); // backoff #1 (2^0 * 1000ms) → succeeds
    expect(calls).toBe(2);
    expect(onSuccess).toHaveBeenCalled();
    expect((await adapter.loadAll()).clients.some((c) => c.name === "Retry Me")).toBe(true);
    detach();
  } finally {
    vi.useRealTimers();
  }
});

it("attachPersistence re-attempts a write stranded after the retry budget is spent when the browser comes back online", async () => {
  // The bounded retry budget stops a PERMANENTLY-failing write from retrying forever, but a
  // mere network outage shouldn't strand the delta until the next edit: an `online` event
  // re-attempts it with a fresh budget (so a reload after recovery doesn't lose it).
  vi.useFakeTimers();
  try {
    const adapter = new InMemoryDemoAdapter();
    const realSave = adapter.saveAll.bind(adapter);
    let online = false;
    vi.spyOn(adapter, "saveAll").mockImplementation(async (d) => {
      if (!online) throw new Error("offline");
      return realSave(d);
    });
    const onSuccess = vi.fn();
    const detach = attachPersistence({
      store: useStore,
      adapter: adapter,
      debounceMs: 0,
      onSuccess: onSuccess,
    });

    useStore.getState().addClient({ name: "Stranded", color: "#444444" });
    await vi.advanceTimersByTimeAsync(0); // initial attempt fails
    await vi.advanceTimersByTimeAsync(60_000); // 1+2+4+8+16s backoffs all fail → budget exhausted
    expect(onSuccess).not.toHaveBeenCalled();

    // A bare `online` while still failing would also be gated by failedSinceSuccess; here
    // the connection truly returns, so the re-attempt lands.
    online = true;
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(0);
    expect(onSuccess).toHaveBeenCalled();
    expect((await adapter.loadAll()).clients.some((c) => c.name === "Stranded")).toBe(true);
    detach();
  } finally {
    vi.useRealTimers();
  }
});

it("attachPersistence does NOT re-write on an online event when nothing is stranded (no needless full rewrite)", async () => {
  const adapter = new InMemoryDemoAdapter();
  const saveAll = vi.spyOn(adapter, "saveAll");
  const detach = attachPersistence({ store: useStore, adapter: adapter, debounceMs: 0 });
  useStore.getState().addClient({ name: "Synced", color: "#555555" });
  await new Promise((r) => setTimeout(r, 5));
  const callsAfterSync = saveAll.mock.calls.length;
  // No prior failure → an online event is a no-op (gated on failedSinceSuccess).
  window.dispatchEvent(new Event("online"));
  await new Promise((r) => setTimeout(r, 5));
  expect(saveAll.mock.calls.length).toBe(callsAfterSync);
  detach();
});
