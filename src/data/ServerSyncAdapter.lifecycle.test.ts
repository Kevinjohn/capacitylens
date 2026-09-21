import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter, LifecycleRestoreError, KeepaliveNotDispatchedError } from "./ServerSyncAdapter";
import type { Discipline } from "@capacitylens/shared/types/entities";
import { AUDIT_WARNING_EVENT } from "../lib/auditWarning";
import {
  TS1,
  TS2,
  client,
  scopedData,
  requiredRecord,
  parseReceiptOps,
  commitReceipt,
  required,
} from "./ServerSyncAdapter.testSupport";

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
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
      ...(init?.keepalive === undefined ? {} : { keepalive: init.keepalive }),
    });
    return onCall?.(url) ?? commitReceipt(init);
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};
const opsOf = (call: { body?: string } | undefined) => {
  if (!call?.body) throw new Error("expected a recorded request body");
  return parseReceiptOps(call.body);
};

function registerLifecycleArchiveTests(): void {
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
    const archive = required(calls.find((call) => call.url.endsWith("/clients/c1/archive")));
    expect(requiredRecord(JSON.parse(required(archive.body)), "expected archive request payload")).toEqual({
      accountId: "a1",
    });
    // no batch carried a lifecycle DELETE.
    for (const bc of calls.filter((c) => c.url.endsWith("/api/batch"))) {
      expect(opsOf(bc).some((o) => o.method === "DELETE" && o.table === "clients")).toBe(false);
    }

    // 3) a later unrelated edit still syncs — the poison is gone.
    calls.length = 0;
    await a.saveAll(scopedData("a1", { clients: [client("c2")] }));
    const put = required(calls.find((call) => call.url.endsWith("/api/batch")));
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
}

function registerLifecycleRestoreTests(): void {
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
}

function registerLifecycleRestoreOrderingTests(): void {
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
    const op = required(opsOf(calls[1])[0]);
    expect(op).toMatchObject({ method: "PUT", table: "clients", id: "c1" });
    expect(op.row).toMatchObject({ name: "Redone and renamed", updatedAt: TS2 });
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
}

function registerLifecycleBatchOrderingTests(): void {
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
    const batch = required(calls.find((call) => call.url.endsWith("/api/batch")));
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
    expect(opsOf(required(calls.find((call) => call.url.endsWith("/api/batch"))))).toEqual([
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
}

function registerLifecycleConflictTests(): void {
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
}

function registerLifecycleMissingRouteTests(): void {
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
}

function registerLifecycleUnloadTests(): void {
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
    expect(batchCalls[0]?.keepalive).toBe(true);
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
}

function registerLifecycleUnloadFailureTests(): void {
  it("rejects an unload flush when its lifecycle archive does not positively commit", async () => {
    let rejectArchive: ((reason: Error) => void) | undefined;
    const calls: Array<{ url: string; body?: string; keepalive?: boolean }> = [];
    const controlledFetch = vi.fn((url: string, init?: RequestInit): Promise<Response> => {
      calls.push({
        url,
        ...(typeof init?.body === "string" ? { body: init.body } : {}),
        ...(init?.keepalive === undefined ? {} : { keepalive: init.keepalive }),
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
    required(rejectArchive)(new Error("keepalive dropped"));
    await expect(teardown).rejects.toThrow("keepalive dropped");
    expect(settled).toBe(true);
  });
}

function registerLifecyclePostUnloadRestoreTests(): void {
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
}

describe("lifecycle-entity deletes route out of the batch as ARCHIVE-ONLY convergence (DEFECT A)", () => {
  registerLifecycleArchiveTests();
  registerLifecycleRestoreTests();
  registerLifecycleRestoreOrderingTests();
  registerLifecycleBatchOrderingTests();
  registerLifecycleConflictTests();
  registerLifecycleMissingRouteTests();
  registerLifecycleUnloadTests();
  registerLifecycleUnloadFailureTests();
  registerLifecyclePostUnloadRestoreTests();
});
