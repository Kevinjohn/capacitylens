import { describe, expect, it } from "vitest";
import { emptyAppData, type Allocation, type AppData } from "@capacitylens/shared/types/entities";
import { clearAllocationAttributionForActivities, insertAll, loadState, openDb, upsertRow } from "./db";
import { validateWrite } from "./validate";

const TS = "2026-01-01T00:00:00.000Z";
const meta = { accountId: "a1", createdAt: TS, updatedAt: TS };

function state(): AppData {
  return {
    ...emptyAppData(),
    accounts: [{ id: "a1", name: "Wayne Enterprises", color: "#111111", createdAt: TS, updatedAt: TS }],
    clients: [{ ...meta, id: "c1", name: "Client", color: "#111111" }],
    projects: [
      { ...meta, id: "p1", name: "One", clientId: "c1", color: "#111111" },
      { ...meta, id: "p2", name: "Two", clientId: "c1", color: "#222222" },
    ],
    resources: [
      {
        ...meta,
        id: "person",
        kind: "person",
        name: "Bruce Wayne",
        role: "Designer",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#111111",
      },
      {
        ...meta,
        id: "placeholder",
        kind: "placeholder",
        role: "Designer",
        projectId: "p1",
        employmentType: "permanent",
        engagement: "studio",
        workingHoursPerDay: 8,
        workingDays: [1, 2, 3, 4, 5],
        halfDays: [],
        color: "#111111",
      },
    ],
    activities: [
      { ...meta, id: "repeatable", name: "Shared", kind: "repeatable" },
      { ...meta, id: "internal", name: "Admin", kind: "internal" },
    ],
  };
}

function allocation(overrides: Partial<Allocation> = {}): Allocation {
  return {
    ...meta,
    id: "allocation",
    resourceId: "person",
    activityId: "repeatable",
    projectId: "p1",
    startDate: "2026-01-01",
    endDate: "2026-01-01",
    hoursPerDay: 8,
    status: "confirmed",
    ...overrides,
  };
}

describe("server allocation project attribution", () => {
  it("enforces activity kind, project existence and placeholder scope", () => {
    const data = state();
    expect(() => validateWrite(data, "allocations", allocation() as unknown as Record<string, unknown>)).not.toThrow();
    expect(() =>
      validateWrite(data, "allocations", allocation({ activityId: "internal" }) as unknown as Record<string, unknown>),
    ).toThrow(/only an all-projects activity/i);
    expect(() =>
      validateWrite(data, "allocations", allocation({ projectId: "missing" }) as unknown as Record<string, unknown>),
    ).toThrow(/active project/i);
    expect(() =>
      validateWrite(
        data,
        "allocations",
        allocation({ resourceId: "placeholder", projectId: "p2" }) as unknown as Record<string, unknown>,
      ),
    ).toThrow(/bound project/i);
  });

  it("clears stored attribution only through the explicit activity sweep", () => {
    const data = state();
    data.allocations = [allocation()];
    const db = openDb(":memory:");
    insertAll(db, data);

    upsertRow(db, "activities", { ...data.activities[0], kind: "internal", updatedAt: "2026-01-02T00:00:00.000Z" });
    expect(loadState(db).allocations[0]).toHaveProperty("projectId", "p1");
    clearAllocationAttributionForActivities(db, new Set([data.activities[0]!.id]));
    expect(loadState(db).allocations[0]).not.toHaveProperty("projectId");
    expect(Date.parse(loadState(db).allocations[0]!.updatedAt)).toBeGreaterThan(Date.parse(TS));
    db.close();
  });
});
