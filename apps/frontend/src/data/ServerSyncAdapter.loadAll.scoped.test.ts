import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import type { AppData, Client } from "@capacitylens/shared/types/entities";
import { cacheAccountSlice, readCachedAccountSlice } from "./offlineCache";
import { makeResource } from "@/test/fixtures";
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
    expect(urls[0]).toBe("http://x/api/state?accountId=a1");

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
          // Use a preset colour so migration does not repair the fixture before the diff is exercised.
          color: "#2d75da",
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
    // Switching accounts must reseed the diff baseline so saving the new slice cannot emit removals for the previous tenant.

    const a1c = client("c1");
    const a2c: Client = {
      ...NULLABLE_FIELDS.clients,
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

    await a.loadAll("a1");
    nextSlice = a2Slice;
    await a.loadAll("a2");
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    await a.saveAll(a2Slice);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(0);

    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await a.saveAll(
      scopedData("a2", {
        clients: [{ ...a2c, name: "Beta II", updatedAt: TS2 }],
      }),
    );
    const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(ops.every((o) => o.id !== "c1")).toBe(true);
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
    // An omitted table can hydrate as empty only when retained rows do not reference it.
    // A present non-array table remains corrupt.

    const slice = omitKeys(scopedData("a1", { clients: [client("c1")] }), "disciplines");
    const a = new ServerSyncAdapter(
      "http://x",
      vi.fn(async () => new Response(JSON.stringify(slice), { status: 200 })) as unknown as typeof fetch,
    );
    const loaded = await a.loadAll("a1");
    expect(loaded.disciplines).toEqual([]);
    expect(loaded.clients.map((r) => r.id).sort()).toEqual(["c1", "internal:a1"]);
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
            // A retained allocation referencing projects makes an omitted project table unsafe.
            projectId: "p1",
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
    // A present non-array table is corrupt and must not be coerced to an empty table.
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
    // The returned account must match the requested account even when table schemas differ.

    const wrongTenant = scopedData("a2", { clients: [client("c1")] });
    const a = new ServerSyncAdapter(
      "http://x",
      vi.fn(async () => new Response(JSON.stringify(wrongTenant), { status: 200 })) as unknown as typeof fetch,
    );
    await expect(a.loadAll("a1")).rejects.toThrow("cross-tenant or incomplete state payload");
  });
}

function registerLoadWarningTests(): void {
  it("warns ONCE naming the missing table(s) when hydrating them empty (FIX 3)", async () => {
    // Log omitted tables once per load so structural version skew remains diagnosable.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const state = omitKeys(withData({ clients: [client("c1")] }), "disciplines", "resources");
      const a = new ServerSyncAdapter(
        "http://x",
        vi.fn(async () => new Response(JSON.stringify(state), { status: 200 })) as unknown as typeof fetch,
      );
      await a.loadAll();
      const warned = warn.mock.calls.filter((c) => String(c[0]).includes("omitted known table"));
      expect(warned).toHaveLength(1);
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
