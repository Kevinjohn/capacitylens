import { describe, expect, it } from "vitest";
import {
  creationBlockedAt,
  effectiveWorkingDays,
  isAllocationMoveStartBlocked,
  isCreationStartBlocked,
} from "./creationAvailability";
import type { Resource } from "@capacitylens/shared/types/entities";
import { makeResource, makeTimeOff } from "../../test/fixtures";

const person = makeResource({ name: "Bruce Wayne" });

const holiday = makeTimeOff({ startDate: "2026-06-03", endDate: "2026-06-04" });

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
    // An external carries no time off of its own: a stray record must not gate its lane.
    expect(isCreationStartBlocked({ ...external, id: "r1" }, "2026-06-03", [holiday], [1, 2, 3, 4, 5])).toBe(false);
  });

  it("names which rule blocked the start, and scopes time off to the resource asked about", () => {
    expect(creationBlockedAt(person, "2026-06-01", [], [2, 3, 4, 5])).toBe("non-working");
    expect(creationBlockedAt(person, "2026-06-03", [holiday], [1, 2, 3, 4, 5])).toBe("time-off");
    expect(creationBlockedAt(person, "2026-06-02", [holiday], [1, 2, 3, 4, 5])).toBe(null);
    // Another person's time off is ignored, so callers need not pre-filter the list.
    expect(creationBlockedAt(person, "2026-06-03", [{ ...holiday, resourceId: "r2" }], [1, 2, 3, 4, 5])).toBe(null);
    // The per-allocation override bypasses the calendars ONLY — time off passed in still blocks.
    expect(creationBlockedAt(person, "2026-06-03", [holiday], [1, 2, 3, 4, 5], true)).toBe("time-off");
  });
});

describe("#257 characterization: creation and move gate boundaries", () => {
  // PERMANENT invariants: creation never accepts the override, and the override never bypasses time off.
  it("keeps a creation start blocked where the existing-allocation move override is allowed", () => {
    const companyMondayToThursday = [1, 2, 3, 4] as Resource["workingDays"];

    expect(creationBlockedAt(person, "2026-06-05", [], companyMondayToThursday, true)).toBe(null);
    expect(isCreationStartBlocked(person, "2026-06-05", [], companyMondayToThursday)).toBe(true);
  });

  it("returns time-off when the override bypasses both recurring calendars", () => {
    const fridayHoliday = makeTimeOff({ startDate: "2026-06-05", endDate: "2026-06-05" });

    expect(creationBlockedAt(person, "2026-06-05", [fridayHoliday], [1, 2, 3, 4], true)).toBe("time-off");
  });
});
