import { describe, it, expect, vi } from "vitest";
import { ServerSyncAdapter, BatchValidationError, LifecycleRestoreError } from "./ServerSyncAdapter";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import { cacheAccountSlice, readOfflineStateSnapshot, setOfflineReadState } from "./offlineCache";
import * as offlineCacheModule from "./offlineCache";
import {
  TS1,
  TS2,
  client,
  withData,
  scopedData,
  requiredRecord,
  commitReceipt,
  required,
  saveAgainstReceipt,
  withOfflineCache,
} from "./ServerSyncAdapter.testSupport";

function registerStateFaultTests(): void {
  it.each([[[]], ["not-an-object"]])("rejects a valid JSON %j state body that is not a record", async (body) => {
    const adapter = new ServerSyncAdapter(
      "http://api.test",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch,
    );
    await expect(adapter.loadAll()).rejects.toThrow("invalid state payload");
  });

  it("does not let a superseded unscoped 400 seed or clear offline state", async () => {
    let resolveFirst: ((response: Response) => void) | undefined;
    const first = new Promise<Response>((resolve) => {
      resolveFirst = resolve;
    });
    const fresh = withData({ clients: [client("fresh")] });
    const fetchImpl = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(new Response(JSON.stringify(fresh), { status: 200 }));
    const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);
    const staleLoad = adapter.loadAll();
    await expect(adapter.loadAll()).resolves.toMatchObject({ clients: [{ id: "fresh" }] });
    setOfflineReadState("tenant", true, 123);
    required(resolveFirst)(new Response(null, { status: 400 }));
    await expect(staleLoad).resolves.toEqual(emptyAppData());
    expect(readOfflineStateSnapshot()).toMatchObject({ readOnly: true, lastUpdated: 123 });

    await adapter.saveAll(fresh);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    setOfflineReadState("cleanup", false);
  });

  it("warns when background offline-cache refresh fails without failing hydration", async () => {
    const cause = new Error("cache write failed");
    vi.spyOn(offlineCacheModule, "cacheAccountSlice").mockRejectedValueOnce(cause);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const slice = scopedData("a1", {});
    const adapter = new ServerSyncAdapter(
      "http://api.test",
      vi.fn(async () => new Response(JSON.stringify(slice), { status: 200 })) as unknown as typeof fetch,
    );

    const loaded = await adapter.loadAll("a1");
    expect(loaded.accounts).toMatchObject([{ id: "a1" }]);
    expect(loaded.clients.some((row) => row.id === "internal:a1")).toBe(true);
    await vi.waitFor(() =>
      expect(warning).toHaveBeenCalledWith(
        "ServerSyncAdapter: the offline account snapshot could not be updated",
        cause,
      ),
    );
  });
}

function registerOfflineFaultTests(): void {
  it("hydrates a scoped cached slice on a fetch TypeError and publishes its saved time", async () => {
    await withOfflineCache(async () => {
      const cached = scopedData("a1", {});
      await cacheAccountSlice("a1", cached);
      const adapter = new ServerSyncAdapter(
        "http://api.test",
        vi.fn().mockRejectedValue(new TypeError("offline")) as unknown as typeof fetch,
      );
      const loaded = await adapter.loadAll("a1");
      expect(loaded.accounts).toMatchObject([{ id: "a1" }]);
      expect(loaded.clients.some((row) => row.id === "internal:a1")).toBe(true);
      expect(readOfflineStateSnapshot().readOnly).toBe(true);
      expect(readOfflineStateSnapshot().lastUpdated).toEqual(expect.any(Number));
    });
  });

  it("warns on scoped and identity cache read failures while surfacing the real LoadError", async () => {
    const cause = new Error("cache corrupt");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(offlineCacheModule, "readCachedAccountSlice").mockRejectedValueOnce(cause);
    const scoped = new ServerSyncAdapter(
      "http://api.test",
      vi.fn().mockRejectedValue(new TypeError("network down")) as unknown as typeof fetch,
    );
    await expect(scoped.loadAll("a1")).rejects.toMatchObject({ kind: "unavailable" });
    expect(warning).toHaveBeenCalledWith("ServerSyncAdapter: the offline account snapshot could not be read", cause);

    vi.spyOn(offlineCacheModule, "readCachedAuthSnapshot").mockRejectedValueOnce(cause);
    const identity = new ServerSyncAdapter(
      "http://api.test",
      vi.fn().mockRejectedValue(new TypeError("network down")) as unknown as typeof fetch,
    );
    await expect(identity.loadAll()).rejects.toMatchObject({ kind: "unavailable" });
    expect(warning).toHaveBeenCalledWith("ServerSyncAdapter: the offline identity snapshot could not be read", cause);
  });

  it("returns null from both offline hydration arms when no cache exists", async () => {
    localStorage.removeItem("capacitylens/offlineRead");
    const adapter = new ServerSyncAdapter(
      "http://api.test",
      vi.fn().mockRejectedValue(new TypeError("network down")) as unknown as typeof fetch,
    );
    await expect(adapter.loadAll()).rejects.toMatchObject({ kind: "unavailable" });
    await expect(adapter.loadAll("a1")).rejects.toMatchObject({ kind: "unavailable" });
  });

  it("rejects a non-OK metadata response", async () => {
    const adapter = new ServerSyncAdapter(
      "http://api.test",
      vi.fn(async () => new Response(null, { status: 503 })) as unknown as typeof fetch,
    );
    await expect(adapter.hasExisting()).rejects.toThrow("Failed to read meta (503)");
  });
}

function registerCommitReceiptFaultTests(): void {
  it("maps an unrecognised empty 400 batch response to a generic validation error", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/api/state")
        ? new Response(JSON.stringify(emptyAppData()), { status: 200 })
        : new Response(null, { status: 400 }),
    );
    const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);
    await adapter.loadAll();
    const failure: unknown = await adapter
      .saveAll(withData({ clients: [client("c1")] }))
      .catch((error: unknown): unknown => error);
    expect(failure).toBeInstanceOf(BatchValidationError);
    expect(failure).toMatchObject({ message: "Batch sync failed (400): validation rejected", code: undefined });
  });

  it.each([
    [{ ok: true, applied: 1, superseded: "yes", revisions: [] }, "invalid ordering receipt"],
    [{ ok: true, applied: 1, revisions: [null] }, "complete server revisions"],
    [
      { ok: true, applied: 1, revisions: [{ table: "clients", id: 1, createdAt: TS1, updatedAt: TS1 }] },
      "complete server revisions",
    ],
  ])("rejects malformed ordinary commit receipt %#", async (receipt, message) => {
    await expect(saveAgainstReceipt(receipt)).rejects.toThrow(message);
  });

  it("accepts a superseded receipt without revisions and re-loops without advancing", async () => {
    let batches = 0;
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/api/state")) return new Response(JSON.stringify(emptyAppData()), { status: 200 });
      batches += 1;
      return batches === 1
        ? new Response(JSON.stringify({ ok: true, applied: 1, superseded: true }), { status: 200 })
        : commitReceipt(init);
    });
    const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);
    await adapter.loadAll();
    const next = withData({ clients: [client("c1")] });
    await adapter.saveAll(next);
    await adapter.saveAll(next);
    expect(batches).toBe(2);
  });
}

function registerArchiveReceiptFaultTests(): void {
  it.each([
    [{ ok: true, applied: 1, revisions: [] }, "committed without lifecycle archive receipts"],
    [{ ok: true, applied: 1, revisions: [], archives: [null] }, "invalid lifecycle archive receipt"],
    [
      { ok: true, applied: 1, revisions: [], archives: [{ table: "projects", id: "c1", archived: true }] },
      "invalid lifecycle archive receipt",
    ],
    [
      { ok: true, applied: 1, revisions: [], archives: [{ table: "clients", id: 1, archived: true }] },
      "invalid lifecycle archive receipt",
    ],
    [
      { ok: true, applied: 1, revisions: [], archives: [{ table: "clients", id: "c1", archived: "yes" }] },
      "invalid lifecycle archive receipt",
    ],
    [
      { ok: true, applied: 1, revisions: [], archives: [{ table: "clients", id: "unexpected", archived: true }] },
      "invalid lifecycle archive receipt",
    ],
    [{ ok: true, applied: 1, revisions: [], archives: [] }, "complete lifecycle archive receipts"],
  ])("rejects malformed teardown lifecycle receipt %#", async (receipt, message) => {
    const initial = withData({ clients: [client("c1")] });
    await expect(saveAgainstReceipt(receipt, { initial, next: emptyAppData(), unload: true })).rejects.toThrow(message);
  });
}

function registerArchiveOutcomeFaultTests(): void {
  it("accepts archived:false as a complete teardown lifecycle receipt", async () => {
    const initial = withData({ clients: [client("c1")] });
    await expect(
      saveAgainstReceipt(
        {
          ok: true,
          applied: 1,
          revisions: [],
          archives: [{ table: "clients", id: "c1", archived: false }],
        },
        { initial, next: emptyAppData(), unload: true },
      ),
    ).resolves.toBeUndefined();
  });

  it("sets keepalive on unload lifecycle archives", async () => {
    const initial = withData({ clients: [client("c1")] });
    const calls: RequestInit[] = [];
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes("/api/state")) return new Response(JSON.stringify(initial), { status: 200 });
      calls.push(init ?? {});
      return new Response(
        JSON.stringify({
          ok: true,
          applied: 1,
          revisions: [],
          archives: [{ table: "clients", id: "c1", archived: true }],
        }),
        { status: 200 },
      );
    });
    const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);
    await adapter.loadAll();
    await adapter.saveAll(emptyAppData(), { unload: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.keepalive).toBe(true);
  });

  it("uses the safe response error for an unrecognised 409 lifecycle archive", async () => {
    const initial = withData({ clients: [client("c1")] });
    const fetchImpl = vi.fn(async (url: string | URL | Request) =>
      String(url).includes("/api/state")
        ? new Response(JSON.stringify(initial), { status: 200 })
        : new Response(JSON.stringify({ code: "protected" }), { status: 409 }),
    );
    const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);
    await adapter.loadAll();
    const failure: unknown = await adapter.saveAll(emptyAppData()).catch((error: unknown): unknown => error);
    expect(failure).toMatchObject({
      message: "Lifecycle archive of clients/c1 failed (409).",
    });
    expect(requiredRecord(failure, "expected lifecycle archive error").cause).toMatchObject({
      message: JSON.stringify({ code: "protected" }),
    });
  });
}

function registerRestoreReceiptFaultTests(): void {
  it.each([
    { label: "non-record", body: null },
    { label: "wrong id", body: { id: "wrong", createdAt: TS1, updatedAt: TS2 } },
    { label: "missing createdAt", body: { id: "c1", updatedAt: TS2 } },
    { label: "missing updatedAt", body: { id: "c1", createdAt: TS1 } },
    { label: "still archived", body: { id: "c1", createdAt: TS1, updatedAt: TS2, archivedAt: TS2 } },
    { label: "still deleted", body: { id: "c1", createdAt: TS1, updatedAt: TS2, deletedAt: TS2 } },
  ])("forces reconciliation for an incomplete lifecycle restore receipt: $label", async ({ body }) => {
    const initial = withData({ clients: [client("c1")] });
    let archived = false;
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/api/state")) return new Response(JSON.stringify(initial), { status: 200 });
      if (target.endsWith("/archive")) {
        archived = true;
        return new Response(null, { status: 200 });
      }
      if (target.endsWith("/unarchive")) return new Response(JSON.stringify(body), { status: 200 });
      return new Response(null, { status: 500 });
    });
    const adapter = new ServerSyncAdapter("http://api.test", fetchImpl as unknown as typeof fetch);
    await adapter.loadAll();
    await adapter.saveAll(emptyAppData());
    expect(archived).toBe(true);
    await expect(adapter.saveAll(initial)).rejects.toBeInstanceOf(LifecycleRestoreError);
  });
}

describe("ServerSyncAdapter fault-injection branches", () => {
  registerStateFaultTests();
  registerOfflineFaultTests();
  registerCommitReceiptFaultTests();
  registerArchiveReceiptFaultTests();
  registerArchiveOutcomeFaultTests();
  registerRestoreReceiptFaultTests();
});
