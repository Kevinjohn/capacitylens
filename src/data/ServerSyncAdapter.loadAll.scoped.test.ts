import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import type { AppData, Client } from "@capacitylens/shared/types/entities";
import { cacheAccountSlice, readCachedAccountSlice } from "./offlineCache";
import { makeResource } from "../test/fixtures";
import {
  TS1,
  TS2,
  client,
  withData,
  scopedData,
  omitKeys,
  commitReceipt,
  batchOps,
  withOfflineCache,
} from "./ServerSyncAdapter.testSupport";

function registerScopedLoadTests(): void {
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
}

function registerCrossAccountLoadTests(): void {
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
}

function registerRollingLoadTests(): void {
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
}

function registerMalformedLoadTests(): void {
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
}

function registerScopedValidationLoadTests(): void {
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
}

function registerLoadWarningTests(): void {
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
      expect(String(warned[0]?.[0])).toContain("disciplines");
      expect(String(warned[0]?.[0])).toContain("resources");
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
}

describe("ServerSyncAdapter.loadAll", () => {
  registerScopedLoadTests();
  registerCrossAccountLoadTests();
  registerRollingLoadTests();
  registerMalformedLoadTests();
  registerScopedValidationLoadTests();
  registerLoadWarningTests();
});
