import { describe, it, expect, vi } from "vitest";
import {
  ServerSyncAdapter,
  BatchConflictError,
  BatchValidationError,
  BatchMasqueradeReadOnlyError,
} from "./ServerSyncAdapter";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Allocation, Discipline, TimeOff } from "@capacitylens/shared/types/entities";
import { AUDIT_WARNING_EVENT } from "../lib/auditWarning";
import {
  TS1,
  client,
  project,
  allocation,
  timeOff,
  withData,
  batchOps,
  commitReceipt,
  required,
  okFetch,
} from "./ServerSyncAdapter.testSupport";

function registerIndependentTimeOffBatchTest(): void {
  it("dispatches multiple independent time-off entries as PUTs in one eventual batch", async () => {
    const fetchImpl = okFetch() as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    const entries = [
      timeOff("timeoff-repeat-1", "2026-06-01", "First entry"),
      timeOff("timeoff-repeat-2", "2026-06-08", "Second entry"),
      timeOff("timeoff-repeat-3", "2026-06-15", "Third entry"),
    ];

    await adapter.saveAll(withData({ timeOff: entries }));

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(batchOps(calls[0])).toEqual(
      entries.map((entry) =>
        expect.objectContaining({
          method: "PUT",
          table: "timeOff",
          id: entry.id,
          row: entry,
        }),
      ),
    );
  });
}

function registerTimeOffRetryTest(): void {
  it("retries a failed multi-entry time-off batch with the same stored IDs", async () => {
    let failNext = true;
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/api/batch") && failNext) return new Response("boom", { status: 500 });
      return commitReceipt(init);
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    const entries = [timeOff("retry-timeoff-1", "2026-07-06"), timeOff("retry-timeoff-2", "2026-07-13")];

    await expect(adapter.saveAll(withData({ timeOff: entries }))).rejects.toThrow();
    const firstOps = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);

    failNext = false;
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await adapter.saveAll(withData({ timeOff: entries }));
    const retryOps = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);

    expect(retryOps.map((op) => op.id)).toEqual(firstOps.map((op) => op.id));
    expect(retryOps.map((op) => op.id)).toEqual(entries.map((entry) => entry.id));
  });
}

function registerBasicSaveTests(): void {
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
    expect(calls[0]?.[0]).toBe("http://x/api/batch");
    expect((calls[0]?.[1] as RequestInit).method).toBe("POST");
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
}

function registerBatchFailureAndUnloadTests(): void {
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
    expect(calls[0]?.[0]).toBe("http://x/api/batch");
    const init = calls[0]?.[1] as RequestInit;
    expect(init.keepalive).toBe(true);
    expect(batchOps(calls[0])).toHaveLength(2); // all ops in one ordered request
  });
}

function registerInFlightKeepaliveTests(): void {
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
    expect((calls[1]?.[1] as RequestInit).keepalive).toBe(true);
    expect(batchOps(calls[1]).map((op) => op.id)).toEqual(["c1", "c2"]);
    const firstHeaders = new Headers((calls[0]?.[1] as RequestInit).headers);
    const secondHeaders = new Headers((calls[1]?.[1] as RequestInit).headers);
    expect(secondHeaders.get("X-CapacityLens-Sync-Session")).toBe(firstHeaders.get("X-CapacityLens-Sync-Session"));
    expect(firstHeaders.get("X-CapacityLens-Sync-Sequence")).toBe("1");
    expect(secondHeaders.get("X-CapacityLens-Sync-Sequence")).toBe("2");

    required(releaseFirst)();
    await Promise.all([ordinary, teardown]);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // no later non-keepalive drain of the parked state
  });
}

function registerCompensatingKeepaliveTests(): void {
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
    required(releaseFirst)();
    await Promise.all([ordinary, teardown]);
  });
}

function registerScopedDeleteSaveTests(): void {
  it("carries the owning account on a scoped (non-lifecycle) DELETE op; accounts (top-level) carry none", async () => {
    // Uses a scoped NON-lifecycle row (timeOff): lifecycle-entity deletes (clients/projects/resources/activities)
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
}

function registerConflictSaveTests(): void {
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
}

function registerRejectedSaveTests(): void {
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

  it("maps MASQUERADE_READ_ONLY to terminal reconciliation instead of retrying", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ code: "MASQUERADE_READ_ONLY" }), {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }),
    ) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    const error: unknown = await adapter
      .saveAll(withData({ clients: [client("c1")] }))
      .catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(BatchMasqueradeReadOnlyError);
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
}

describe("ServerSyncAdapter.saveAll", () => {
  registerBasicSaveTests();
  registerIndependentTimeOffBatchTest();
  registerBatchFailureAndUnloadTests();
  registerTimeOffRetryTest();
  registerInFlightKeepaliveTests();
  registerCompensatingKeepaliveTests();
  registerScopedDeleteSaveTests();
  registerConflictSaveTests();
  registerRejectedSaveTests();
});
