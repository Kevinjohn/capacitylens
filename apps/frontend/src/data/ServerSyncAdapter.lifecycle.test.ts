import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter, LifecycleRestoreError, KeepaliveNotDispatchedError } from "./ServerSyncAdapter";
import type { Discipline } from "@capacitylens/shared/types/entities";
import { AUDIT_WARNING_EVENT } from "@/lib/auditWarning";
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

    await a.saveAll(scopedData("a1", { clients: [client("c1")] }));
    // Lifecycle entities must archive through their dedicated routes; ordinary batch deletion is invalid.
    calls.length = 0;
    await a.saveAll(scopedData("a1", {}));
    const urls = calls.map((c) => c.url);
    expect(urls).toContain("http://x/api/clients/c1/archive");

    expect(urls.some((u) => u.endsWith("/clients/c1/delete"))).toBe(false);

    const archive = required(calls.find((call) => call.url.endsWith("/clients/c1/archive")));
    expect(requiredRecord(JSON.parse(required(archive.body)), "expected archive request payload")).toEqual({
      accountId: "a1",
    });

    for (const bc of calls.filter((c) => c.url.endsWith("/api/batch"))) {
      expect(opsOf(bc).some((o) => o.method === "DELETE" && o.table === "clients")).toBe(false);
    }

    calls.length = 0;
    await a.saveAll(scopedData("a1", { clients: [client("c2")] }));
    const put = required(calls.find((call) => call.url.endsWith("/api/batch")));
    expect(opsOf(put)).toEqual([expect.objectContaining({ method: "PUT", table: "clients", id: "c2" })]);
  });

  it("announces an audit warning returned by the dedicated archive route", async () => {
    // The archive route goes through `this.request` (raw fetchImpl), not apiFetch, so it must check
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
    // Unarchival bypasses apiFetch, so it must surface the audit warning explicitly.
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

    calls.length = 0;
    await a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }));

    const batch = required(calls.find((call) => call.url.endsWith("/api/batch")));
    expect(opsOf(batch)).toEqual([
      expect.objectContaining({
        method: "PUT",
        table: "disciplines",
        id: "d1",
      }),
    ]);
    expect(opsOf(batch).some((o) => o.table === "clients")).toBe(false);

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

    calls.length = 0;
    await expect(a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }))).rejects.toThrow(/Lifecycle archive/);

    expect(opsOf(required(calls.find((call) => call.url.endsWith("/api/batch"))))).toEqual([
      expect.objectContaining({
        method: "PUT",
        table: "disciplines",
        id: "d1",
      }),
    ]);

    // Retry only unconverged archives; an already committed ordinary edit must not replay.

    failArchive = false;
    calls.length = 0;
    await a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }));
    expect(calls.some((c) => c.url.endsWith("/api/batch"))).toBe(false);
    expect(calls.map((c) => c.url)).toContain("http://x/api/clients/c1/archive");

    calls.length = 0;
    await a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }));
    expect(calls).toHaveLength(0);
  });
}

function registerLifecycleConflictTests(): void {
  it("(d) a lifecycle-ARCHIVE 409 (already archived) is treated as converged, not a poison", async () => {
    // A 409 with code already_inactive proves archival converged. Only the API row-absence
    // envelope makes a 404 converged; other conflicts and proxy responses remain failures.
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
    await expect(a.saveAll(scopedData("a1", {}))).resolves.toBeUndefined();

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
    await expect(a.saveAll(scopedData("a1", {}))).resolves.toBeUndefined();
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
    // Teardown must dispatch one ordered transaction so foreign-key dependencies survive page exit.
    const { calls, fetchImpl } = recordingFetch();
    const a = new ServerSyncAdapter("http://x", fetchImpl);
    await a.saveAll(
      scopedData("a1", {
        clients: [client("c1")],
        disciplines: [discipline()],
      }),
    );

    calls.length = 0;
    await a.saveAll(scopedData("a1", { disciplines: [discipline(TS2)] }), {
      unload: true,
    });

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
    expect(calls.some((c) => c.url.endsWith("/clients/c1/delete"))).toBe(false);
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
    await vi.waitFor(() => expect(calls).toHaveLength(1));

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
