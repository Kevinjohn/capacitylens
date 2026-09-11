import { describe, expect, it, vi } from "vitest";
import { emptyAppData, type Resource } from "@capacitylens/shared/types/entities";
import { prepareBatchBody } from "./batchWire";
import { SyncState } from "./state";

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
