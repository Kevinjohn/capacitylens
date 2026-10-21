import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter } from "./ServerSyncAdapter";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Discipline } from "@capacitylens/shared/types/entities";
import {
  TS1,
  TS2,
  client,
  withData,
  batchOps,
  requiredRecord,
  requiredString,
  opsFromInit,
  required,
} from "./ServerSyncAdapter.testSupport";

const ackReceipt = (init?: RequestInit): Response => {
  const ops = opsFromInit(init);
  return new Response(
    JSON.stringify({
      ok: true,
      applied: ops.length,
      revisions: ops
        .filter((op) => op.row !== undefined)
        .map((o) => {
          const row = requiredRecord(o.row, "expected acknowledged row");
          return {
            table: o.table,
            id: o.id,
            createdAt: requiredString(row.createdAt, "expected createdAt in batch row"),
            updatedAt: `${requiredString(row.updatedAt, "expected updatedAt in batch row")}::server`,
          };
        }),
    }),
    { status: 200 },
  );
};

async function expectDurableAckAcrossUnrelatedSaves(): Promise<void> {
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ackReceipt(init)) as unknown as typeof fetch;
  const a = new ServerSyncAdapter("http://x", fetchImpl);

  await a.saveAll(withData({ clients: [client("c1", TS1)] }));

  await a.saveAll(withData({ clients: [client("c1", TS1), client("c2", TS1)] }));
  await a.saveAll(withData({ clients: [client("c1", TS1), client("c2", TS1), client("c3", TS1)] }));
  await a.saveAll(withData({ clients: [client("c1", TS1), client("c2", TS1), client("c3", TS1), client("c4", TS1)] }));
  const batches = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((call) =>
    batchOps(call).map((op) => op.id),
  );

  expect(batches).toEqual([["c1"], ["c2"], ["c3"], ["c4"]]);
}

async function expectNoPhantomPutOnUnload(): Promise<void> {
  const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ackReceipt(init)) as unknown as typeof fetch;
  const adapter = new ServerSyncAdapter("http://x", fetchImpl);
  const localState = withData({ clients: [client("c1", TS1)] });

  await adapter.saveAll(localState);
  (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
  await adapter.saveAll(localState, { unload: true });

  expect(fetchImpl).not.toHaveBeenCalled();
}

describe("ServerSyncAdapter — durable acknowledged-revision translation (phantom-PUT guard)", () => {
  it(
    "emits ZERO further ops for a previously-acked row across many unrelated saves",
    expectDurableAckAcrossUnrelatedSaves,
  );

  it("emits no phantom PUT for a previously-acked row during an unload flush", expectNoPhantomPutOnUnload);

  it("emits exactly one PUT when a previously-acked row is genuinely edited again, then is durable anew", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ackReceipt(init)) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(withData({ clients: [client("c1", TS1)] }));
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    await a.saveAll(withData({ clients: [{ ...client("c1", TS2), name: "Renamed" }] }));
    let calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(1);
    expect(batchOps(calls[0]).map((o) => o.id)).toEqual(["c1"]);

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
    await a.saveAll(withData({ clients: [client("c1", TS1)] }));
    await a.loadAll();
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();
    // Clear translations on rehydrate so a recreated row using an old client stamp sends that stamp rather than an unrelated server revision.
    await a.saveAll(withData({ clients: [client("c1", TS1)] }));
    const wire = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(wire.map((o) => o.id)).toEqual(["c1"]);
    expect(requiredRecord(required(wire[0]).row, "expected recreated client row").updatedAt).toBe(TS1);
  });

  it("prunes a translation after committed deletion so an id can reuse its client stamp safely", async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => ackReceipt(init)) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    const row: Discipline = {
      id: "d1",
      accountId: "a1",
      name: "Design",
      sortOrder: 0,
      color: null,
      createdAt: TS1,
      updatedAt: TS1,
    };
    await a.saveAll(withData({ disciplines: [row] }));
    await a.saveAll(emptyAppData());
    (fetchImpl as unknown as ReturnType<typeof vi.fn>).mockClear();

    await a.saveAll(withData({ disciplines: [row] }));

    const wire = batchOps((fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]);
    expect(requiredRecord(required(wire[0]).row, "expected recreated discipline row").updatedAt).toBe(TS1);
  });
});

// Background sync archives lifecycle entities reversibly after ordinary batch writes.
// It never emits their irreversible, privileged delete operation.
