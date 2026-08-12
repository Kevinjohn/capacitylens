import { describe, expect, it } from "vitest";
import { isCreationStartBlocked } from "./creationAvailability";
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
  it("blocks global non-working, personal non-working and time-off dates", () => {
    expect(isCreationStartBlocked(person, "2026-06-01", [], [2, 3, 4, 5])).toBe(true);
    expect(isCreationStartBlocked(person, "2026-06-06", [], [0, 1, 2, 3, 4, 5, 6])).toBe(true);
    expect(isCreationStartBlocked(person, "2026-06-03", [holiday], [1, 2, 3, 4, 5])).toBe(true);
    expect(isCreationStartBlocked(person, "2026-06-02", [holiday], [1, 2, 3, 4, 5])).toBe(false);
  });

  it("applies the account boundary to externals without inventing personal capacity", () => {
    const external: Resource = { ...person, kind: "external", workingDays: [] };
    expect(isCreationStartBlocked(external, "2026-06-01", [], [2, 3, 4, 5])).toBe(true);
    expect(isCreationStartBlocked(external, "2026-06-01", [], [1, 2, 3, 4, 5])).toBe(false);
  });
});
