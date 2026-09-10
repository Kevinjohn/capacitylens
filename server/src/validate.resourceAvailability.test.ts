import { describe, expect, it } from "vitest";
import { getRow, openDb, upsertRow } from "./db";
import { assertValidWrite, sanitizeWrite } from "./validate";
import type { AppData, Weekday } from "@capacitylens/shared/types/entities";

const TS = "2026-01-01T00:00:00.000Z";
const account = {
  id: "a1",
  name: "Wayne Enterprises",
  color: "#3b82f6",
  createdAt: TS,
  updatedAt: TS,
};
const resource = {
  id: "r1",
  accountId: "a1",
  kind: "person" as const,
  name: "Bruce Wayne",
  role: "Designer",
  employmentType: "permanent" as const,
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5] as Weekday[],
  halfDays: [] as Weekday[],
  color: "#3b82f6",
  firstAvailableDate: "2026-02-01",
  lastAvailableDate: "2026-02-28",
  createdAt: TS,
  updatedAt: TS,
};

describe("resource availability write sanitisation", () => {
  registerClearTests();
  registerNonPersonTests();
  registerIntersectionTests();
});

function registerClearTests(): void {
  it("uses null independently in full-row PUTs and persists each clear across reload", () => {
    const db = openDb(":memory:");
    try {
      upsertRow(db, "accounts", account);
      const clearFirst = sanitizeWrite({
        table: "resources",
        row: { ...resource, firstAvailableDate: null },
        existing: resource,
      });

      expect(clearFirst).not.toHaveProperty("firstAvailableDate");
      expect(clearFirst.lastAvailableDate).toBe(resource.lastAvailableDate);
      upsertRow(db, "resources", clearFirst);
      const afterFirst = getRow(db, "resources", resource.id);
      expect(afterFirst).not.toHaveProperty("firstAvailableDate");
      expect(afterFirst?.lastAvailableDate).toBe(resource.lastAvailableDate);

      const clearLast = sanitizeWrite({
        table: "resources",
        row: { ...afterFirst, lastAvailableDate: null },
        existing: afterFirst ?? undefined,
      });
      expect(clearLast).not.toHaveProperty("firstAvailableDate");
      expect(clearLast).not.toHaveProperty("lastAvailableDate");
      upsertRow(db, "resources", clearLast);
      const afterLast = getRow(db, "resources", resource.id);
      expect(afterLast).not.toHaveProperty("firstAvailableDate");
      expect(afterLast).not.toHaveProperty("lastAvailableDate");
    } finally {
      db.close();
    }
  });
}

function registerNonPersonTests(): void {
  it("strips stale boundaries when a person is changed to a non-person through a direct write", () => {
    const cleaned = sanitizeWrite({
      table: "resources",
      row: {
        ...resource,
        kind: "external",
        firstAvailableDate: resource.firstAvailableDate,
        lastAvailableDate: resource.lastAvailableDate,
      },
      existing: resource,
    });

    expect(cleaned.kind).toBe("external");
    expect(cleaned).not.toHaveProperty("firstAvailableDate");
    expect(cleaned).not.toHaveProperty("lastAvailableDate");
  });
}

function registerIntersectionTests(): void {
  it("uses the company/person intersection for server allocation validation", () => {
    const state: AppData = {
      accounts: [{ ...account, workingDays: [2, 3, 4, 5, 6] as Weekday[] }],
      disciplines: [],
      resources: [resource],
      clients: [],
      projects: [],
      phases: [],
      activities: [
        {
          id: "activity-1",
          accountId: "a1",
          name: "Admin",
          kind: "internal" as const,
          createdAt: TS,
          updatedAt: TS,
        },
      ],
      allocations: [],
      timeOff: [],
      closures: [],
    };

    expect(() =>
      assertValidWrite({
        state,
        table: "allocations",
        row: {
          id: "allocation-1",
          accountId: "a1",
          resourceId: "r1",
          activityId: "activity-1",
          startDate: "2026-01-26",
          endDate: "2026-01-26",
          hoursPerDay: 8,
          status: "confirmed",
          createdAt: TS,
          updatedAt: TS,
        },
      }),
    ).not.toThrow();
  });
}
