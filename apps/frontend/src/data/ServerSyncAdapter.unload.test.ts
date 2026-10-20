import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter, KeepaliveNotDispatchedError } from "./ServerSyncAdapter";
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

  const clients = manyClients(5001);
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
    color: null,
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
  it("sends a diff larger than the retired operation cap as one ordered transaction", expectAtomicLargeDiff);

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

  // Use an ordinary discipline delete to exercise the ordered keepalive batch without lifecycle classification.
  it(
    "a small unload flush is one keepalive transaction and includes every (batch-eligible) DELETE",
    expectSmallUnloadBatch,
  );
});

async function expectSupersededLoadNotToReseedSnapshot(): Promise<void> {
  // A late response from another account must not replace the current account
  // baseline or the next save could diff across tenants.

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

  const slowA1 = a.loadAll("a1");
  await a.loadAll("a2");
  required(releaseA1)();
  await slowA1;
  (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

  await a.saveAll(
    scopedData("a2", {
      clients: [{ ...a2c, name: "Beta II", updatedAt: TS2 }],
    }),
  );
  const ops = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);
  expect(ops).toEqual([expect.objectContaining({ method: "PUT", table: "clients", id: "c2" })]);
}

async function expectInFlightBatchNotToClobberReloadSeed(): Promise<void> {
  // A reseeded baseline must win over an earlier in-flight save.
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

  const saving = a.saveAll(withData({ clients: [client("cX")] }));
  await a.loadAll("a1");
  required(releaseBatch)();
  await saving;
  (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

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

  const loading = adapter.loadAll("a1");
  const saving = adapter.saveAll(withData({ clients: [client("cX")] }));
  required(releaseState)();
  await loading;
  required(releaseBatch)();
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
    // Reject a queued target from an older generation before it can reach the server.
    const slice = scopedData("a1", { clients: [client("c1")] });
    let releaseBatch: (() => void) | undefined;
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (String(url).endsWith("/api/batch")) {
        return new Promise<Response>((resolve) => {
          const r = () => resolve(commitReceipt(init));
          if (!releaseBatch) releaseBatch = r;
          else r();
        });
      }
      return Promise.resolve(new Response(JSON.stringify(slice), { status: 200 }));
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const save1 = a.saveAll(withData({ clients: [client("cX")] }));
    const save2 = a.saveAll(withData({ clients: [client("cX"), client("cY")] }));
    await a.loadAll("a1");
    required(releaseBatch)();
    await expect(Promise.all([save1, save2])).rejects.toThrow(
      "The pending changes were superseded by a refreshed company snapshot.",
    );

    const batchCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
      String(c[0]).endsWith("/api/batch"),
    );
    expect(batchCalls).toHaveLength(1);

    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    await a.saveAll(slice);
    expect((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });
});
