import { describe, it, expect, vi } from "vitest";
import {
  ServerSyncAdapter,
  BatchTooLargeError,
  KeepaliveNotDispatchedError,
  MAX_OPS_PER_BATCH,
} from "./ServerSyncAdapter";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Client } from "@capacitylens/shared/types/entities";
import type { Discipline } from "@capacitylens/shared/types/entities";
import {
  TS1,
  TS2,
  client,
  withData,
  scopedData,
  batchOps,
  opsFromInit,
  commitReceipt,
  required,
  okFetch,
} from "./ServerSyncAdapter.testSupport";

const manyClients = (count: number) => Array.from({ length: count }, (_, index) => client(`c${index}`));

async function expectAtomicLargeDiff(): Promise<void> {
  const batches: string[][] = [];
  const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/api/batch")) batches.push(opsFromInit(init).map((op) => op.id));
    return commitReceipt(init);
  }) as unknown as typeof fetch;
  const adapter = new ServerSyncAdapter("http://x", fetchImpl);

  const clients = manyClients(4500);
  await adapter.saveAll(withData({ clients }));

  expect(batches).toHaveLength(1);
  expect(batches[0]).toEqual(clients.map((row) => row.id));
}

async function expectLifecycleArchiveBudgetedWithSiblingBatch(): Promise<void> {
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
}

async function expectSmallUnloadBatch(): Promise<void> {
  const discipline = (id: string): Discipline => ({
    id,
    accountId: "a1",
    name: id,
    sortOrder: 0,
    createdAt: TS1,
    updatedAt: TS1,
  });
  const fetchImpl = okFetch() as unknown as typeof fetch;
  const adapter = new ServerSyncAdapter("http://x", fetchImpl);
  await adapter.saveAll(withData({ disciplines: [discipline("d1"), discipline("d2")] }));
  (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
  await adapter.saveAll(emptyAppData(), { unload: true });
  const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
  expect(calls).toHaveLength(1);
  expect((calls[0]?.[1] as RequestInit).keepalive).toBe(true);
  expect(batchOps(calls[0]).map((op) => op.method)).toEqual(["DELETE", "DELETE"]);
}

describe("atomic large diffs and unload behaviour", () => {
  it("sends 4500 ordinary UI ops as one ordered transaction", expectAtomicLargeDiff);

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

  it(
    "budgets a lifecycle archive with its sibling keepalive batch before dispatching either",
    expectLifecycleArchiveBudgetedWithSiblingBatch,
  );

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

  // Lifecycle deletes deliberately do not flush on unload because archive then delete cannot complete
  // on a dying page. This scenario covers ordinary batch-eligible discipline deletes.
  it(
    "a small unload flush is one keepalive transaction and includes every (batch-eligible) DELETE",
    expectSmallUnloadBatch,
  );
});

async function expectSupersededLoadNotToReseedSnapshot(): Promise<void> {
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
  let releaseA1: (() => void) | undefined;
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
  required(releaseA1)();
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
}

async function expectInFlightBatchNotToClobberReloadSeed(): Promise<void> {
  // drain() computes its diff, awaits the POST, then advances lastSynced — if a loadAll
  // completed in that window, advancing would overwrite the fresh seed with the pre-reload
  // target (snapshot ≠ store). The generation check makes the reload's seed win; the skipped
  // advance is safe because the server already holds the batch's idempotent ops.
  const slice = scopedData("a1", { clients: [client("c1")] });
  let releaseBatch: (() => void) | undefined;
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
  required(releaseBatch)();
  await saving;
  (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

  // Re-saving the loaded slice must be a no-op — the reload's seed survived the batch settle.
  // (Without the guard, snapshot would be the cX target and this would emit c1/cX ops.)
  await a.saveAll(slice);
  expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
}

async function expectMidLoadSaveNotToClobberSeed(): Promise<void> {
  // A save beginning mid-load captures the same generation the load will seed under, so the guard
  // must key on seeds rather than load starts.
  const slice = scopedData("a1", { clients: [client("c1")] });
  let releaseState: (() => void) | undefined;
  let releaseBatch: (() => void) | undefined;
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
  const adapter = new ServerSyncAdapter("http://x", fetchImpl);

  const loading = adapter.loadAll("a1"); // fetch held — generation already bumped
  const saving = adapter.saveAll(withData({ clients: [client("cX")] })); // starts mid-load, batch held
  required(releaseState)(); // the load seeds lastSynced = slice
  await loading;
  required(releaseBatch)(); // the batch settles AFTER the seed
  await saving;
  (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

  await adapter.saveAll(slice);
  expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
}

describe("snapshot generation guard (superseded loads / in-flight batches)", () => {
  it(
    "a SUPERSEDED loadAll resolving late does NOT re-seed the snapshot over the newer load",
    expectSupersededLoadNotToReseedSnapshot,
  );

  it(
    "an in-flight batch resolving AFTER a reload does not clobber the fresh snapshot seed",
    expectInFlightBatchNotToClobberReloadSeed,
  );

  it(
    "a save that STARTS while a loadAll is already in flight cannot clobber that load's seed (same-generation race)",
    expectMidLoadSaveNotToClobberSeed,
  );

  it("a queued save parked before a reload seed rejects without dispatching against the new basis", async () => {
    // Coalesce-to-latest parks a second save while the first is in flight. If a reload seeds the
    // snapshot before drain picks the parked save up, diffing it against the FRESH seed could
    // emit cross-state ops (DELETEs of rows the parked save's tenant never had). It must be
    // rejected — persist.ts can surface/re-push whatever edit it carried.
    const slice = scopedData("a1", { clients: [client("c1")] });
    let releaseBatch: (() => void) | undefined;
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
    required(releaseBatch)();
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
