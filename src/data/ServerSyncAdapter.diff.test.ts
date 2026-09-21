import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter, diffOps } from "./ServerSyncAdapter";
import { diffOpsFromPossibleBases } from "./syncOps";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { cacheAccountSlice, readOfflineStateSnapshot } from "./offlineCache";
import {
  TS1,
  TS2,
  client,
  project,
  withData,
  scopedData,
  commitReceipt,
  required,
  withOfflineCache,
} from "./ServerSyncAdapter.testSupport";

// Unit tests for the diff engine and the sync flush, with a fake fetch. Proves:
// the diff classifies create/update/delete correctly, orders parent-before-child for
// upserts and child-before-parent for deletes, advances the snapshot only on full
// success (so a failure replays), and coalesces overlapping saves.

describe("auth-awareness (P3.4)", () => {
  it("sends credentials on every request so a session cookie reaches an auth-enabled server", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      if (String(url).endsWith("/api/state")) return new Response(JSON.stringify(emptyAppData()), { status: 200 });
      if (String(url).endsWith("/api/meta"))
        return new Response(JSON.stringify({ hasData: false }), {
          status: 200,
        });
      return commitReceipt(init);
    });
    const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);
    await adapter.loadAll();
    await adapter.hasExisting();
    await adapter.saveAll(withData({ clients: [client("c1")] }));
    expect(calls.length).toBeGreaterThanOrEqual(3); // state, meta, batch
    for (const { url, init } of calls) {
      expect(init?.credentials, url).toBe("include");
    }
  });

  it("rejects a meta response whose hasData field is not boolean", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ hasData: "yes" }), { status: 200 }),
    ) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://api.test", fetchImpl);

    await expect(adapter.hasExisting()).rejects.toThrow("invalid meta payload");
  });
});

describe("offline transport fallback", () => {
  it("uses a verified cached identity for an unscoped transport failure", async () => {
    await withOfflineCache(async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
      const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);

      await expect(adapter.loadAll()).resolves.toEqual(emptyAppData());
      expect(readOfflineStateSnapshot()).toMatchObject({ readOnly: true });
    });
  });

  it.each([
    ["reaches its deadline", () => Promise.reject(new DOMException("signal timed out", "TimeoutError"))],
    ["returns a server failure", () => Promise.resolve(new Response(null, { status: 503 }))],
  ])("does not use a cached account slice when the state request %s", async (_condition, request) => {
    await withOfflineCache(async () => {
      const cached = scopedData("a1", {});
      required(cached.clients[0]).color = "#2d75da"; // a real preset, so cache sanitisation is identity-preserving
      await cacheAccountSlice("a1", cached);
      const fetchImpl = vi.fn(request);
      const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);

      await expect(adapter.loadAll("a1")).rejects.toThrow(/Failed to load state|signal timed out/);
      expect(readOfflineStateSnapshot()).toMatchObject({ readOnly: false });
    });
  });

  it("does not use the scoped cache for a client rejection", async () => {
    await withOfflineCache(async () => {
      await cacheAccountSlice("a1", scopedData("a1", {}));
      const clientRejection = new ServerSyncAdapter(
        "http://api.test",
        vi.fn(async () => new Response(null, { status: 403 })) as unknown as typeof fetch,
      );
      await expect(clientRejection.loadAll("a1")).rejects.toThrow("Failed to load state (403)");
      expect(readOfflineStateSnapshot()).toMatchObject({ readOnly: false });
    });
  });
});

function expectCompensatingFinalStateOps(): void {
  const before = withData({ clients: [client("c1", TS1)] });
  const dispatched = withData({
    clients: [{ ...client("c1", TS2), name: "In flight" }],
    disciplines: [
      {
        id: "d1",
        accountId: "a1",
        name: "Temporary",
        color: "#3b82f6",
        sortOrder: 0,
        createdAt: TS1,
        updatedAt: TS1,
      },
    ],
  });
  const latest = before; // both the c1 rename and d1 creation were undone before acknowledgement

  const ops = diffOpsFromPossibleBases([before, dispatched], latest);

  expect(ops).toEqual([
    expect.objectContaining({
      method: "PUT",
      table: "clients",
      id: "c1",
      row: before.clients[0],
    }),
    expect.objectContaining({
      method: "DELETE",
      table: "disciplines",
      id: "d1",
      accountId: "a1",
      updatedAt: TS1,
    }),
  ]);
}

describe("diffOps", () => {
  it("emits PUT for new rows, parent-before-child", () => {
    const next = withData({
      clients: [client("c1")],
      projects: [project("p1", "c1")],
    });
    const ops = diffOps(emptyAppData(), next);
    expect(ops.map((o) => `${o.method} ${o.table}/${o.id}`)).toEqual(["PUT clients/c1", "PUT projects/p1"]);
  });

  it("emits PUT only for rows whose updatedAt changed", () => {
    const prev = withData({ clients: [client("c1", TS1)] });
    const next = withData({ clients: [client("c1", TS2)] }); // edited
    expect(diffOps(prev, next)).toHaveLength(1);
    // unchanged row → no op
    expect(diffOps(prev, prev)).toHaveLength(0);
  });

  it("emits DELETE for removed rows, child-before-parent", () => {
    const prev = withData({
      clients: [client("c1")],
      projects: [project("p1", "c1")],
    });
    const next = emptyAppData(); // both gone (e.g. cascade delete of the client)
    const ops = diffOps(prev, next);
    expect(ops.map((o) => `${o.method} ${o.table}/${o.id}`)).toEqual([
      "DELETE projects/p1", // child first
      "DELETE clients/c1",
    ]);
  });

  it("orders all upserts before all deletes (so a reparent lands before the old parent is deleted)", () => {
    const prev = withData({ clients: [client("old")] });
    const next = withData({ clients: [client("new")] });
    const ops = diffOps(prev, next);
    expect(ops[0]).toMatchObject({ method: "PUT", id: "new" });
    expect(ops[1]).toMatchObject({ method: "DELETE", id: "old" });
  });

  it("tags a scoped-entity DELETE with its owning account; accounts (top-level) carry none", () => {
    const row = {
      id: "a1",
      name: "Co",
      color: "#5c34d4",
      createdAt: TS1,
      updatedAt: TS1,
    };
    const ops = diffOps(withData({ accounts: [row], clients: [client("c1")] }), emptyAppData());
    expect(ops.find((o) => o.table === "clients")).toMatchObject({
      method: "DELETE",
      id: "c1",
      accountId: "a1",
      updatedAt: TS1,
    });
    expect(ops.find((o) => o.table === "accounts")?.accountId).toBeUndefined();
  });

  it(
    "builds compensating final-state ops against both sides of an unacknowledged request",
    expectCompensatingFinalStateOps,
  );
});
