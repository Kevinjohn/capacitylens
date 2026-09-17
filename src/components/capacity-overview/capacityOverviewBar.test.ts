import { describe, expect, it } from "vitest";
import type { Resource } from "@capacitylens/shared/types/entities";
import {
  buildPeriodTotals,
  computeCapacityCellFill,
  formatDayFigure,
  resolveCapacityTone,
} from "./capacityOverviewBar";
import type { CapacityOverviewGroup, CapacityOverviewPeriodResult } from "./capacityOverviewTypes";

const period = { index: 0, key: "this-week", start: "2026-06-01", end: "2026-06-07", partial: true } as const;

function result(values: Partial<CapacityOverviewPeriodResult>): CapacityOverviewPeriodResult {
  return {
    period,
    companyWorkingHours: 40,
    availableHours: 40,
    allocatedHours: 0,
    freeHours: 40,
    overHours: 0,
    tentativeHours: 0,
    freeDays: 5,
    overDays: 0,
    tentativeDays: 0,
    unassignedDemandHours: 0,
    unassignedDemandDays: 0,
    state: "available",
    ...values,
  };
}

function resource(id: string, kind: Resource["kind"] = "person"): Resource {
  return {
    id,
    accountId: "account",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    kind,
    name: id,
    role: "Designer",
    employmentType: "permanent",
    engagement: "studio",
    workingHoursPerDay: 8,
    workingDays: [1, 2, 3, 4, 5],
    halfDays: [],
    color: "#2563eb",
    isFavourite: false,
  };
}

function group(rows: { id: string; kind?: Resource["kind"]; periods: CapacityOverviewPeriodResult[] }[]) {
  const summary = {
    scope: "all-eligible-people" as const,
    peopleCount: rows.length,
    placeholderCount: 0,
    periods: [],
  };
  return {
    key: "group",
    title: "Group",
    rows: rows.map((row) => ({ resource: resource(row.id, row.kind), periods: row.periods })),
    summary,
  } satisfies CapacityOverviewGroup;
}

describe("resolveCapacityTone", () => {
  it("reads healthy at 80% free, warning at 40% and danger below that", () => {
    expect(resolveCapacityTone(32, 40)).toBe("ok");
    expect(resolveCapacityTone(31, 40)).toBe("warn");
    expect(resolveCapacityTone(16, 40)).toBe("warn");
    expect(resolveCapacityTone(15, 40)).toBe("danger");
  });

  it("scales the thresholds to the person's own capacity, not a five-day week", () => {
    expect(resolveCapacityTone(24, 24)).toBe("ok");
    expect(resolveCapacityTone(8, 16)).toBe("warn");
  });

  it("treats no capacity and nothing free as danger", () => {
    expect(resolveCapacityTone(0, 40)).toBe("danger");
    expect(resolveCapacityTone(0, 0)).toBe("danger");
  });
});

describe("computeCapacityCellFill", () => {
  it("proportions free and tentative time against the person's available hours", () => {
    expect(computeCapacityCellFill({ availableHours: 40, freeHours: 16, tentativeHours: 8 })).toEqual({
      freeFraction: 0.4,
      tentativeFraction: 0.2,
      tone: "warn",
    });
  });

  it("clamps the tentative band so free plus tentative never exceeds the track", () => {
    const clamped = computeCapacityCellFill({ availableHours: 40, freeHours: 32, tentativeHours: 16 });
    expect(clamped.freeFraction).toBe(0.8);
    expect(clamped.tentativeFraction).toBeCloseTo(0.2);
    expect(computeCapacityCellFill({ availableHours: 40, freeHours: 48, tentativeHours: 8 })).toMatchObject({
      freeFraction: 1,
      tentativeFraction: 0,
    });
  });

  it("renders an empty track when the person has no available hours", () => {
    expect(computeCapacityCellFill({ availableHours: 0, freeHours: 0, tentativeHours: 0 })).toEqual({
      freeFraction: 0,
      tentativeFraction: 0,
      tone: "danger",
    });
  });
});

describe("buildPeriodTotals", () => {
  it("sums the visible people per week and rounds committed and tentative shares", () => {
    const totals = buildPeriodTotals(
      [
        group([
          { id: "a", periods: [result({ freeHours: 12, freeDays: 1.5, tentativeHours: 8, tentativeDays: 1 })] },
          { id: "b", periods: [result({ availableHours: 32, freeHours: 32, freeDays: 4 })] },
        ]),
      ],
      1,
    );

    expect(totals).toEqual([
      {
        capacityDays: 9,
        freeDays: 5.5,
        tentativeDays: 1,
        committedDays: 2.5,
        overDays: 0,
        committedPct: 28,
        tentativePct: 11,
        tone: "muted",
      },
    ]);
  });

  it("ignores placeholder rows, which carry demand rather than capacity", () => {
    const totals = buildPeriodTotals(
      [
        group([
          { id: "a", periods: [result({ freeHours: 0, freeDays: 0 })] },
          {
            id: "slot",
            kind: "placeholder",
            periods: [result({ state: "unassigned", freeHours: 0, freeDays: 0, unassignedDemandHours: 16 })],
          },
        ]),
      ],
      1,
    );

    expect(totals[0]).toMatchObject({ capacityDays: 5, committedPct: 100, tone: "danger" });
  });

  it("turns the percentage red once tentative work would push the week to 90%", () => {
    const rows = (freeHours: number, tentativeHours: number) => [
      group([{ id: "a", periods: [result({ freeHours, tentativeHours })] }]),
    ];
    expect(buildPeriodTotals(rows(4, 0), 1)[0]).toMatchObject({ committedPct: 90, tone: "danger" });
    expect(buildPeriodTotals(rows(8, 4), 1)[0]).toMatchObject({ committedPct: 70, tentativePct: 10, tone: "ink" });
    expect(buildPeriodTotals(rows(8, 5), 1)[0]).toMatchObject({ committedPct: 68, tentativePct: 13, tone: "ink" });
    expect(buildPeriodTotals(rows(4, 4), 1)[0]).toMatchObject({ committedPct: 80, tentativePct: 10, tone: "danger" });
    expect(buildPeriodTotals(rows(20, 0), 1)[0]).toMatchObject({ committedPct: 50, tone: "muted" });
  });

  it("keeps a zero-capacity week at 0% rather than dividing by zero", () => {
    const totals = buildPeriodTotals([group([{ id: "a", periods: [result({ availableHours: 0, freeHours: 0 })] }])], 2);
    expect(totals).toHaveLength(2);
    expect(totals[0]).toMatchObject({ capacityDays: 0, committedPct: 0, tentativePct: 0, tone: "muted" });
  });
});

describe("formatDayFigure", () => {
  it("prints integers bare and fractions trimmed", () => {
    expect(formatDayFigure(5)).toBe("5");
    expect(formatDayFigure(1.5)).toBe("1.5");
    expect(formatDayFigure(1.25)).toBe("1.25");
    expect(formatDayFigure(50.5)).toBe("50.5");
  });
});
