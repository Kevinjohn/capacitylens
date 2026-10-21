import { NULLABLE_FIELDS } from "@capacitylens/shared/types/nullableFields";
import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter, BatchCommitUncertainError } from "./ServerSyncAdapter";
import type { Activity, Allocation, AppData } from "@capacitylens/shared/types/entities";
import { withoutAllocationAttribution } from "@capacitylens/shared/lib/integrity";
import {
  TS1,
  TS2,
  client,
  allocation,
  withData,
  batchOps,
  requiredRecord,
  opsFromInit,
  revisionFor,
  commitReceipt,
  required,
} from "./ServerSyncAdapter.testSupport";
import type { ReceiptOp } from "./ServerSyncAdapter.testSupport";

const concurrentRewriteFixture = () => {
  const activity: Activity = {
    ...NULLABLE_FIELDS.activities,
    id: "t1",
    accountId: "a1",
    name: "Planning",
    kind: "repeatable",
    createdAt: TS1,
    updatedAt: TS1,
  };
  const allocationRow = { ...allocation("allocation", "2026-01-01"), projectId: "p1" };
  return {
    activity,
    allocationRow,
    baseline: withData({ activities: [activity], allocations: [allocationRow] }),
    rewrittenAt: "2030-01-02T00:00:00.000Z",
  };
};

interface ConcurrentRewriteReceiptInput {
  activity: Activity;
  allocationRow: Allocation;
  flushed: AppData;
  rewrittenAt: string;
}

const concurrentRewriteReceipt = ({
  activity,
  allocationRow,
  flushed,
  rewrittenAt,
}: ConcurrentRewriteReceiptInput): Response =>
  Response.json({
    ok: true,
    applied: 1,
    revisions: [
      revisionFor({ method: "PUT", table: "activities", id: activity.id, row: required(flushed.activities[0]) }),
      {
        table: "allocations",
        id: allocationRow.id,
        createdAt: TS1,
        updatedAt: rewrittenAt,
        rewrite: true,
      },
    ],
  });

function registerRevisionCoverageTests(): void {
  it.each([
    ["omitted", () => ({})],
    ["empty", () => ({ revisions: [] })],
    ["partial", (ops: ReceiptOp[]) => ({ revisions: [revisionFor(required(ops[0]))] })],
    [
      "duplicate",
      (ops: ReceiptOp[]) => ({
        revisions: [revisionFor(required(ops[0])), revisionFor(required(ops[0]))],
      }),
    ],
  ])(
    "requires an authoritative reload for committed receipts with %s revision coverage",
    async (_case, revisionFields) => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
        const ops = opsFromInit(init);
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
}

function registerUnexpectedRevisionTests(): void {
  it("drops an extra revision when every written row still has authoritative coverage", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const ops = opsFromInit(init);
      return Response.json({
        ok: true,
        applied: ops.length,
        revisions: [...ops.map(revisionFor), { ...revisionFor(required(ops[0])), id: "unexpected" }],
      });
    }) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    await expect(a.saveAll(withData({ clients: [client("c1"), client("c2")] }))).resolves.toBeUndefined();
  });
}

function registerTaggedRewriteTests(): void {
  it("remembers a tagged rewrite from the committed snapshot without a phantom follow-up PUT", async () => {
    const activity: Activity = {
      ...NULLABLE_FIELDS.activities,
      id: "t1",
      accountId: "a1",
      name: "Planning",
      kind: "repeatable",
      createdAt: TS1,
      updatedAt: TS1,
    };
    const allocationRow = { ...allocation("allocation", "2026-01-01"), projectId: "p1" };
    const baseline = withData({ activities: [activity], allocations: [allocationRow] });
    const rewrittenAt = "2030-01-02T00:00:00.000Z";
    let batchNumber = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/state")) return Response.json(baseline);
      batchNumber += 1;
      const ops = opsFromInit(init);
      return Response.json({
        ok: true,
        applied: ops.length,
        revisions: [
          ...ops.map(revisionFor),
          ...(batchNumber === 1
            ? [{ table: "allocations", id: allocationRow.id, createdAt: TS1, updatedAt: rewrittenAt, rewrite: true }]
            : []),
        ],
      });
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    let visible = await adapter.loadAll();
    adapter.setAllocationRewriteHandler((revisions) => {
      const revision = required(revisions[0]);
      visible = {
        ...visible,
        allocations: visible.allocations.map((row) =>
          row.id === revision.id ? withoutAllocationAttribution(row, revision.updatedAt) : row,
        ),
      };
    });

    visible = {
      ...visible,
      allocations: [{ ...required(visible.allocations[0]), note: "Tab edit", updatedAt: TS2 }],
    };
    await adapter.saveAll(visible);
    visible = {
      ...visible,
      activities: [{ ...required(visible.activities[0]), kind: "internal", updatedAt: "2026-01-03T00:00:00.000Z" }],
    };
    await adapter.saveAll(visible);

    expect(visible.allocations[0]).toHaveProperty("projectId", null);
    expect(visible.allocations[0]?.updatedAt).toBe(rewrittenAt);
    await adapter.saveAll(visible);
    expect(batchNumber).toBe(1);
  });
}

function registerConcurrentRewriteTests(): void {
  it.each([
    ["ordinary", undefined],
    ["unload", { unload: true }],
  ] as const)("keeps a concurrent allocation edit dirty after an %s rewrite receipt", async (_label, options) => {
    const { activity, allocationRow, baseline, rewrittenAt } = concurrentRewriteFixture();
    let releaseReceipt: ((response: Response) => void) | undefined;
    const fetchImpl = vi.fn((url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith("/api/state")) return Promise.resolve(Response.json(baseline));
      if (!releaseReceipt) {
        return new Promise<Response>((resolve) => {
          releaseReceipt = resolve;
        });
      }
      return Promise.resolve(commitReceipt(init));
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);
    let visible = await adapter.loadAll();
    // The receipt must be reconciled against the flushed target even if a supplied callback
    // exposes a newer live edit while the request is pending.
    const installRewriteHandler = adapter.setAllocationRewriteHandler.bind(adapter) as (
      handler: Parameters<typeof adapter.setAllocationRewriteHandler>[0],
      legacyGetData: () => AppData,
    ) => void;
    installRewriteHandler(
      (revisions) => {
        const revision = required(revisions[0]);
        visible = {
          ...visible,
          allocations: visible.allocations.map((row) =>
            row.id === revision.id && row.updatedAt === revision.flushedUpdatedAt
              ? withoutAllocationAttribution(row, revision.updatedAt)
              : row,
          ),
        };
      },
      () => visible,
    );
    const flushed = withData({
      ...visible,
      activities: [{ ...required(visible.activities[0]), kind: "internal", updatedAt: TS2 }],
    });

    const saving = adapter.saveAll(flushed, options);
    await vi.waitFor(() => expect(releaseReceipt).toBeTypeOf("function"));
    visible = {
      ...flushed,
      allocations: [{ ...required(flushed.allocations[0]), projectId: "p2", updatedAt: "2026-01-03T00:00:00.000Z" }],
    };
    required(releaseReceipt)(concurrentRewriteReceipt({ activity, allocationRow, flushed, rewrittenAt }));
    await saving;

    expect(visible.allocations[0]).toMatchObject({
      projectId: "p2",
      updatedAt: "2026-01-03T00:00:00.000Z",
    });
    await adapter.saveAll(visible);
    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    const followUpTables = calls.slice(2).flatMap((call) => batchOps(call).map((op) => op.table));
    expect(followUpTables).not.toContain("allocations");
  });
}

function registerQueuedSaveTests(): void {
  it("keeps duplicate revisions strict for non-allocation tables", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const ops = opsFromInit(init);
      return Response.json({
        ok: true,
        applied: ops.length,
        revisions: [revisionFor(required(ops[0])), revisionFor(required(ops[0]))],
      });
    }) as unknown as typeof fetch;
    const adapter = new ServerSyncAdapter("http://x", fetchImpl);

    await expect(adapter.saveAll(withData({ clients: [client("c1")] }))).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("unexpected or duplicate"));
  });

  it("coalesces overlapping saves to the latest state", async () => {
    let resolveFirst: (() => void) | undefined;
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((resolve) => {
          if (!resolveFirst) resolveFirst = () => resolve(commitReceipt(init));
          else resolve(commitReceipt(init));
        }),
    ) as unknown as typeof fetch;
    const a = new ServerSyncAdapter("http://x", fetchImpl);

    const p1 = a.saveAll(withData({ clients: [client("c1")] }));
    const p2 = a.saveAll(withData({ clients: [client("c1"), client("c2")] }));
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf("function"));
    required(resolveFirst)();
    await Promise.all([p1, p2]);
    const batches = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) =>
      batchOps(c).map((o) => o.id),
    );

    expect(batches).toEqual([["c1"], ["c2"]]);
  });
}

const queuedFirstReceipt = (): Response =>
  Response.json({
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
  });

function registerQueuedRebaseTests(): void {
  it("rebases a queued edit onto the server revision returned by the in-flight batch", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    let batchNumber = 0;
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      batchNumber += 1;
      const current = batchNumber;
      const ops = opsFromInit(init);
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
    await vi.waitFor(() => expect(resolveFirst).toBeTypeOf("function"));
    required(resolveFirst)(queuedFirstReceipt());
    await Promise.all([p1, p2]);

    const calls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls).toHaveLength(2);
    const queuedRow = requiredRecord(required(batchOps(calls[1])[0]).row, "expected queued client row");
    expect(queuedRow.name).toBe("Queued edit");
    expect(queuedRow.updatedAt).toBe("2030-01-01T00:00:00.000Z");

    await adapter.saveAll(second);
    expect(calls).toHaveLength(2);
  });
}

describe("ServerSyncAdapter.saveAll", () => {
  registerRevisionCoverageTests();
  registerUnexpectedRevisionTests();
  registerTaggedRewriteTests();
  registerConcurrentRewriteTests();
  registerQueuedSaveTests();
  registerQueuedRebaseTests();
});
