import { describe, expect, it } from "vitest";
import type { Allocation, Resource, TimeOff, Weekday } from "@capacitylens/shared/types/entities";
import { weekdayOf } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import { generateRepeatingStartDates } from "@capacitylens/shared/lib/repeatingDates";
import type { Draft } from "../store/useStore";
import {
  projectAllocationDates,
  repeatingAllocationAdvisory as repeatingAllocationAdvisoryWithWeek,
  repeatPatternForSelection,
  type RepeatProjectionContext,
} from "./repeatingAllocations";

const baseDraft = (overrides: Partial<Draft<Allocation>> = {}): Draft<Allocation> => ({
  resourceId: "r1",
  activityId: "activity",
  startDate: "2027-01-31",
  endDate: "2027-02-02",
  hoursPerDay: 8,
  status: "confirmed",
  note: "Keep me",
  ignoreWeekends: false,
  ...overrides,
});

type TestRepeatResource = RepeatProjectionContext["resource"] & { workingDays: Weekday[] };

const resourceContext = (overrides: Partial<TestRepeatResource> = {}): TestRepeatResource => ({
  id: "r1",
  kind: "person",
  workingDays: [1, 2, 3, 4, 5],
  ...overrides,
});

const repeatContext = (
  schedulingMode: RepeatProjectionContext["schedulingMode"],
  daysOver: number,
  resource = resourceContext(),
  accountWorkingDays: Weekday[] = [1, 2, 3, 4, 5],
): RepeatProjectionContext => ({
  schedulingMode,
  daysOver,
  resource,
  effectiveWeek: effectiveWorkingWeek(resource, accountWorkingDays),
});

describe("#257 characterization: repeat start-day policy", () => {
  // PERMANENT invariants: monthly off-day starts are created, while weekly cadences retain their anchor weekday.
  it("projects monthly occurrences even when generated starts are personally non-working", () => {
    const startDates = generateRepeatingStartDates("2026-06-01", "2026-08-01", {
      kind: "monthly-date",
    }).startDates;
    const projected = projectAllocationDates(
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-01" }),
      startDates,
      repeatContext("days", 1, resourceContext({ workingDays: [1] })),
    );

    expect(startDates.map(weekdayOf)).toEqual([1, 3, 6]);
    expect(projected.map(({ startDate, endDate }) => [startDate, endDate])).toEqual([
      ["2026-06-01", "2026-06-01"],
      ["2026-07-01", "2026-07-06"],
      ["2026-08-01", "2026-08-03"],
    ]);
  });

  it("preserves the weekly anchor weekday across the generated batch", () => {
    const startDates = generateRepeatingStartDates(
      "2026-06-01",
      "2026-07-27",
      repeatPatternForSelection("weekly"),
    ).startDates;

    expect(startDates).toHaveLength(9);
    expect(new Set(startDates.map(weekdayOf))).toEqual(new Set([1]));
  });
});

describe("repeatPatternForSelection", () => {
  it("maps every repeating form choice exhaustively", () => {
    expect([
      repeatPatternForSelection("weekly"),
      repeatPatternForSelection("every-two-weeks"),
      repeatPatternForSelection("every-three-weeks"),
      repeatPatternForSelection("every-four-weeks"),
      repeatPatternForSelection("monthly"),
    ]).toEqual([
      { kind: "weeks", interval: 1 },
      { kind: "weeks", interval: 2 },
      { kind: "weeks", interval: 3 },
      { kind: "weeks", interval: 4 },
      { kind: "monthly-date" },
    ]);
  });
});

describe("projectAllocationDates", () => {
  it("retains the exact first draft and copies all fields while changing only an hourly calendar span", () => {
    const base = baseDraft();
    const projected = projectAllocationDates(
      base,
      ["2027-01-31", "2027-02-28", "2027-03-31"],
      repeatContext("hourly", 99),
    );
    expect(projected[0]).toBe(base);
    expect(projected[1]).toEqual({ ...base, startDate: "2027-02-28", endDate: "2027-03-02" });
    expect(projected[2]).toEqual({ ...base, startDate: "2027-03-31", endDate: "2027-04-02" });
  });

  it("checks External first and preserves its validated zero-load literal span in every account mode", () => {
    const base = baseDraft({ hoursPerDay: 0, ignoreWeekends: true });
    for (const schedulingMode of ["hourly", "days", "blocks"] as const) {
      const projected = projectAllocationDates(
        base,
        ["2027-01-31", "2027-02-28"],
        repeatContext(schedulingMode, 0, resourceContext({ kind: "external", workingDays: [] })),
      );
      expect(projected[1]).toMatchObject({
        startDate: "2027-02-28",
        endDate: "2027-03-02",
        hoursPerDay: 0,
        ignoreWeekends: true,
      });
    }
  });

  it.each(["days", "blocks"] as const)("projects %s with the effective working span and preserves load", (mode) => {
    const base = baseDraft({ startDate: "2026-06-01", endDate: "2026-06-03", hoursPerDay: mode === "blocks" ? 0 : 6 });
    const projected = projectAllocationDates(base, ["2026-06-01", "2026-06-06"], repeatContext(mode, 3));
    expect(projected[1]).toMatchObject({
      startDate: "2026-06-06",
      endDate: "2026-06-10",
      hoursPerDay: base.hoursPerDay,
    });
  });

  it.each(["days", "blocks"] as const)(
    "rejects %s repeats when a later occurrence cannot fit the complete working span",
    (mode) => {
      const base = baseDraft({
        startDate: "9999-09-30",
        endDate: "9999-10-02",
        hoursPerDay: mode === "blocks" ? 0 : 8,
        ignoreWeekends: true,
      });
      expect(() =>
        projectAllocationDates(base, ["9999-09-30", "9999-10-30", "9999-11-30", "9999-12-30"], repeatContext(mode, 3)),
      ).toThrow(/supported date range/i);
    },
  );

  it("honours custom work weeks and Ignore working days without moving the generated start", () => {
    const custom = projectAllocationDates(
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-04" }),
      ["2026-06-01", "2026-06-03"],
      repeatContext("days", 2, resourceContext({ workingDays: [2, 4] })),
    );
    expect(custom[1]).toMatchObject({ startDate: "2026-06-03", endDate: "2026-06-09" });

    const weekends = projectAllocationDates(
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-03", ignoreWeekends: true }),
      ["2026-06-01", "2026-06-06"],
      repeatContext("days", 3),
    );
    expect(weekends[1]).toMatchObject({ startDate: "2026-06-06", endDate: "2026-06-08" });
  });

  it("rejects a mismatched resource, a missing anchor and invalid working-span context", () => {
    expect(() =>
      projectAllocationDates(
        baseDraft(),
        ["2027-01-31", "2027-02-28"],
        repeatContext("hourly", 1, resourceContext({ id: "other" })),
      ),
    ).toThrow(/does not match/i);
    expect(() => projectAllocationDates(baseDraft(), ["2027-02-28"], repeatContext("hourly", 1))).toThrow(/begin/i);
    expect(() => projectAllocationDates(baseDraft(), ["2027-01-31", "2027-02-28"], repeatContext("blocks", 0))).toThrow(
      /daysOver/i,
    );
  });

  it.each([
    ["weekly", ["2026-06-01", "2026-06-08"], "2026-06-15"],
    ["monthly", ["2026-06-01", "2026-07-01"], "2026-07-08"],
  ] as const)("projects %s working spans through the narrowed company week", (_, startDates, expectedEnd) => {
    const resource = resourceContext();
    const projected = projectAllocationDates(
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-08" }),
      startDates,
      repeatContext("days", 5, resource, [1, 2, 3, 4]),
    );

    expect(projected[1]).toMatchObject({ startDate: startDates[1], endDate: expectedEnd });
  });

  it("rejects a working-span repeat before empty effective days can reach date math", () => {
    const resource = resourceContext({ workingDays: [1] });
    expect(() =>
      projectAllocationDates(
        baseDraft({ startDate: "2026-06-01", endDate: "2026-06-01" }),
        ["2026-06-01", "2026-06-08"],
        repeatContext("days", 1, resource, [2]),
      ),
    ).toThrow(/effective working day/i);

    expect(
      projectAllocationDates(
        baseDraft({
          startDate: "2026-06-01",
          endDate: "2026-06-02",
          ignoreWeekends: true,
        }),
        ["2026-06-01", "2026-06-08"],
        repeatContext("days", 2, resource, [2]),
      )[1],
    ).toMatchObject({ startDate: "2026-06-08", endDate: "2026-06-09", ignoreWeekends: true });
  });
});

const fullResource = (overrides: Partial<Resource> = {}): Resource => ({
  id: "r1",
  accountId: "a1",
  createdAt: "t",
  updatedAt: "t",
  kind: "person",
  name: "Person",
  role: "Designer",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#111111",
  ...overrides,
});

const repeatingAllocationAdvisory = (
  resource: Resource,
  existingLoad: readonly Draft<Allocation>[],
  timeOff: TimeOff[],
  proposedDrafts: readonly Draft<Allocation>[],
) =>
  repeatingAllocationAdvisoryWithWeek(
    resource,
    existingLoad,
    timeOff,
    proposedDrafts,
    effectiveWorkingWeek(resource, [1, 2, 3, 4, 5]),
  );

describe("repeatingAllocationAdvisory", () => {
  it("accepts transient drafts and counts existing-load plus internal generated conflicts", () => {
    const drafts = [
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-10", hoursPerDay: 5 }),
      baseDraft({ startDate: "2026-06-08", endDate: "2026-06-12", hoursPerDay: 5 }),
    ];
    const existing: Draft<Allocation>[] = [
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-01", hoursPerDay: 4 }),
    ];
    expect(repeatingAllocationAdvisory(fullResource(), existing, [], drafts)).toEqual({
      overCapacityAllocations: 2,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });

  it("attributes existing load to the drafts whose window it actually covers", () => {
    // The batch shares ONE day→hours bucket across every draft, so existing load has to stay
    // pinned to its own dates: an allocation sitting only in the LAST draft's week must not make
    // the first draft read as over, and vice versa.
    const drafts = [
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-01", hoursPerDay: 5 }),
      baseDraft({ startDate: "2026-06-15", endDate: "2026-06-15", hoursPerDay: 5 }),
    ];
    const lateOnly: Draft<Allocation>[] = [
      baseDraft({ startDate: "2026-06-15", endDate: "2026-06-15", hoursPerDay: 4 }),
    ];
    expect(repeatingAllocationAdvisory(fullResource(), lateOnly, [], drafts)).toEqual({
      overCapacityAllocations: 1,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
    // Same load, no draft covering its day: nothing is over.
    expect(repeatingAllocationAdvisory(fullResource(), lateOnly, [], [drafts[0]!])).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });

  it("does not double-count existing load across the drafts of one batch", () => {
    // Each draft is advised against the existing load ONCE (plus the drafts before it). A bucket
    // that re-added the same allocation per draft would push the later occurrences over.
    const drafts = [
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-01", hoursPerDay: 4 }),
      baseDraft({ startDate: "2026-06-02", endDate: "2026-06-02", hoursPerDay: 4 }),
      baseDraft({ startDate: "2026-06-03", endDate: "2026-06-03", hoursPerDay: 4 }),
    ];
    const existing: Draft<Allocation>[] = [
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-05", hoursPerDay: 4 }),
    ];
    expect(repeatingAllocationAdvisory(fullResource(), existing, [], drafts)).toEqual({
      overCapacityAllocations: 0, // 4 + 4 fits exactly in an 8h day, on every occurrence
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });

  it("counts allocations overlapping time off once and keeps categories independent", () => {
    const timeOff: TimeOff[] = [
      {
        id: "to1",
        accountId: "a1",
        createdAt: "t",
        updatedAt: "t",
        resourceId: "r1",
        startDate: "2026-06-02",
        endDate: "2026-06-09",
        type: "holiday",
      },
    ];
    const drafts = [
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-03", hoursPerDay: 8 }),
      baseDraft({ startDate: "2026-06-08", endDate: "2026-06-10", hoursPerDay: 8 }),
    ];
    expect(repeatingAllocationAdvisory(fullResource(), [], timeOff, drafts)).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 2,
      nonEffectiveStartAllocations: 0,
    });
  });

  it("uses the fixed four-hour half-day boundary for every repeated occurrence", () => {
    const resource = fullResource({ halfDays: [2] });
    const exactCapacity = baseDraft({ startDate: "2026-06-02", endDate: "2026-06-02", hoursPerDay: 4 });
    const overCapacity = baseDraft({ startDate: "2026-06-09", endDate: "2026-06-09", hoursPerDay: 5 });

    expect(repeatingAllocationAdvisory(resource, [], [], [exactCapacity])).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
    expect(repeatingAllocationAdvisory(resource, [], [], [overCapacity])).toEqual({
      overCapacityAllocations: 1,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });

  it("keeps zero-load Blocks clean on half days and skips External resources", () => {
    const zeroDraft = baseDraft({ hoursPerDay: 0 });
    expect(repeatingAllocationAdvisory(fullResource({ halfDays: [1] }), [], [], [zeroDraft])).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 1,
    });
    expect(repeatingAllocationAdvisory(fullResource({ kind: "external" }), [], [], [zeroDraft])).toEqual({
      overCapacityAllocations: 0,
      timeOffAllocations: 0,
      nonEffectiveStartAllocations: 0,
    });
  });

  it("counts monthly starts outside the effective week, including draft 0, but excludes ignored occurrences", () => {
    const resource = fullResource({ workingDays: [1] });
    const drafts = [
      baseDraft({ startDate: "2026-06-01", endDate: "2026-06-01" }), // Monday
      baseDraft({ startDate: "2026-07-01", endDate: "2026-07-06" }), // Wednesday
      baseDraft({ startDate: "2026-08-01", endDate: "2026-08-03" }), // Saturday
      baseDraft({ startDate: "2026-09-01", endDate: "2026-09-01", ignoreWeekends: true }),
    ];

    expect(repeatingAllocationAdvisory(resource, [], [], drafts)).toMatchObject({
      nonEffectiveStartAllocations: 2,
    });
  });

  it("reports zero non-effective starts for a weekly cadence anchored on an effective weekday", () => {
    const resource = fullResource({ workingDays: [1] });
    const starts = generateRepeatingStartDates(
      "2026-06-01",
      "2026-06-29",
      repeatPatternForSelection("weekly"),
    ).startDates;
    const drafts = starts.map((startDate) => baseDraft({ startDate, endDate: startDate }));

    expect(repeatingAllocationAdvisory(resource, [], [], drafts)).toMatchObject({
      nonEffectiveStartAllocations: 0,
    });
  });
});
