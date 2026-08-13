import { describe, expect, it } from "vitest";
import { effectiveWorkingDays, isAllocationMoveStartBlocked, isCreationStartBlocked } from "./creationAvailability";
import type { Resource, TimeOff } from "@capacitylens/shared/types/entities";

const person: Resource = {
  id: "r1",
  accountId: "a1",
  kind: "person",
  name: "Bruce Wayne",
  role: "Designer",
  employmentType: "permanent",
  engagement: "studio",
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#2d75da",
  createdAt: "t",
  updatedAt: "t",
};

const holiday: TimeOff = {
  id: "to1",
  accountId: "a1",
  resourceId: "r1",
  startDate: "2026-06-03",
  endDate: "2026-06-04",
  type: "holiday",
  createdAt: "t",
  updatedAt: "t",
};

describe("creation start availability", () => {
  it("intersects the company and personal calendars for allocation gestures", () => {
    expect(effectiveWorkingDays({ ...person, workingDays: [1, 2, 4, 5] }, [1, 2, 3, 4])).toEqual([1, 2, 4]);
  });

  it("rejects either recurring closure on move unless the allocation ignores working days", () => {
    const personalTuesdayThursday = { ...person, workingDays: [2, 4] as Resource["workingDays"] };

    expect(isAllocationMoveStartBlocked(personalTuesdayThursday, "2026-06-01", [1, 2, 3, 4, 5], false)).toBe(true);
    expect(isAllocationMoveStartBlocked(personalTuesdayThursday, "2026-06-04", [1, 2, 3], false)).toBe(true);
    expect(isAllocationMoveStartBlocked(personalTuesdayThursday, "2026-06-04", [1, 2, 3], true)).toBe(false);
  });

  it("blocks global non-working, personal non-working and time-off dates", () => {
    expect(isCreationStartBlocked(person, "2026-06-01", [], [2, 3, 4, 5])).toBe(true);
    expect(isCreationStartBlocked(person, "2026-06-06", [], [0, 1, 2, 3, 4, 5, 6])).toBe(true);
    expect(isCreationStartBlocked(person, "2026-06-03", [holiday], [1, 2, 3, 4, 5])).toBe(true);
    expect(isCreationStartBlocked(person, "2026-06-02", [holiday], [1, 2, 3, 4, 5])).toBe(false);
  });

  it("applies the account boundary to externals without inventing personal capacity", () => {
    const external: Resource = { ...person, kind: "external", workingDays: [] };
    expect(effectiveWorkingDays(external, [2, 3, 4, 5])).toEqual([2, 3, 4, 5]);
    expect(isCreationStartBlocked(external, "2026-06-01", [], [2, 3, 4, 5])).toBe(true);
    expect(isCreationStartBlocked(external, "2026-06-01", [], [1, 2, 3, 4, 5])).toBe(false);
  });
});
