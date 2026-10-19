import { beforeEach, expect, it, vi } from "vitest";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import { opsFromInit } from "./ServerSyncAdapter.testSupport";
import { attachActiveA2, a2Slice, deferredSignal } from "./__tests__/persistTestKit";
import { flushPendingWrites, hasUnsavedPersistenceWrites, refreshActiveAccountSlice } from "./persist";
import { useStore } from "@/store/useStore";
import { makeResource, makeActivity, makeAllocation, resetStoreWithAccount } from "@/test/fixtures";

beforeEach(() => {
  localStorage.clear();
  resetStoreWithAccount();
});

async function attachAcknowledgingServer(options: { holdFirst?: boolean } = {}) {
  let remote = {
    ...a2Slice(),
    resources: [makeResource({ accountId: "a2", name: "Tony Stark" })],
    activities: [makeActivity({ accountId: "a2", kind: "internal", projectId: null })],
    allocations: [makeAllocation({ accountId: "a2" })],
  };
  const release = deferredSignal();
  const releaseSecond = deferredSignal();
  let batches = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/api/state")) return Response.json(remote);
    batches += 1;
    const batch = batches;
    const ops = opsFromInit(init);
    if (batch === 1 && options.holdFirst) await release.promise;
    if (batch === 2 && options.holdFirst) await releaseSecond.promise;
    const revisions = ops.flatMap((op) => {
      if (!op.row) return [];
      if (op.table !== "allocations") throw new Error("Expected allocation update");
      const existing = remote.allocations.find((row) => row.id === op.id);
      if (!existing) throw new Error("Expected existing allocation");
      const row = { ...existing, ...op.row, updatedAt: `2026-10-19T17:31:2${batch}.111Z` };
      remote = { ...remote, allocations: remote.allocations.map((item) => (item.id === op.id ? row : item)) };
      return [{ table: op.table, id: op.id, createdAt: row.createdAt, updatedAt: row.updatedAt }];
    });
    return Response.json({ ok: true, applied: ops.length, revisions });
  });
  const adapter = new ServerSyncAdapter("http://x", fetchImpl as typeof fetch);
  const detach = await attachActiveA2({ adapter });
  return {
    detach,
    release,
    releaseSecond,
    readRemote: () => remote,
    replaceRemote: (data: typeof remote) => {
      remote = data;
    },
    readBatches: () => batches,
  };
}

it("keeps a saved allocation resize undoable after authoritative refresh without echo writes", async () => {
  const server = await attachAcknowledgingServer();
  try {
    useStore.getState().updateAllocation("a1", { endDate: "2026-06-03" });
    expect(await flushPendingWrites()).toEqual({ kind: "clean" });
    expect(hasUnsavedPersistenceWrites()).toBe(false);
    expect(server.readBatches()).toBe(1);
    await refreshActiveAccountSlice("a2");
    expect(useStore.getState().past).toHaveLength(1);
    useStore.getState().undo();
    expect(useStore.getState().data.allocations[0]?.endDate).toBe("2026-06-02");
    expect(await flushPendingWrites()).toEqual({ kind: "clean" });
    await refreshActiveAccountSlice("a2");
    expect(useStore.getState().future).toHaveLength(1);
    useStore.getState().redo();
    expect(useStore.getState().data.allocations[0]?.endDate).toBe("2026-06-03");
  } finally {
    server.detach();
  }
});

it.each(["revision", "addition", "deletion"])("invalidates saved history for a genuine remote %s", async (change) => {
  const server = await attachAcknowledgingServer();
  try {
    useStore.getState().updateAllocation("a1", { endDate: "2026-06-03" });
    await flushPendingWrites();
    const remote = server.readRemote();
    const allocation = remote.allocations[0];
    if (!allocation) throw new Error("Expected saved allocation");
    let allocations = [{ ...allocation, updatedAt: "2026-10-19T17:32:00.000Z" }];
    if (change === "deletion") allocations = [];
    if (change === "addition") allocations = [...remote.allocations, { ...allocation, id: "remote-allocation" }];
    server.replaceRemote({ ...remote, allocations });
    await refreshActiveAccountSlice("a2");
    expect(useStore.getState().past).toHaveLength(0);
    useStore.getState().undo();
    expect(useStore.getState().data.allocations).toEqual(server.readRemote().allocations);
  } finally {
    server.detach();
  }
});

it("preserves a newer queued edit while the older receipt arrives and then acknowledges both", async () => {
  const server = await attachAcknowledgingServer({ holdFirst: true });
  try {
    useStore.getState().updateAllocation("a1", { endDate: "2026-06-03" });
    await vi.waitFor(() => expect(server.readBatches()).toBe(1));
    useStore.getState().updateAllocation("a1", { endDate: "2026-06-04" });
    const newer = useStore.getState().data.allocations[0];
    server.release.resolve();
    await vi.waitFor(() => expect(server.readBatches()).toBe(2));
    // The second receipt is still held: the first must not replace the newer client stamp.
    expect(useStore.getState().data.allocations[0]).toBe(newer);
    expect(hasUnsavedPersistenceWrites()).toBe(true);
    server.releaseSecond.resolve();
    expect(await flushPendingWrites()).toEqual({ kind: "clean" });
    expect(server.readBatches()).toBe(2);
    expect(server.readRemote().allocations[0]?.endDate).toBe(newer?.endDate);
    await refreshActiveAccountSlice("a2");
    expect(useStore.getState().past).toHaveLength(2);
    useStore.getState().undo();
    expect(useStore.getState().data.allocations[0]?.endDate).toBe("2026-06-03");
  } finally {
    server.release.resolve();
    server.releaseSecond.resolve();
    server.detach();
  }
});

it("does not publish an old receipt to a detached persistence owner", async () => {
  const server = await attachAcknowledgingServer({ holdFirst: true });
  useStore.getState().updateAllocation("a1", { endDate: "2026-06-03" });
  await vi.waitFor(() => expect(server.readBatches()).toBe(1));
  server.detach();
  const data = useStore.getState().data;
  server.release.resolve();
  await vi.waitFor(() => expect(server.readRemote().allocations[0]?.endDate).toBe("2026-06-03"));
  expect(useStore.getState().data).toBe(data);
});
