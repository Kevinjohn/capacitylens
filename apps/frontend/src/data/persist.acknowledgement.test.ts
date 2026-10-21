import { beforeEach, expect, it, vi } from "vitest";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import { opsFromInit } from "./ServerSyncAdapter.testSupport";
import { attachActiveA2, a2Slice, deferredSignal } from "./__tests__/persistTestKit";
import { flushPendingWrites, hasUnsavedPersistenceWrites, refreshActiveAccountSlice } from "./persist";
import { useStore } from "@/store/useStore";
import { makeResource, makeActivity, requireValue, resetStoreWithAccount } from "@/test/fixtures";
import { requireCreated } from "@/test/requireCreated";

beforeEach(async () => {
  localStorage.clear();
  await resetStoreWithAccount();
});

async function attachAcknowledgingServer(options: { holdFirst?: boolean } = {}) {
  let remote = {
    ...a2Slice(),
    resources: [makeResource({ accountId: "a2", name: "Tony Stark" })],
    activities: [makeActivity({ accountId: "a2", kind: "internal", projectId: null })],
  };
  const release = deferredSignal();
  const tables: string[] = [];
  let batches = 0;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).includes("/api/state")) return Response.json(remote);
    batches += 1;
    const ops = opsFromInit(init);
    if (batches === 1 && options.holdFirst) await release.promise;
    const revisions = ops.flatMap((op) => {
      tables.push(op.table);
      if (!op.row || op.table !== "resources") throw new Error("Expected a resource update");
      const row = { ...remote.resources[0], ...op.row, updatedAt: `2026-10-19T17:31:2${batches}.111Z` };
      remote = { ...remote, resources: [row as (typeof remote.resources)[number]] };
      return [{ table: op.table, id: op.id, createdAt: row.createdAt, updatedAt: row.updatedAt }];
    });
    return Response.json({ ok: true, applied: ops.length, revisions });
  });
  const adapter = new ServerSyncAdapter("http://x", fetchImpl as typeof fetch);
  const detach = await attachActiveA2({ adapter });
  return { detach, release, readRemote: () => remote, readBatches: () => batches, readTables: () => tables };
}

async function addTypedAllocation() {
  return requireCreated(
    await useStore.getState().addAllocation({
      resourceId: "r1",
      activityId: "t1",
      projectId: null,
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      hoursPerDay: 8,
      status: "confirmed",
    }),
  );
}

it("keeps a typed allocation resize undoable across a legacy refresh without batch writes", async () => {
  const server = await attachAcknowledgingServer();
  try {
    const allocation = await addTypedAllocation();
    await useStore.getState().updateAllocation(allocation.id, { endDate: "2026-06-03" });
    expect(await flushPendingWrites()).toEqual({ kind: "clean" });
    expect(hasUnsavedPersistenceWrites()).toBe(false);
    expect(server.readBatches()).toBe(0);
    await refreshActiveAccountSlice("a2");
    // The legacy reload installs every other table but keeps the controller's allocation rows.
    expect(useStore.getState().data.allocations.map((row) => row.endDate)).toEqual(["2026-06-03"]);
    expect(useStore.getState().planning.history.past).toHaveLength(2);
    expect(await useStore.getState().undoPlanning()).toBe(true);
    expect(useStore.getState().data.allocations[0]?.endDate).toBe("2026-06-02");
    expect(server.readBatches()).toBe(0);
  } finally {
    server.detach();
  }
});

it("reads the planning revision again after acknowledging a legacy write", async () => {
  const server = await attachAcknowledgingServer();
  const refreshPlanning = useStore.getState().refreshPlanning;
  const spy = vi.fn(refreshPlanning);
  useStore.setState({ refreshPlanning: spy });
  try {
    useStore.getState().updateResource("r1", { name: "Pepper Potts" });
    expect(await flushPendingWrites()).toEqual({ kind: "clean" });
    expect(server.readTables()).toEqual(["resources"]);
    expect(spy).toHaveBeenCalled();
  } finally {
    useStore.setState({ refreshPlanning });
    server.detach();
  }
});

it("reads the planning snapshot again alongside every legacy reload", async () => {
  const server = await attachAcknowledgingServer();
  const refreshPlanning = useStore.getState().refreshPlanning;
  const spy = vi.fn(refreshPlanning);
  useStore.setState({ refreshPlanning: spy });
  try {
    await refreshActiveAccountSlice("a2");
    expect(spy).toHaveBeenCalled();
  } finally {
    useStore.setState({ refreshPlanning });
    server.detach();
  }
});

it("does not publish an old receipt to a detached persistence owner", async () => {
  const server = await attachAcknowledgingServer({ holdFirst: true });
  useStore.getState().updateResource("r1", { name: "Pepper Potts" });
  await vi.waitFor(() => expect(server.readBatches()).toBe(1));
  server.detach();
  const data = useStore.getState().data;
  server.release.resolve();
  await vi.waitFor(() =>
    expect(requireValue(server.readRemote().resources[0], "remote resource").name).toBe("Pepper Potts"),
  );
  expect(useStore.getState().data).toBe(data);
});
