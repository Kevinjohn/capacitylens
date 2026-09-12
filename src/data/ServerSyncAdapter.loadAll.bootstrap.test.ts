import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { readOfflineStateSnapshot, setOfflineReadState } from "./offlineCache";
import { batchOps, client, project, withData, account, commitReceipt } from "./ServerSyncAdapter.testSupport";

function registerBootstrapLoadTests(): void {
  it("treats an unscoped 400 as an empty pre-account bootstrap without parsing its body", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json", { status: 400 })) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);

    setOfflineReadState("tenant", true);
    try {
      await expect(adapter.loadAll()).resolves.toEqual(emptyAppData());
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(readOfflineStateSnapshot()).toMatchObject({ readOnly: false });
    } finally {
      setOfflineReadState("cleanup", false);
    }
  });
}

function registerInternalRepairLoadTests(): void {
  it("persists a synthesized Internal before acknowledging a repaired hydration snapshot", async () => {
    const raw = withData({ accounts: [account("a1")] });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, ...(init ? { init } : {}) });
      if (url.includes("/api/state")) return new Response(JSON.stringify(raw), { status: 200 });
      return commitReceipt(init);
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);

    const loaded = await adapter.loadAll("a1");

    expect(loaded.clients).toEqual([
      expect.objectContaining({
        id: "internal:a1",
        accountId: "a1",
        builtin: true,
      }),
    ]);
    expect(calls.map(({ url }) => url)).toEqual(["http://x/api/state?accountId=a1", "http://x/api/batch"]);
    expect(batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[1])).toEqual([
      expect.objectContaining({
        method: "PUT",
        table: "clients",
        id: "internal:a1",
      }),
    ]);

    const callsAfterHydration = calls.length;
    await adapter.saveAll(loaded);
    expect(calls).toHaveLength(callsAfterHydration);

    await adapter.saveAll({
      ...loaded,
      projects: [project("dependent-project", "internal:a1")],
    });
    expect(calls.map(({ url }) => url)).toEqual([
      "http://x/api/state?accountId=a1",
      "http://x/api/batch",
      "http://x/api/batch",
    ]);
    expect(batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[2])).toEqual([
      expect.objectContaining({
        method: "PUT",
        table: "projects",
        id: "dependent-project",
      }),
    ]);
  });
}

function registerInternalRepairFailureTests(): void {
  it("rejects hydration when a required Internal repair cannot be committed", async () => {
    const raw = withData({ accounts: [account("a1")] });
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("/api/state")) return new Response(JSON.stringify(raw), { status: 200 });
      return new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
      });
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);

    await expect(adapter.loadAll("a1")).rejects.toThrow("Batch sync failed (403)");
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // The failed write was not acknowledged: a retry re-reads and attempts the repair again.
    await expect(adapter.loadAll("a1")).rejects.toThrow("Batch sync failed (403)");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[3])).toEqual([
      expect.objectContaining({
        method: "PUT",
        table: "clients",
        id: "internal:a1",
      }),
    ]);
  });
}

function registerBaseLoadTests(): void {
  it("GETs /api/state (no-arg whole read, OFF/fallback), migrates, and seeds the snapshot so the next save diffs against it", async () => {
    const state = withData({ clients: [client("c1")] });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/state")) return new Response(JSON.stringify(state), { status: 200 });
      return commitReceipt(init);
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const loaded = await a.loadAll();
    expect(loaded.clients.some((row) => row.id === "c1")).toBe(true);
    // Saving the identical state must emit zero writes (snapshot == loaded).
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await a.saveAll(state);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(calls);
  });

  it("tolerates a MISSING table key (rolling deploy: new client, older server) but rejects a PRESENT non-array table", async () => {
    // DEPLOYMENT CONTRACT: a version-skewed OLDER server may OMIT a table this newer client already
    // knows about; that MISSING key hydrates as empty via migrate()/normalize rather than failing the
    // WHOLE load (which would be a total outage on every rolling deploy). But a key that is PRESENT
    // and NOT an array is a corrupt/incomplete payload masquerading as empty data — a HARD failure.
    const missing = new ServerSyncAdapter(
      "http://x",
      vi.fn(async () => new Response(JSON.stringify({ accounts: [] }), { status: 200 })) as unknown as typeof fetch,
    );
    const loaded = await missing.loadAll();
    expect(loaded.clients).toEqual([]); // a missing table hydrated empty — no throw
    expect(loaded.resources).toEqual([]);

    const wrongType = new ServerSyncAdapter(
      "http://x",
      vi.fn(
        async () => new Response(JSON.stringify({ ...emptyAppData(), resources: { bad: true } }), { status: 200 }),
      ) as unknown as typeof fetch,
    );
    await expect(wrongType.loadAll()).rejects.toThrow("invalid state payload");
  });
}

describe("ServerSyncAdapter.loadAll", () => {
  registerBootstrapLoadTests();
  registerInternalRepairLoadTests();
  registerInternalRepairFailureTests();
  registerBaseLoadTests();
});
