import { describe, it, expect, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import {
  ServerSyncAdapter,
  BatchCommitUncertainError,
  BatchConflictError,
  BatchTooLargeError,
  BatchValidationError,
  LifecycleRestoreError,
  KeepaliveNotDispatchedError,
  MAX_OPS_PER_BATCH,
  diffOps,
  applyOps,
} from "./ServerSyncAdapter";
import { diffOpsFromPossibleBases } from "./syncOps";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type {
  Account,
  Allocation,
  AppData,
  Client,
  Discipline,
  Project,
  TimeOff,
} from "@capacitylens/shared/types/entities";
import {
  cacheAccountSlice,
  cacheAuthSnapshot,
  clearAllOfflineData,
  offlineStateSnapshot,
  readCachedAccountSlice,
  setOfflineReadState,
  type OfflineAuthSnapshot,
} from "./offlineCache";
import { AUDIT_WARNING_EVENT } from "../lib/auditWarning";
import { makeResource } from "../test/fixtures";

// Unit tests for the diff engine and the sync flush, with a fake fetch. Proves:
// the diff classifies create/update/delete correctly, orders parent-before-child for
// upserts and child-before-parent for deletes, advances the snapshot only on full
// success (so a failure replays), and coalesces overlapping saves.

const TS1 = "2026-01-01T00:00:00.000Z";
const TS2 = "2026-01-02T00:00:00.000Z";
const client = (id: string, updatedAt = TS1): Client => ({
  id,
  accountId: "a1",
  name: "Acme",
  color: "#3b82f6",
  createdAt: TS1,
  updatedAt,
});
const project = (id: string, clientId: string, updatedAt = TS1): Project => ({
  id,
  accountId: "a1",
  name: "Web",
  clientId,
  color: "#3b82f6",
  createdAt: TS1,
  updatedAt,
});
const allocation = (id: string, startDate: Allocation["startDate"]): Allocation => ({
  id,
  accountId: "a1",
  resourceId: "r1",
  activityId: "t1",
  startDate,
  endDate: startDate,
  hoursPerDay: 8,
  status: "confirmed",
  createdAt: TS1,
  updatedAt: TS1,
});

const withData = (over: Partial<AppData>): AppData => ({
  ...emptyAppData(),
  ...over,
});
const account = (id: string): Account => ({
  id,
  name: `Account ${id}`,
  color: "#5c34d4",
  createdAt: TS1,
  updatedAt: TS1,
});
const scopedData = (accountId: string, over: Partial<AppData>): AppData =>
  withData({
    ...over,
    accounts: [account(accountId)],
    clients: [
      ...(over.clients ?? []),
      {
        id: `internal:${accountId}`,
        accountId,
        name: "Internal",
        color: "#2d75da",
        builtin: true,
        createdAt: TS1,
        updatedAt: TS1,
      },
    ],
  });

// Drop known table keys from a slice to simulate an OLDER server omitting them (rolling-deploy skew).
const omitKeys = (data: AppData, ...keys: string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).filter(([key]) => !keys.includes(key)));

interface ReceiptOp {
  method: string;
  table: string;
  id: string;
  row?: { createdAt?: unknown; updatedAt?: unknown };
}

const revisionFor = (op: ReceiptOp) => ({
  table: op.table,
  id: op.id,
  createdAt: typeof op.row?.createdAt === "string" ? op.row.createdAt : TS1,
  updatedAt: typeof op.row?.updatedAt === "string" ? op.row.updatedAt : TS1,
});

const commitReceipt = (init?: RequestInit): Response => {
  let ops: ReceiptOp[] = [];
  if (typeof init?.body === "string") {
    try {
      ops = (JSON.parse(init.body) as { ops?: ReceiptOp[] }).ops ?? [];
    } catch {
      // Tests that exercise malformed bodies do not use this helper.
    }
  }
  return new Response(
    JSON.stringify({
      ok: true,
      applied: ops.length,
      revisions: ops.filter((op) => op.method === "PUT").map(revisionFor),
      archives: ops
        .filter((op) => op.method === "ARCHIVE")
        .map((op) => ({ table: op.table, id: op.id, archived: true })),
    }),
    { status: 200 },
  );
};

describe("auth-awareness (P3.4)", () => {
  it("sends credentials on every request so a session cookie reaches an auth-enabled server", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
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

// ── Shared offline-cache scenario harness ─────────────────────────────────────────────────────────
// Every offline test needs the same world: a fresh IndexedDB, the offline-read preference switched
// on, and a verified cached identity — plus a finally block that unwinds all three. Hoisted so the
// scenarios below carry only what actually differs (persist.test.ts's shared-helper idiom).

/** The verified `/me` snapshot every offline scenario is cached against. */
const OFFLINE_IDENTITY: OfflineAuthSnapshot = {
  authMode: "password",
  user: {
    id: "offline-user",
    email: "offline@example.test",
    name: "Offline user",
  },
  canCreateAccount: false,
  multiAccount: false,
};

async function withOfflineCache(run: () => Promise<void>): Promise<void> {
  vi.stubGlobal("indexedDB", new IDBFactory());
  localStorage.setItem("capacitylens/offlineRead", "on");
  try {
    await cacheAuthSnapshot(OFFLINE_IDENTITY);
    await run();
  } finally {
    await clearAllOfflineData();
    setOfflineReadState("cleanup", false);
    localStorage.clear();
    vi.unstubAllGlobals();
  }
}

describe("offline transport fallback", () => {
  it("uses a verified cached identity for an unscoped transport failure", async () => {
    await withOfflineCache(async () => {
      const fetchImpl = vi.fn().mockRejectedValue(new TypeError("network unavailable"));
      const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);

      await expect(adapter.loadAll()).resolves.toEqual(emptyAppData());
      expect(offlineStateSnapshot()).toMatchObject({ readOnly: true });
    });
  });

  it.each([
    ["reaches its deadline", () => Promise.reject(new DOMException("signal timed out", "TimeoutError"))],
    ["returns a server failure", () => Promise.resolve(new Response(null, { status: 503 }))],
  ])("does not use a cached account slice when the state request %s", async (_condition, request) => {
    await withOfflineCache(async () => {
      const cached = scopedData("a1", {});
      cached.clients[0]!.color = "#2d75da"; // a real preset, so cache sanitisation is identity-preserving
      await cacheAccountSlice("a1", cached);
      const fetchImpl = vi.fn(request);
      const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);

      await expect(adapter.loadAll("a1")).rejects.toThrow(/Failed to load state|signal timed out/);
      expect(offlineStateSnapshot()).toMatchObject({ readOnly: false });
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
      expect(offlineStateSnapshot()).toMatchObject({ readOnly: false });
    });
  });
});

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

  it("builds compensating final-state ops against both sides of an unacknowledged request", () => {
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
  });
});

describe("applyOps", () => {
  it("advances a snapshot by the given upserts and deletes", () => {
    const base = withData({ clients: [client("c1"), client("c2")] });
    const next = applyOps(base, [
      { method: "PUT", table: "clients", id: "c3", row: client("c3") },
      { method: "DELETE", table: "clients", id: "c1" },
    ]);
    expect(next.clients.map((c) => c.id).sort()).toEqual(["c2", "c3"]); // c1 removed, c3 added
    expect(base.clients.map((c) => c.id).sort()).toEqual(["c1", "c2"]); // base not mutated
  });
});

function okFetch() {
  return vi.fn(async (_url: string, init?: RequestInit) => commitReceipt(init));
}

describe("ServerSyncAdapter.loadAll", () => {
  it("treats an unscoped 400 as an empty pre-account bootstrap without parsing its body", async () => {
    const fetchImpl = vi.fn(async () => new Response("not json", { status: 400 })) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);

    setOfflineReadState("tenant", true);
    try {
      await expect(adapter.loadAll()).resolves.toEqual(emptyAppData());
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(offlineStateSnapshot()).toMatchObject({ readOnly: false });
    } finally {
      setOfflineReadState("cleanup", false);
    }
  });

  it("persists a synthesized Internal before acknowledging a repaired hydration snapshot", async () => {
    const raw = withData({ accounts: [account("a1")] });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
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

  it("loadAll(accountId) GETs /api/state?accountId= and seeds the snapshot to THAT slice (zero ops on an identical save)", async () => {
    // Per-account hydration (P1.13): the picker chose a1, so we load ONLY a1's slice.
    const a1Slice = scopedData("a1", { clients: [client("c1")] });
    const urls: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      urls.push(url);
      if (url.includes("/api/state")) return new Response(JSON.stringify(a1Slice), { status: 200 });
      return commitReceipt(init);
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const loaded = await a.loadAll("a1");
    expect(loaded.clients.map((row) => row.id).sort()).toEqual(["c1", "internal:a1"]);
    expect(urls[0]).toBe("http://x/api/state?accountId=a1"); // scoped read, not the whole tree
    // Snapshot == the loaded a1 slice, so re-saving it emits ZERO ops.
    const callsBefore = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length;
    await a.saveAll(a1Slice);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsBefore);
  });

  it("preserves current resource engagement and half days from a versionless server slice", async () => {
    const slice = scopedData("a1", {
      resources: [
        makeResource({
          id: "r1",
          name: "Barbara Gordon",
          role: "Engineer",
          employmentType: "contractor",
          engagement: "supplementary",
          halfDays: [2],
          color: "#2d75da", // a real preset, so migration is identity-preserving (no repair save)
          createdAt: TS1,
          updatedAt: TS1,
        }),
      ],
    });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/state")) return new Response(JSON.stringify(slice), { status: 200 });
      return commitReceipt(init);
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);

    const loaded = await adapter.loadAll("a1");
    expect(loaded.resources[0]).toMatchObject({ engagement: "supplementary", halfDays: [2] });

    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await adapter.saveAll(loaded);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("CROSS-ACCOUNT REGRESSION: re-seed to a2 then save a2 emits ONLY a2 ops — never deletes of a1", async () => {
    // The #1 correctness guard (§5): after a switch, lastSynced (the diff snapshot) MUST be the NEW
    // account's slice. If it stayed a1's, the first a2 save would diff a1→a2 and emit DELETEs for a1's
    // rows + PUTs for a2's — catastrophic cross-account data loss. The switch orchestrator (persist.ts)
    // achieves this by calling loadAll(a2), which re-seeds the snapshot to a2's slice.
    const a1c = client("c1"); // accountId 'a1'
    const a2c: Client = {
      id: "c2",
      accountId: "a2",
      name: "Beta",
      color: "#3b82f6",
      createdAt: TS1,
      updatedAt: TS1,
    };
    const a1Slice = scopedData("a1", { clients: [a1c] });
    const a2Slice = scopedData("a2", { clients: [a2c] });
    let nextSlice = a1Slice;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/state")) return new Response(JSON.stringify(nextSlice), { status: 200 });
      return commitReceipt(init);
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    await a.loadAll("a1"); // snapshot = a1's slice
    nextSlice = a2Slice;
    await a.loadAll("a2"); // RE-SEED: snapshot is now a2's slice (the orchestrator's atomic re-seed)
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Saving a2's slice now diffs a2→a2 = ZERO ops. Critically it does NOT emit a DELETE for c1 (a1).
    await a.saveAll(a2Slice);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(0); // no batch at all — snapshot already equals a2's slice

    // And an EDIT to a2 emits only the a2 op (a PUT c2), never a delete of c1.
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await a.saveAll(
      scopedData("a2", {
        clients: [{ ...a2c, name: "Beta II", updatedAt: TS2 }],
      }),
    );
    const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(ops.every((o) => o.id !== "c1")).toBe(true); // NEVER touches a1's row
    expect(ops).toEqual([expect.objectContaining({ method: "PUT", table: "clients", id: "c2" })]);
  });

  it("rejects a save whose rows do not match the scoped snapshot tenant", async () => {
    const a1Slice = scopedData("a1", { clients: [client("c1")] });
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/api/state")) return new Response(JSON.stringify(a1Slice), { status: 200 });
      return commitReceipt(init);
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);

    await adapter.loadAll("a1");
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    await expect(adapter.saveAll(scopedData("a2", {}))).rejects.toThrow(
      "pending changes do not belong to the active company",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("scoped loadAll TOLERATES a MISSING known table (rolling deploy) and hydrates it empty", async () => {
    // FIX 1: an older server may OMIT a table this newer client already knows. The scoped path must
    // NOT throw "incomplete state payload" during the skew window — it hydrates the missing table
    // empty, exactly like the unscoped migrate() path, while keeping cross-tenant strictness.
    const slice = omitKeys(scopedData("a1", { clients: [client("c1")] }), "disciplines"); // older server omits disciplines
    const a = new ServerSyncAdapter(
      "http://x",
      vi.fn(async () => new Response(JSON.stringify(slice), { status: 200 })) as unknown as typeof fetch,
    );
    const loaded = await a.loadAll("a1");
    expect(loaded.disciplines).toEqual([]); // missing table hydrated empty — no throw
    expect(loaded.clients.map((r) => r.id).sort()).toEqual(["c1", "internal:a1"]); // present rows intact
  });

  it("does not replace a complete offline snapshot with a rolling-version partial slice", async () => {
    await withOfflineCache(async () => {
      await cacheAccountSlice("a1", scopedData("a1", { clients: [client("cached")] }));
      const partial = omitKeys(scopedData("a1", { clients: [client("live")] }), "disciplines");
      const adapter = new ServerSyncAdapter(
        "http://x",
        vi.fn(async () => new Response(JSON.stringify(partial), { status: 200 })) as unknown as typeof fetch,
      );

      await adapter.loadAll("a1");

      expect((await readCachedAccountSlice("a1"))?.value.clients.map((row) => row.id)).toContain("cached");
      expect((await readCachedAccountSlice("a1"))?.value.clients.map((row) => row.id)).not.toContain("live");
    });
  });

  it("classifies a transport failure after batch dispatch as an uncertain commit", async () => {
    const timeout = new DOMException("signal timed out", "TimeoutError");
    const adapter = new ServerSyncAdapter("http://x", vi.fn().mockRejectedValue(timeout) as unknown as typeof fetch);

    await expect(adapter.saveAll(withData({ clients: [client("c1")] }))).rejects.toMatchObject({
      name: "BatchCommitUncertainError",
      cause: timeout,
    });
  });

  it.each([
    [
      "resources",
      {
        allocations: [
          {
            id: "al1",
            accountId: "a1",
            resourceId: "r1",
            activityId: "act1",
            startDate: "2026-01-01",
            endDate: "2026-01-01",
            hoursPerDay: 8,
            status: "confirmed" as const,
            createdAt: TS1,
            updatedAt: TS1,
          },
        ],
      },
    ],
    [
      "projects",
      {
        resources: [
          makeResource({
            id: "r1",
            kind: "placeholder",
            role: "Designer",
            projectId: "p1", // the reference that makes an omitted `projects` table unsafe
            color: "#3b82f6",
            createdAt: TS1,
            updatedAt: TS1,
          }),
        ],
      },
    ],
  ] as const)("rejects a missing %s table when returned rows reference it", async (missingKey, extra) => {
    const slice = omitKeys(scopedData("a1", extra as unknown as Partial<AppData>), missingKey);
    const adapter = new ServerSyncAdapter(
      "http://x",
      vi.fn(async () => new Response(JSON.stringify(slice), { status: 200 })) as unknown as typeof fetch,
    );

    await expect(adapter.loadAll("a1")).rejects.toThrow(`omitted referenced table(s) [${missingKey}]`);
  });

  it("scoped loadAll STILL rejects a PRESENT non-array known table", async () => {
    // FIX 1's missing-vs-wrong-type split: a table that is PRESENT and not an array is structural
    // damage and stays a HARD failure on the scoped path too (never coerced to []).
    const slice = {
      ...scopedData("a1", { clients: [client("c1")] }),
      resources: { bad: true },
    };
    const a = new ServerSyncAdapter(
      "http://x",
      vi.fn(async () => new Response(JSON.stringify(slice), { status: 200 })) as unknown as typeof fetch,
    );
    await expect(a.loadAll("a1")).rejects.toThrow("invalid state payload");
  });

  it("scoped loadAll rejects a CROSS-TENANT slice unchanged (missing-key tolerance does not weaken it)", async () => {
    // FIX 1 must NOT relax cross-tenant strictness: a slice whose account belongs to a2 while we asked
    // for a1 is still rejected as a cross-tenant/incomplete payload.
    const wrongTenant = scopedData("a2", { clients: [client("c1")] }); // asked for a1, got a2's slice
    const a = new ServerSyncAdapter(
      "http://x",
      vi.fn(async () => new Response(JSON.stringify(wrongTenant), { status: 200 })) as unknown as typeof fetch,
    );
    await expect(a.loadAll("a1")).rejects.toThrow("cross-tenant or incomplete state payload");
  });

  it("warns ONCE naming the missing table(s) when hydrating them empty (FIX 3)", async () => {
    // FIX 3: a hydrated-empty missing key is DIAGNOSABLE — one console.warn per load listing every
    // omitted table, so a same-version proxy/server bug that drops a table is visible, not silent.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = omitKeys(withData({ clients: [client("c1")] }), "disciplines", "resources");
      const a = new ServerSyncAdapter(
        "http://x",
        vi.fn(async () => new Response(JSON.stringify(state), { status: 200 })) as unknown as typeof fetch,
      );
      await a.loadAll();
      const warned = warn.mock.calls.filter((c) => String(c[0]).includes("omitted known table"));
      expect(warned).toHaveLength(1); // ONE warn per load, not one per missing key
      expect(String(warned[0][0])).toContain("disciplines");
      expect(String(warned[0][0])).toContain("resources");
    } finally {
      warn.mockRestore();
    }
  });

  it("does NOT warn when every known table is present", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const a = new ServerSyncAdapter(
        "http://x",
        vi.fn(
          async () => new Response(JSON.stringify(withData({ clients: [client("c1")] })), { status: 200 }),
        ) as unknown as typeof fetch,
      );
      await a.loadAll();
      expect(warn.mock.calls.some((c) => String(c[0]).includes("omitted known table"))).toBe(false);
    } finally {
      warn.mockRestore();
    }
  });
});

// Helper: pull the parsed ops array out of a recorded /api/batch POST.
const batchOps = (call: unknown[]): Array<{ method: string; table: string; id: string; accountId?: string }> =>
  JSON.parse((call[1] as RequestInit).body as string).ops;

describe("ServerSyncAdapter.saveAll", () => {
  it("announces an audit warning returned by the batch endpoint", async () => {
    const warning = vi.fn();
    globalThis.addEventListener(AUDIT_WARNING_EVENT, warning);
    try {
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        const receipt = (await commitReceipt(init).json()) as Record<string, unknown>;
        return new Response(JSON.stringify({ ...receipt, auditWarning: true }), { status: 200 });
      }) as unknown as typeof fetch;

      await new ServerSyncAdapter("http://x", fetchImpl).saveAll(withData({ clients: [client("c1")] }));
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.removeEventListener(AUDIT_WARNING_EVENT, warning);
    }
  });

  it("sends the diffed ops to /api/batch in one ordered request", async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x/", fetchImpl);
    await a.saveAll(withData({ clients: [client("c1")], projects: [project("p1", "c1")] }));
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("http://x/api/batch");
    expect((calls[0][1] as RequestInit).method).toBe("POST");
    expect(batchOps(calls[0]).map((o) => `${o.method} ${o.table}/${o.id}`)).toEqual([
      "PUT clients/c1", // upserts parent-first
      "PUT projects/p1",
    ]);
  });

  it("dispatches an isolated weekly repeat as allocation PUTs in one client batch", async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    const allocations = Array.from({ length: 14 }, (_, index) =>
      allocation(
        `repeat-${index}`,
        `2026-${String(1 + Math.floor(index / 4)).padStart(2, "0")}-${String(1 + (index % 4) * 7).padStart(2, "0")}` as Allocation["startDate"],
      ),
    );
    await adapter.saveAll(withData({ allocations }));

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const ops = batchOps(calls[0]);
    expect(ops).toHaveLength(14);
    expect(ops.every((op) => op.method === "PUT" && op.table === "allocations")).toBe(true);
    expect(ops.map((op) => op.id)).toEqual(allocations.map((row) => row.id));
  });

  it("dispatches a linked series-tail deletion as one transactional client batch", async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    const allocations = ["2026-06-01", "2026-06-08", "2026-06-15"].map((startDate, index) => ({
      ...allocation(`repeat-${index}`, startDate as Allocation["startDate"]),
      seriesId: "series-weekly",
    }));
    await adapter.saveAll(withData({ allocations }));
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    await adapter.saveAll(withData({ allocations: allocations.slice(0, 1) }));

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    const ops = batchOps(calls[0]);
    expect(ops).toHaveLength(2);
    expect(ops).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ method: "DELETE", table: "allocations", id: "repeat-1" }),
        expect.objectContaining({ method: "DELETE", table: "allocations", id: "repeat-2" }),
      ]),
    );
  });

  it("does NOT advance the snapshot on a failed batch, so the next save replays the delta", async () => {
    let failNext = false;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/batch") && failNext) return new Response("boom", { status: 500 });
      return commitReceipt(init);
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    failNext = true;
    await expect(a.saveAll(withData({ clients: [client("c1")] }))).rejects.toThrow();

    // Recover: the same state replays as one batch with c1 (not lost).
    failNext = false;
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await a.saveAll(withData({ clients: [client("c1")] }));
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(batchOps(calls[0])).toHaveLength(1);
  });

  it("flushes on unload as ONE keepalive batch request (survives the page teardown, no per-op FK race)", async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(withData({ clients: [client("c1")], projects: [project("p1", "c1")] }), { unload: true });
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("http://x/api/batch");
    const init = calls[0][1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(batchOps(calls[0])).toHaveLength(2); // all ops in one ordered request
  });

  it("dispatches the latest snapshot with keepalive when an ordinary batch is still in flight", async () => {
    let releaseFirst: (() => void) | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      if (!releaseFirst) {
        return new Promise<Response>((resolve) => {
          releaseFirst = () => resolve(commitReceipt(init));
        });
      }
      return Promise.resolve(commitReceipt(init));
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const ordinary = a.saveAll(withData({ clients: [client("c1")] }));
    expect(releaseFirst).toBeTypeOf("function");
    const teardown = a.saveAll(withData({ clients: [client("c1"), client("c2")] }), { unload: true });

    // The pagehide call must put the latest state on the wire immediately; it cannot wait for the
    // ordinary response because the document may be terminated first.
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    expect((calls[1][1] as RequestInit).keepalive).toBe(true);
    expect(batchOps(calls[1]).map((op) => op.id)).toEqual(["c1", "c2"]);
    const firstHeaders = new Headers((calls[0][1] as RequestInit).headers);
    const secondHeaders = new Headers((calls[1][1] as RequestInit).headers);
    expect(secondHeaders.get("X-CapacityLens-Sync-Session")).toBe(firstHeaders.get("X-CapacityLens-Sync-Session"));
    expect(firstHeaders.get("X-CapacityLens-Sync-Sequence")).toBe("1");
    expect(secondHeaders.get("X-CapacityLens-Sync-Sequence")).toBe("2");

    releaseFirst!();
    await Promise.all([ordinary, teardown]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no later non-keepalive drain of the parked state
  });

  it("sends an undo as a compensating keepalive op when the ordinary creation is unacknowledged", async () => {
    let releaseFirst: (() => void) | undefined;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      if (!releaseFirst) {
        return new Promise<Response>((resolve) => {
          releaseFirst = () => resolve(commitReceipt(init));
        });
      }
      return Promise.resolve(commitReceipt(init));
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    const created: Discipline = {
      id: "d1",
      accountId: "a1",
      name: "Temporary",
      color: "#3b82f6",
      sortOrder: 0,
      createdAt: TS1,
      updatedAt: TS1,
    };

    const ordinary = adapter.saveAll(withData({ disciplines: [created] }));
    const teardown = adapter.saveAll(emptyAppData(), { unload: true });
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;

    expect(calls).toHaveLength(2);
    expect(batchOps(calls[1])).toEqual([
      expect.objectContaining({
        method: "DELETE",
        table: "disciplines",
        id: "d1",
        accountId: "a1",
        updatedAt: TS1,
      }),
    ]);
    releaseFirst!();
    await Promise.all([ordinary, teardown]);
  });

  it("carries the owning account on a scoped (non-lifecycle) DELETE op; accounts (top-level) carry none", async () => {
    // Uses a scoped NON-lifecycle row (timeOff): lifecycle-entity deletes (clients/projects/resources)
    // are routed OUT of the batch to the dedicated archive/delete endpoints (see the lifecycle-delete
    // suite below), so the "scoped DELETE carries accountId on the wire" contract is asserted here on a
    // table that still rides the batch.
    const account = {
      id: "a1",
      name: "Co",
      color: "#3b82f6",
      createdAt: TS1,
      updatedAt: TS1,
    };
    const off: TimeOff = {
      id: "t1",
      accountId: "a1",
      resourceId: "r1",
      startDate: "2026-01-01",
      endDate: "2026-01-02",
      type: "holiday",
      createdAt: TS1,
      updatedAt: TS1,
    };
    const prev = withData({ accounts: [account], timeOff: [off] });
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(prev); // create a1 + t1; lastSynced = prev
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await a.saveAll(emptyAppData()); // diff prev→empty = deletes

    const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(ops.find((o) => o.table === "timeOff")).toMatchObject({
      method: "DELETE",
      id: "t1",
      accountId: "a1",
    });
    expect(ops.find((o) => o.table === "accounts")?.accountId).toBeUndefined();
  });

  it("maps a 409 batch response to BatchConflictError carrying body.error (+ current)", async () => {
    // 409 is the server's optimistic-concurrency conflict signal ({ error, current }). It must
    // surface as the TYPED BatchConflictError — persist.ts branches on it to resolve by reloading
    // (server wins) instead of futilely retrying the same stale diff.
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith("/api/batch")) {
        return new Response(
          JSON.stringify({
            error: "Someone else saved a newer version of this record.",
            current: { id: "c1" },
          }),
          { status: 409 },
        );
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const err: unknown = await a.saveAll(withData({ clients: [client("c1")] })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BatchConflictError);
    expect((err as BatchConflictError).message).toBe("Someone else saved a newer version of this record.");
    expect((err as BatchConflictError).current).toEqual({ id: "c1" });
  });

  it("a 409 with an unreadable body still throws BatchConflictError (best-effort parse)", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("<html>proxy error</html>", { status: 409 }),
    ) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const err: unknown = await a.saveAll(withData({ clients: [client("c1")] })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BatchConflictError);
  });

  it("maps a deterministic 400 batch rejection to BatchValidationError", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: "Allocation must reference an active resource in this company.",
            code: "allocation_resource_inactive",
          }),
          { status: 400 },
        ),
    ) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const err: unknown = await a.saveAll(withData({ clients: [client("c1")] })).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BatchValidationError);
    expect((err as BatchValidationError).message).toBe("Allocation must reference an active resource in this company.");
    expect((err as BatchValidationError).code).toBe("allocation_resource_inactive");
  });

  it("rejects an HTTP 2xx that does not prove the complete batch committed", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ ok: true, applied: 0 }), { status: 200 }),
    ) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    await expect(a.saveAll(withData({ clients: [client("c1")] }))).rejects.toThrow(
      "Batch sync returned an invalid commit receipt.",
    );
  });

  it.each([
    ["omitted", () => ({})],
    ["empty", () => ({ revisions: [] })],
    ["partial", (ops: ReceiptOp[]) => ({ revisions: [revisionFor(ops[0])] })],
    [
      "duplicate",
      (ops: ReceiptOp[]) => ({
        revisions: [revisionFor(ops[0]), revisionFor(ops[0])],
      }),
    ],
  ])(
    "requires an authoritative reload for committed receipts with %s revision coverage",
    async (_case, revisionFields) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        const ops = (JSON.parse(init?.body as string) as { ops: ReceiptOp[] }).ops;
        return new Response(
          JSON.stringify({
            ok: true,
            applied: ops.length,
            ...revisionFields(ops),
          }),
          { status: 200 },
        );
      }) as unknown as typeof fetch;
      const a = new ServerSyncAdapter("http://x", fetchImpl);

      await expect(a.saveAll(withData({ clients: [client("c1"), client("c2")] }))).rejects.toThrow(
        BatchCommitUncertainError,
      );
    },
  );

  it("requires reconciliation for a legacy successful receipt that omits applied and revisions", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => Response.json({ ok: true })) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    await expect(a.saveAll(withData({ clients: [client("c1")] }))).rejects.toThrow(BatchCommitUncertainError);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("omitted 'applied'"));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("omitted server revisions"));
  });

  it("drops an extra revision when every written row still has authoritative coverage", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const ops = (JSON.parse(init?.body as string) as { ops: ReceiptOp[] }).ops;
      return Response.json({
        ok: true,
        applied: ops.length,
        revisions: [...ops.map(revisionFor), { ...revisionFor(ops[0]), id: "unexpected" }],
      });
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    await expect(a.saveAll(withData({ clients: [client("c1"), client("c2")] }))).resolves.toBeUndefined();
  });

  it("coalesces overlapping saves to the latest state", async () => {
    let resolveFirst: (() => void) | null = null;
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          // Hold the very first request open so a second saveAll lands mid-flush.
          if (!resolveFirst) resolveFirst = () => resolve(commitReceipt(init));
          else resolve(commitReceipt(init));
        }),
    ) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const p1 = a.saveAll(withData({ clients: [client("c1")] }));
    const p2 = a.saveAll(withData({ clients: [client("c1"), client("c2")] }));
    resolveFirst!();
    await Promise.all([p1, p2]);
    const batches = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      batchOps(c).map((o) => o.id),
    );
    // first batch: [c1]; coalesced second batch: [c2] only (c1 already synced).
    expect(batches).toEqual([["c1"], ["c2"]]);
  });

  it("rebases a queued edit onto the server revision returned by the in-flight batch", async () => {
    let resolveFirst: ((response: Response) => void) | null = null;
    let batchNumber = 0;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      batchNumber += 1;
      const current = batchNumber;
      const ops = JSON.parse(init?.body as string).ops as Array<{
        table: "clients";
        id: string;
        row: Client;
      }>;
      const response = () =>
        new Response(
          JSON.stringify({
            ok: true,
            applied: ops.length,
            revisions: ops.map((op) => ({
              table: op.table,
              id: op.id,
              createdAt: "2030-01-01T00:00:00.000Z",
              updatedAt: `2030-01-0${current}T00:00:00.000Z`,
            })),
          }),
          { status: 200 },
        );
      if (current === 1)
        return new Promise<Response>((resolve) => {
          resolveFirst = resolve;
        });
      return Promise.resolve(response());
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    const first = withData({ clients: [client("c1", TS1)] });
    const second = withData({
      clients: [{ ...client("c1", TS2), name: "Queued edit" }],
    });

    const p1 = adapter.saveAll(first);
    const p2 = adapter.saveAll(second);
    resolveFirst!(
      new Response(
        JSON.stringify({
          ok: true,
          applied: 1,
          revisions: [
            {
              table: "clients",
              id: "c1",
              createdAt: "2030-01-01T00:00:00.000Z",
              updatedAt: "2030-01-01T00:00:00.000Z",
            },
          ],
        }),
        { status: 200 },
      ),
    );
    await Promise.all([p1, p2]);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const queuedWire = batchOps(calls[1]) as unknown as Array<{ row: Client }>;
    expect(queuedWire[0].row.name).toBe("Queued edit");
    expect(queuedWire[0].row.updatedAt).toBe("2030-01-01T00:00:00.000Z");
    // Saving the unchanged local object again canonicalizes its acknowledged client revision and
    // does not emit a third, timestamp-only batch.
    await adapter.saveAll(second);
    expect(calls).toHaveLength(2);
  });
});

describe("ServerSyncAdapter — durable acknowledged-revision translation (phantom-PUT guard)", () => {
  // The store never writes the server's revision back into a row, so a previously-acked row keeps its
  // client-side updatedAt forever while lastSynced holds the SERVER stamp. The translation the ack map
  // performs is therefore needed on EVERY future diff, not just the first: a consume-once map deletes
  // the entry after one use, so the very next diff sees store(clientStamp) ≠ lastSynced(serverStamp)
  // and re-emits a phantom PUT — which re-stamps the row server-side and 409-discards another user's
  // real edit. These specs pin the DURABLE translation.

  // A commit receipt whose server revision is DISTINCT from the client stamp (the server owns
  // timestamps), so a row left untranslated reads as changed against lastSynced.
  const ackReceipt = (init?: RequestInit): Response => {
    const ops = (
      JSON.parse(init!.body as string) as {
        ops: Array<{
          table: string;
          id: string;
          row?: { createdAt: string; updatedAt: string };
        }>;
      }
    ).ops;
    return new Response(
      JSON.stringify({
        ok: true,
        applied: ops.length,
        revisions: ops
          .filter((o) => o.row)
          .map((o) => ({
            table: o.table,
            id: o.id,
            createdAt: o.row!.createdAt,
            updatedAt: `${o.row!.updatedAt}::server`,
          })),
      }),
      { status: 200 },
    );
  };

  it("emits ZERO further ops for a previously-acked row across many unrelated saves", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ackReceipt(init)) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    // Edit c1 → save → ack. The store keeps c1@TS1 (the server stamp is never written back into it).
    await a.saveAll(withData({ clients: [client("c1", TS1)] }));
    // Several UNRELATED saves, each adding a new client while c1 stays at its client stamp TS1.
    await a.saveAll(withData({ clients: [client("c1", TS1), client("c2", TS1)] }));
    await a.saveAll(
      withData({
        clients: [client("c1", TS1), client("c2", TS1), client("c3", TS1)],
      }),
    );
    await a.saveAll(
      withData({
        clients: [client("c1", TS1), client("c2", TS1), client("c3", TS1), client("c4", TS1)],
      }),
    );
    const batches = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      batchOps(c).map((o) => o.id),
    );
    // c1 is PUT exactly once (its first save) and never re-appears — no phantom re-PUT on alternate saves.
    expect(batches).toEqual([["c1"], ["c2"], ["c3"], ["c4"]]);
  });

  it("emits no phantom PUT for a previously-acked row during an unload flush", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ackReceipt(init)) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const localState = withData({ clients: [client("c1", TS1)] });

    await a.saveAll(localState);
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    await a.saveAll(localState, { unload: true });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("emits exactly one PUT when a previously-acked row is genuinely edited again, then is durable anew", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ackReceipt(init)) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(withData({ clients: [client("c1", TS1)] })); // ack c1@TS1
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    // Genuine re-edit: c1 carries a NEW client stamp → exactly one PUT; the translation entry is replaced.
    await a.saveAll(withData({ clients: [{ ...client("c1", TS2), name: "Renamed" }] }));
    let calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(batchOps(calls[0]).map((o) => o.id)).toEqual(["c1"]);
    // The re-edit re-acked c1@TS2; a following unrelated save must NOT re-PUT c1 (durable again).
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await a.saveAll(
      withData({
        clients: [{ ...client("c1", TS2), name: "Renamed" }, client("c9", TS1)],
      }),
    );
    calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(batchOps(calls[0]).map((o) => o.id)).toEqual(["c9"]);
  });

  it("clears the translation map on rehydrate, so a stale ack cannot mistranslate a reused stamp", async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/state")) return new Response(JSON.stringify(emptyAppData()), { status: 200 });
      return ackReceipt(init);
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(withData({ clients: [client("c1", TS1)] })); // ack: client TS1 → server 'TS1::server'
    await a.loadAll(); // rehydrate → seeds lastSynced (empty) AND clears the ack map
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    // A fresh create reusing stamp TS1. A leaked stale ack would translate it to the server stamp;
    // a cleared map PUTs it with its real client stamp TS1.
    await a.saveAll(withData({ clients: [client("c1", TS1)] }));
    const wire = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]) as unknown as Array<{
      id: string;
      row: Client;
    }>;
    expect(wire.map((o) => o.id)).toEqual(["c1"]);
    expect(wire[0].row.updatedAt).toBe(TS1); // NOT 'TS1::server' — the stale translation was cleared
  });

  it("prunes a translation after committed deletion so an id can reuse its client stamp safely", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ackReceipt(init)) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const row: Discipline = {
      id: "d1",
      accountId: "a1",
      name: "Design",
      sortOrder: 0,
      createdAt: TS1,
      updatedAt: TS1,
    };
    await a.saveAll(withData({ disciplines: [row] }));
    await a.saveAll(emptyAppData());
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    await a.saveAll(withData({ disciplines: [row] }));

    const wire = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]) as unknown as Array<{
      row: Discipline;
    }>;
    expect(wire[0].row.updatedAt).toBe(TS1);
  });
});

describe("lifecycle-entity deletes route out of the batch as ARCHIVE-ONLY convergence (DEFECT A)", () => {
  // The server 400-REJECTS a batch DELETE of a lifecycle entity (clients/projects/resources), steering
  // writers at the dedicated lifecycle routes. The old client emitted those deletes IN the batch, so a
  // single undo of a synced create (add client → sync → Cmd-Z) poisoned every later batch until a
  // reload discarded the edits. The adapter now splits lifecycle deletes out and converges each by
  // ARCHIVING ONLY (POST /api/{table}/{id}/archive — action 'write', editor-allowed, never
  // freshness-gated) AFTER the batch. It deliberately does NOT call /delete: soft-delete is
  // irreversible, admin-gated and step-up-gated, so it is never emitted by background sync. The
  // sync-originated disappearance parks the row as ARCHIVED (reversible); it lingers in the archived
  // list (accepted residual). These specs pin that routing and its failure/recovery behaviour.
  const discipline = (updatedAt = TS1): Discipline => ({
    id: "d1",
    accountId: "a1",
    name: "Design",
    sortOrder: 0,
    createdAt: TS1,
    updatedAt,
  });
  // Record every request as { url, body } so a spec can assert both the endpoints hit and their order.
  const recordingFetch = (onCall?: (url: string) => Response | null) => {
    const calls: Array<{ url: string; body?: string; keepalive?: boolean }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({
        url,
        body: init?.body as string | undefined,
        keepalive: init?.keepalive,
      });
      return onCall?.(url) ?? commitReceipt(init);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };
  const opsOf = (call: { body?: string }) =>
    JSON.parse(call.body as string).ops as Array<{
      method: string;
      table: string;
      id: string;
    }>;

  it("(a) undo of a synced create converges via ARCHIVE (no /delete) and does NOT poison later saves", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    // 1) create + sync a client (its PUT rides the batch — a lifecycle PUT is allowed).
    await a.saveAll(scopedData("a1", { clients: [client("c1")] }));
    // 2) undo: c1 is removed. Its delete must NOT ride the batch (that would 400 the whole request);
    //    it converges by archiving through the dedicated archive route instead.
    calls.length = 0;
    await a.saveAll(scopedData("a1", {}));
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("http://x/api/clients/c1/archive");
    // the sync layer NEVER hits /delete — soft-delete is not emitted by background sync.
    expect(urls.some((u) => u.endsWith("/clients/c1/delete"))).toBe(false);
    // the archive carries the owning account in its body.
    expect(JSON.parse(calls.find((c) => c.url.endsWith("/clients/c1/archive"))!.body!)).toEqual({ accountId: "a1" });
    // no batch carried a lifecycle DELETE.
    for (const bc of calls.filter((c) => c.url.endsWith("/api/batch"))) {
      expect(opsOf(bc).some((o) => o.method === "DELETE" && o.table === "clients")).toBe(false);
    }

    // 3) a later unrelated edit still syncs — the poison is gone.
    calls.length = 0;
    await a.saveAll(scopedData("a1", { clients: [client("c2")] }));
    const put = calls.find((c) => c.url.endsWith("/api/batch"))!;
    expect(opsOf(put)).toEqual([expect.objectContaining({ method: "PUT", table: "clients", id: "c2" })]);
  });

  it("announces an audit warning returned by the dedicated archive route", async () => {
    // The archive route goes through `this.request` (raw fetchImpl), NOT apiFetch, so it must check
    // the audit-degradation header itself rather than relying on apiFetch's own check.
    const warning = vi.fn();
    globalThis.addEventListener(AUDIT_WARNING_EVENT, warning);
    try {
      const { fetchImpl } = recordingFetch((url) =>
        url.endsWith("/clients/c1/archive")
          ? new Response("{}", { status: 200, headers: { "x-capacitylens-audit-warning": "true" } })
          : null,
      );
      const a = new ServerSyncAdapter("http://x", fetchImpl);
      await a.saveAll(scopedData("a1", { clients: [client("c1")] }));
      await a.saveAll(scopedData("a1", {}));
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.removeEventListener(AUDIT_WARNING_EVENT, warning);
    }
  });

  it("redo reverses the remembered archive before treating the lifecycle row as active again", async () => {
    const restored = { ...client("c1"), updatedAt: TS2 };
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith("/clients/c1/unarchive") ? new Response(JSON.stringify(restored), { status: 200 }) : null,
    );
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const created = scopedData("a1", { clients: [client("c1")] });

    await a.saveAll(created);
    await a.saveAll(scopedData("a1", {}));
    calls.length = 0;
    await a.saveAll(created);

    expect(calls.map((call) => call.url)).toEqual(["http://x/api/clients/c1/unarchive"]);
  });

  it("announces an audit warning returned by the dedicated unarchive route", async () => {
    // Same gap as the archive route above: unarchiveLifecycleRow also bypasses apiFetch.
    const warning = vi.fn();
    globalThis.addEventListener(AUDIT_WARNING_EVENT, warning);
    try {
      const restored = { ...client("c1"), updatedAt: TS2 };
      const { fetchImpl } = recordingFetch((url) =>
        url.endsWith("/clients/c1/unarchive")
          ? new Response(JSON.stringify(restored), {
              status: 200,
              headers: { "x-capacitylens-audit-warning": "true" },
            })
          : null,
      );
      const a = new ServerSyncAdapter("http://x", fetchImpl);
      await a.saveAll(scopedData("a1", { clients: [client("c1")] }));
      await a.saveAll(scopedData("a1", {}));
      warning.mockClear();
      await a.saveAll(scopedData("a1", { clients: [client("c1")] }));
      expect(warning).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.removeEventListener(AUDIT_WARNING_EVENT, warning);
    }
  });

  it("unarchives before applying edits that accompany a lifecycle-row reappearance", async () => {
    const restored = { ...client("c1"), updatedAt: TS2 };
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith("/clients/c1/unarchive") ? new Response(JSON.stringify(restored), { status: 200 }) : null,
    );
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    await a.saveAll(scopedData("a1", { clients: [client("c1")] }));
    await a.saveAll(scopedData("a1", {}));
    calls.length = 0;
    await a.saveAll(
      scopedData("a1", {
        clients: [
          {
            ...client("c1", "2026-01-03T00:00:00.000Z"),
            name: "Redone and renamed",
          },
        ],
      }),
    );

    expect(calls.map((call) => call.url)).toEqual(["http://x/api/clients/c1/unarchive", "http://x/api/batch"]);
    expect(opsOf(calls[1])).toEqual([
      expect.objectContaining({
        method: "PUT",
        table: "clients",
        id: "c1",
        row: expect.objectContaining({
          name: "Redone and renamed",
          updatedAt: TS2,
        }),
      }),
    ]);
  });

  it("reloads instead of resurrecting a soft-deleted row when unarchive is refused", async () => {
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith("/clients/c1/unarchive")
        ? new Response(
            JSON.stringify({
              error: "Cannot unarchive: entity is not archived.",
            }),
            { status: 409 },
          )
        : null,
    );
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const created = scopedData("a1", { clients: [client("c1")] });

    await a.saveAll(created);
    await a.saveAll(scopedData("a1", {}));
    calls.length = 0;
    await expect(a.saveAll(created)).rejects.toBeInstanceOf(LifecycleRestoreError);

    expect(calls.map((call) => call.url)).toEqual(["http://x/api/clients/c1/unarchive"]);
  });

  it("refuses a teardown generic PUT while an ordered lifecycle restore is pending", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const created = scopedData("a1", { clients: [client("c1")] });

    await a.saveAll(created);
    await a.saveAll(scopedData("a1", {}));
    calls.length = 0;
    await expect(a.saveAll(created, { unload: true })).rejects.toBeInstanceOf(KeepaliveNotDispatchedError);

    expect(calls).toEqual([]);
  });

  it("(b) a batch of ordinary edits plus a lifecycle delete applies the edits (batch first, archive routed out)", async () => {
    const { calls, fetchImpl } = recordingFetch();
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(
      scopedData("a1", {
        clients: [client("c1")],
        disciplines: [discipline()],
      }),
    );

    // Remove the lifecycle client AND edit the discipline in the SAME diff.
    calls.length = 0;
    await a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }));

    // the discipline edit LANDED via the batch, which never carries the lifecycle delete...
    const batch = calls.find((c) => c.url.endsWith("/api/batch"))!;
    expect(opsOf(batch)).toEqual([
      expect.objectContaining({
        method: "PUT",
        table: "disciplines",
        id: "d1",
      }),
    ]);
    expect(opsOf(batch).some((o) => o.table === "clients")).toBe(false);
    // ...and the client delete converged by ARCHIVING (no /delete), AFTER the batch (so any
    // reparent/upsert the diff carried lands first).
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("http://x/api/clients/c1/archive");
    expect(urls.some((u) => u.endsWith("/clients/c1/delete"))).toBe(false);
    expect(urls.indexOf("http://x/api/batch")).toBeLessThan(urls.indexOf("http://x/api/clients/c1/archive"));
  });

  it("(c) a lifecycle-ARCHIVE failure surfaces but the batch commits and a later save recovers", async () => {
    let failArchive = true;
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith("/clients/c1/archive") && failArchive ? new Response("nope", { status: 500 }) : null,
    );
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(
      scopedData("a1", {
        clients: [client("c1")],
        disciplines: [discipline()],
      }),
    );

    // Undo the client (lifecycle delete) AND edit the discipline; the archive endpoint is down.
    calls.length = 0;
    await expect(a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }))).rejects.toThrow(/Lifecycle archive/);
    // The unrelated discipline edit STILL committed — the batch is independent of the stuck archive.
    expect(opsOf(calls.find((c) => c.url.endsWith("/api/batch"))!)).toEqual([
      expect.objectContaining({
        method: "PUT",
        table: "disciplines",
        id: "d1",
      }),
    ]);

    // A re-save of the SAME target must NOT replay the committed discipline edit (snapshot advanced for
    // the batch), but MUST re-attempt the un-converged client archive (restored to the snapshot).
    failArchive = false; // the archive endpoint recovers
    calls.length = 0;
    await a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }));
    expect(calls.some((c) => c.url.endsWith("/api/batch"))).toBe(false); // discipline edit not replayed
    expect(calls.map((c) => c.url)).toContain("http://x/api/clients/c1/archive");

    // Fully converged now: a further identical save is a clean no-op (no batch, no archive).
    calls.length = 0;
    await a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }));
    expect(calls).toHaveLength(0);
  });

  it("(d) a lifecycle-ARCHIVE 409 (already archived) is treated as converged, not a poison", async () => {
    // 409 from the archive route = the row is already out of active (a concurrent archive or a
    // converged retry). Surfacing it would re-poison every future diff with a delete that can never
    // "succeed"; instead it advances the snapshot as removed. (404 is handled the same way.)
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith("/clients/c1/archive")
        ? new Response(
            JSON.stringify({
              code: "already_inactive",
              error: "Already archived",
            }),
            { status: 409 },
          )
        : null,
    );
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(scopedData("a1", { clients: [client("c1")] }));
    calls.length = 0;
    await expect(a.saveAll(scopedData("a1", {}))).resolves.toBeUndefined(); // 409 → converged, no throw
    // and the row is gone from the snapshot: a further identical save emits nothing.
    calls.length = 0;
    await a.saveAll(scopedData("a1", {}));
    expect(calls).toHaveLength(0);
  });

  it("(d1) a protected lifecycle-ARCHIVE 409 remains a surfaced, retryable failure", async () => {
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith("/clients/c1/archive")
        ? new Response(
            JSON.stringify({
              code: "protected_entity",
              error: "The built-in Internal client cannot be archived.",
            }),
            { status: 409 },
          )
        : null,
    );
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(scopedData("a1", { clients: [client("c1")] }));

    calls.length = 0;
    await expect(a.saveAll(scopedData("a1", {}))).rejects.toThrow(/built-in Internal client/i);

    calls.length = 0;
    await expect(a.saveAll(scopedData("a1", {}))).rejects.toThrow(/built-in Internal client/i);
    expect(calls.filter((call) => call.url.endsWith("/clients/c1/archive"))).toHaveLength(1);
  });

  it("(d2) a lifecycle-ARCHIVE 404 (already gone) is also treated as converged", async () => {
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith("/clients/c1/archive")
        ? new Response(JSON.stringify({ error: "Not found" }), { status: 404 })
        : null,
    );
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(scopedData("a1", { clients: [client("c1")] }));
    calls.length = 0;
    await expect(a.saveAll(scopedData("a1", {}))).resolves.toBeUndefined(); // 404 → converged, no throw
    calls.length = 0;
    await a.saveAll(scopedData("a1", {}));
    expect(calls).toHaveLength(0);
  });

  it("does not treat a proxy or missing-route 404 as a converged lifecycle archive", async () => {
    const { fetchImpl } = recordingFetch((url) =>
      url.endsWith("/clients/c1/archive")
        ? new Response(JSON.stringify({ error: "Not Found", message: "Route not found" }), { status: 404 })
        : null,
    );
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(scopedData("a1", { clients: [client("c1")] }));

    await expect(a.saveAll(scopedData("a1", {}))).rejects.toThrow("Lifecycle archive of clients/c1 failed (404)");
  });

  it("awaits a pending lifecycle-delete keepalive receipt without poisoning the batch", async () => {
    // The final teardown state is one ordered transaction: an ARCHIVE operation cannot be overtaken
    // by an older creation, and ordinary sibling edits commit atomically with it.
    const { calls, fetchImpl } = recordingFetch();
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(
      scopedData("a1", {
        clients: [client("c1")],
        disciplines: [discipline()],
      }),
    );

    // Teardown flush with the client removed + the discipline edited.
    calls.length = 0;
    await a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }), {
      unload: true,
    });

    // The batch carries both the ordinary edit and its lifecycle archive on one keepalive request.
    const batchCalls = calls.filter((c) => c.url.endsWith("/api/batch"));
    expect(batchCalls).toHaveLength(1);
    expect(batchCalls[0].keepalive).toBe(true);
    expect(opsOf(batchCalls[0])).toEqual([
      expect.objectContaining({
        method: "PUT",
        table: "disciplines",
        id: "d1",
      }),
      expect.objectContaining({
        method: "ARCHIVE",
        table: "clients",
        id: "c1",
        accountId: "a1",
      }),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls.some((c) => c.url.endsWith("/clients/c1/archive"))).toBe(false);
    expect(calls.some((c) => c.url.endsWith("/clients/c1/delete"))).toBe(false); // never soft-deletes on unload
  });

  it("rejects an unload flush when its lifecycle archive does not positively commit", async () => {
    let rejectArchive: ((reason: Error) => void) | undefined;
    const calls: Array<{ url: string; body?: string; keepalive?: boolean }> = [];
    const controlledFetch = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      calls.push({
        url,
        body: init?.body as string | undefined,
        keepalive: init?.keepalive,
      });
      if (url.endsWith("/api/batch") && init?.keepalive) {
        return new Promise((_resolve, reject) => {
          rejectArchive = reject;
        });
      }
      return Promise.resolve(commitReceipt(init));
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", controlledFetch);
    await a.saveAll(scopedData("a1", { clients: [client("c1")] }));
    calls.length = 0;

    let settled = false;
    const teardown = a.saveAll(scopedData("a1", {}), { unload: true }).finally(() => {
      settled = true;
    });
    await Promise.resolve();

    expect(calls).toEqual([
      expect.objectContaining({
        url: "http://x/api/batch",
        keepalive: true,
      }),
    ]);
    expect(settled).toBe(false);
    rejectArchive!(new Error("keepalive dropped"));
    await expect(teardown).rejects.toThrow("keepalive dropped");
    expect(settled).toBe(true);
  });

  it("unarchives a lifecycle row restored after a confirmed teardown archive even when the diff is otherwise empty", async () => {
    const restored = { ...client("c1"), updatedAt: TS2 };
    const { calls, fetchImpl } = recordingFetch((url) =>
      url.endsWith("/clients/c1/unarchive") ? new Response(JSON.stringify(restored), { status: 200 }) : null,
    );
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    const created = scopedData("a1", { clients: [client("c1")] });

    await adapter.saveAll(created);
    calls.length = 0;
    await adapter.saveAll(scopedData("a1", {}), { unload: true });
    expect(opsOf(calls[0])).toEqual([expect.objectContaining({ method: "ARCHIVE", table: "clients", id: "c1" })]);

    calls.length = 0;
    await adapter.saveAll(created);
    expect(calls.map((call) => call.url)).toEqual(["http://x/api/clients/c1/unarchive"]);
  });
});

describe("atomic large diffs and unload behaviour", () => {
  const manyClients = (n: number) => Array.from({ length: n }, (_, i) => client(`c${i}`));

  it("sends 4500 ordinary UI ops as one ordered transaction", async () => {
    const batches: string[][] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/batch")) {
        batches.push((JSON.parse(init?.body as string) as { ops: Array<{ id: string }> }).ops.map((o) => o.id));
      }
      return commitReceipt(init);
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const clients = manyClients(4500);
    await a.saveAll(withData({ clients }));

    expect(batches).toHaveLength(1);
    expect(batches[0]).toEqual(clients.map((c) => c.id));
  });

  it("refuses an over-limit diff before sending anything", async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const data = withData({ clients: manyClients(MAX_OPS_PER_BATCH + 1) });

    await expect(a.saveAll(data)).rejects.toThrow(
      `Atomic sync exceeds the ${MAX_OPS_PER_BATCH}-operation server limit.`,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not dispatch a keepalive body over the browser byte budget", async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    await expect(a.saveAll(withData({ clients: manyClients(1000) }), { unload: true })).rejects.toBeInstanceOf(
      KeepaliveNotDispatchedError,
    );

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("budgets a lifecycle archive with its sibling keepalive batch before dispatching either", async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    const teardownDiscipline = (updatedAt = TS1): Discipline => ({
      id: "d1",
      accountId: "a1",
      name: "Design",
      sortOrder: 0,
      color: "#3b82f6",
      createdAt: TS1,
      updatedAt,
    });
    await adapter.saveAll(
      scopedData("a1", {
        clients: [client("to-archive")],
        disciplines: [teardownDiscipline()],
      }),
    );
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    const nearQuotaName = "x".repeat(59 * 1024);
    await expect(
      adapter.saveAll(
        scopedData("a1", {
          disciplines: [{ ...teardownDiscipline(TS2), name: nearQuotaName }],
        }),
        { unload: true },
      ),
    ).rejects.toBeInstanceOf(KeepaliveNotDispatchedError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    {
      boundary: "browser byte budget",
      target: () => scopedData("a1", { clients: manyClients(1000) }),
      errorType: KeepaliveNotDispatchedError,
    },
    {
      boundary: "server operation limit",
      target: () => scopedData("a1", { clients: manyClients(MAX_OPS_PER_BATCH + 1) }),
      errorType: BatchTooLargeError,
    },
  ])(
    "does not archive a lifecycle delete when the $boundary prevents batch dispatch",
    async ({ target, errorType }) => {
      const fetchImpl = okFetch() as unknown as typeof fetch;
      const a = new ServerSyncAdapter("http://x", fetchImpl);
      await a.saveAll(scopedData("a1", { clients: [client("to-archive")] }));
      (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

      await expect(a.saveAll(target(), { unload: true })).rejects.toBeInstanceOf(errorType);

      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("a small unload flush is one keepalive transaction and includes every (batch-eligible) DELETE", async () => {
    // Lifecycle deletes (clients/projects/resources) deliberately do NOT flush on unload (two-round-trip
    // archive→delete can't complete on a dying page — see the DEFECT A suite). This pins the keepalive
    // path for ORDINARY, batch-eligible deletes, using a scoped non-lifecycle table (disciplines).
    const disc = (id: string): Discipline => ({
      id,
      accountId: "a1",
      name: id,
      sortOrder: 0,
      createdAt: TS1,
      updatedAt: TS1,
    });
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(withData({ disciplines: [disc("d1"), disc("d2")] }));
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await a.saveAll(emptyAppData(), { unload: true });
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as RequestInit).keepalive).toBe(true);
    expect(batchOps(calls[0]).map((o) => o.method)).toEqual(["DELETE", "DELETE"]);
  });
});

describe("snapshot generation guard (superseded loads / in-flight batches)", () => {
  it("a SUPERSEDED loadAll resolving late does NOT re-seed the snapshot over the newer load", async () => {
    // The cross-account race: switch a1→a2 while a1's slow load is still in flight. persist.ts
    // discards a1's late slice from the STORE (token guard) — the adapter must equally refuse to
    // seed lastSynced from it, or snapshot=a1 under data=a2 and the next save diffs across
    // tenants (DELETEs for a2's rows + PUTs of a1's).
    const a1c = client("c1"); // accountId 'a1'
    const a2c: Client = {
      id: "c2",
      accountId: "a2",
      name: "Beta",
      color: "#3b82f6",
      createdAt: TS1,
      updatedAt: TS1,
    };
    const a1Slice = scopedData("a1", { clients: [a1c] });
    const a2Slice = scopedData("a2", { clients: [a2c] });
    let releaseA1: (() => void) | null = null;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).includes("accountId=a1")) {
        return new Promise<Response>((resolve) => {
          releaseA1 = () => resolve(new Response(JSON.stringify(a1Slice), { status: 200 }));
        });
      }
      if (String(url).includes("accountId=a2"))
        return Promise.resolve(new Response(JSON.stringify(a2Slice), { status: 200 }));
      return Promise.resolve(commitReceipt(init));
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const slowA1 = a.loadAll("a1"); // in flight, held open
    await a.loadAll("a2"); // newer load wins: snapshot = a2
    releaseA1!();
    await slowA1; // late resolve — must NOT seed a1 over a2
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    // An a2 edit must diff against the a2 snapshot: one PUT, and NEVER a delete of a2's rows
    // (which a stale a1 snapshot would produce).
    await a.saveAll(
      scopedData("a2", {
        clients: [{ ...a2c, name: "Beta II", updatedAt: TS2 }],
      }),
    );
    const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(ops).toEqual([expect.objectContaining({ method: "PUT", table: "clients", id: "c2" })]);
  });

  it("an in-flight batch resolving AFTER a reload does not clobber the fresh snapshot seed", async () => {
    // drain() computes its diff, awaits the POST, then advances lastSynced — if a loadAll
    // completed in that window, advancing would overwrite the fresh seed with the pre-reload
    // target (snapshot ≠ store). The generation check makes the reload's seed win; the skipped
    // advance is safe because the server already holds the batch's idempotent ops.
    const slice = scopedData("a1", { clients: [client("c1")] });
    let releaseBatch: (() => void) | null = null;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/batch")) {
        return new Promise<Response>((resolve) => {
          releaseBatch = () => resolve(commitReceipt(init));
        });
      }
      return Promise.resolve(new Response(JSON.stringify(slice), { status: 200 }));
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const saving = a.saveAll(withData({ clients: [client("cX")] })); // batch held open
    await a.loadAll("a1"); // reload completes mid-batch: snapshot = slice (c1)
    releaseBatch!();
    await saving;
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    // Re-saving the loaded slice must be a no-op — the reload's seed survived the batch settle.
    // (Without the guard, snapshot would be the cX target and this would emit c1/cX ops.)
    await a.saveAll(slice);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("a save that STARTS while a loadAll is already in flight cannot clobber that load's seed (same-generation race)", async () => {
    // The subtle variant a start-generation check misses: loadAll bumps its counter at fetch
    // START, so a save beginning mid-load captures the same generation the load will seed under.
    // The guard must key on seeds (seedGen), not load starts — otherwise the batch's settle
    // re-advances lastSynced to its pre-reload target, snapshot desyncs from store, and the next
    // save diffs across states (cross-tenant deletes in the switch case).
    const slice = scopedData("a1", { clients: [client("c1")] });
    let releaseState: (() => void) | null = null;
    let releaseBatch: (() => void) | null = null;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/batch")) {
        return new Promise<Response>((resolve) => {
          releaseBatch = () => resolve(commitReceipt(init));
        });
      }
      return new Promise<Response>((resolve) => {
        releaseState = () => resolve(new Response(JSON.stringify(slice), { status: 200 }));
      });
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const loading = a.loadAll("a1"); // fetch held — generation already bumped
    const saving = a.saveAll(withData({ clients: [client("cX")] })); // starts mid-load, batch held
    releaseState!(); // the load seeds lastSynced = slice
    await loading;
    releaseBatch!(); // the batch settles AFTER the seed
    await saving;
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    // The seed survived: re-saving the loaded slice is a no-op.
    await a.saveAll(slice);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("a queued save parked before a reload seed rejects without dispatching against the new basis", async () => {
    // Coalesce-to-latest parks a second save while the first is in flight. If a reload seeds the
    // snapshot before drain picks the parked save up, diffing it against the FRESH seed could
    // emit cross-state ops (DELETEs of rows the parked save's tenant never had). It must be
    // rejected — persist.ts can surface/re-push whatever edit it carried.
    const slice = scopedData("a1", { clients: [client("c1")] });
    let releaseBatch: (() => void) | null = null;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/batch")) {
        return new Promise<Response>((resolve) => {
          const r = () => resolve(commitReceipt(init));
          if (!releaseBatch) releaseBatch = r;
          else r(); // only the FIRST batch is held
        });
      }
      return Promise.resolve(new Response(JSON.stringify(slice), { status: 200 }));
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const save1 = a.saveAll(withData({ clients: [client("cX")] })); // batch 1 held
    const save2 = a.saveAll(withData({ clients: [client("cX"), client("cY")] })); // parked
    await a.loadAll("a1"); // reload completes while batch 1 is in flight: seed = slice
    releaseBatch!();
    await expect(Promise.all([save1, save2])).rejects.toThrow(
      "The pending changes were superseded by a refreshed company snapshot.",
    );

    // Exactly ONE batch went out (the parked save was dropped, never diffed against the seed)…
    const batchCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).endsWith("/api/batch"),
    );
    expect(batchCalls).toHaveLength(1);
    // …and the seed survived: re-saving the loaded slice is a no-op.
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await a.saveAll(slice);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
