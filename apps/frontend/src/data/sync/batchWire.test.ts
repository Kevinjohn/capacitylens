import { describe, expect, it, vi } from "vitest";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { Resource } from "@capacitylens/shared/types/entities";
import { sendBatch, prepareBatchBody } from "./batchWire";
import type { BatchCommitUncertainError } from "./batchErrors";
import { SyncState } from "./SyncState";

const resource = (overrides: Partial<Resource> = {}): Resource => ({
  id: "r1",
  accountId: "a1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  kind: "person",
  name: "Lois Lane",
  role: "Reporter",
  employmentType: "permanent",
  engagement: "studio",
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#737373",
  ...overrides,
});

describe("prepareBatchBody resource availability clears", () => {
  it("emits a null during overlapping teardown when an in-flight new row added then cleared a boundary", () => {
    const state = new SyncState("http://example.test", vi.fn() as unknown as typeof fetch);
    const inFlight = resource({ firstAvailableDate: "2026-01-01" });
    state.lastSynced = emptyAppData();
    state.dispatchedTarget = { ...emptyAppData(), resources: [inFlight] };
    const newest = { ...inFlight, updatedAt: "2026-01-03T00:00:00.000Z" };
    delete newest.firstAvailableDate;

    const body = JSON.parse(
      prepareBatchBody(state, [{ method: "PUT", table: "resources", id: newest.id, row: newest }], {
        keepalive: true,
      }),
    ) as { ops: Array<{ row: Record<string, unknown> }> };

    expect(body.ops[0]?.row.firstAvailableDate).toBeNull();
  });

  it("serializes independent deleted optional boundaries as explicit null markers", () => {
    const state = new SyncState("http://example.test", vi.fn() as unknown as typeof fetch);
    const previous = resource({ firstAvailableDate: "2026-01-01", lastAvailableDate: "2026-12-31" });
    state.lastSynced = { ...emptyAppData(), resources: [previous] };
    const next = { ...previous };
    delete next.firstAvailableDate;

    const body = JSON.parse(
      prepareBatchBody(state, [{ method: "PUT", table: "resources", id: previous.id, row: next }]),
    ) as { ops: Array<{ row: Record<string, unknown> }> };

    expect(body.ops[0]?.row).toMatchObject({ firstAvailableDate: null, lastAvailableDate: "2026-12-31" });
  });

  it("serializes an independently deleted last boundary without clearing the first", () => {
    const state = new SyncState("http://example.test", vi.fn() as unknown as typeof fetch);
    const previous = resource({ firstAvailableDate: "2026-01-01", lastAvailableDate: "2026-12-31" });
    state.lastSynced = { ...emptyAppData(), resources: [previous] };
    const next = { ...previous };
    delete next.lastAvailableDate;

    const body = JSON.parse(
      prepareBatchBody(state, [{ method: "PUT", table: "resources", id: previous.id, row: next }]),
    ) as { ops: Array<{ row: Record<string, unknown> }> };

    expect(body.ops[0]?.row).toMatchObject({ firstAvailableDate: "2026-01-01", lastAvailableDate: null });
  });
});

describe("sendBatch native API client", () => {
  it("normalizes the native request to the injected fetch URL and request options", async () => {
    document.cookie = "XSRF-TOKEN=csrf%20value; path=/";
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true, applied: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const state = new SyncState("http://example.test", fetchImpl);
    const body = '{"ops":[]}';

    await sendBatch({ state, body, sequence: 7, options: { keepalive: true } });

    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const [url, init] = call;
    expect(url).toBe("http://example.test/api/batch");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(body);
    expect(init?.credentials).toBe("include");
    expect(init?.keepalive).toBe(true);
    const headers = new Headers(init?.headers);
    expect(headers.get("X-CapacityLens-Sync-Session")).toBe(state.syncSessionId);
    expect(headers.get("X-CapacityLens-Sync-Sequence")).toBe("7");
    expect(headers.get("X-XSRF-TOKEN")).toBe("csrf value");
    document.cookie = "XSRF-TOKEN=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("dispatches the exact prepared body once with ordering headers and automatic XSRF", async () => {
    document.cookie = "XSRF-TOKEN=csrf%20value; path=/";
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ ok: true, applied: 0 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const state = new SyncState("http://example.test", fetchImpl);
    const body = '{"ops":[]}';

    const response = await sendBatch({ state, body, sequence: 7 });

    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const [input, init] = call;
    expect(input instanceof Request ? input.url : String(input)).toBe("http://example.test/api/batch");
    expect(input instanceof Request ? input.method : init?.method).toBe("POST");
    expect(init?.body).toBe(body);
    expect(input instanceof Request ? input.credentials : init?.credentials).toBe("include");
    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
    expect(headers.get("X-CapacityLens-Sync-Session")).toBe(state.syncSessionId);
    expect(headers.get("X-CapacityLens-Sync-Sequence")).toBe("7");
    expect(headers.get("X-XSRF-TOKEN")).toBe("csrf value");
    document.cookie = "XSRF-TOKEN=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
  });

  it("does not retry a lost connection and preserves uncertain-commit classification", async () => {
    const networkFailure = new TypeError("offline");
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw networkFailure;
    });
    const state = new SyncState("http://example.test", fetchImpl);

    await expect(sendBatch({ state, body: '{"ops":[]}', sequence: 1 })).rejects.toMatchObject({
      name: "BatchCommitUncertainError",
      cause: networkFailure,
    } satisfies Partial<BatchCommitUncertainError>);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("preserves a non-transport fetch error instead of exposing a client wrapper", async () => {
    const failure = new Error("lifecycle keepalive dropped");
    const state = new SyncState(
      "http://example.test",
      vi.fn(async () => {
        throw failure;
      }),
    );

    await expect(sendBatch({ state, body: '{"ops":[]}', sequence: 1, options: { keepalive: true } })).rejects.toBe(
      failure,
    );
  });

  it("returns the original non-2xx response for the existing status classifier", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response('{"error":"stale","current":{"id":"a1"}}', {
          status: 409,
          headers: { "Content-Type": "application/json" },
        }),
    );
    const state = new SyncState("http://example.test", fetchImpl);

    const response = await sendBatch({ state, body: '{"ops":[]}', sequence: 1 });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "stale", current: { id: "a1" } });
  });

  it("keeps teardown keepalive enabled without adding a client deadline", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response("{}", { status: 200 }));
    const state = new SyncState("http://example.test", fetchImpl);

    await sendBatch({ state, body: '{"ops":[]}', sequence: 2, options: { keepalive: true } });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) return;
    const [url, init] = call;
    expect(url).toBe("http://example.test/api/batch");
    expect(init?.keepalive).toBe(true);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.signal?.aborted).toBe(false);
  });
});
