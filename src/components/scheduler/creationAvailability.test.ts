import { describe, expect, it } from "vitest";
import {
  resolveCreationBlockReason,
  resolveEffectiveWorkingDays,
  isAllocationMoveStartBlocked,
  isCreationStartBlocked,
} from "./creationAvailability";
import type { Closure, Resource } from "@capacitylens/shared/types/entities";
import { makeResource, makeTimeOff } from "../../test/fixtures";

const person = makeResource({ name: "Bruce Wayne" });

const holiday = makeTimeOff({ startDate: "2026-06-03", endDate: "2026-06-04" });
const companyClosure: Closure = {
  id: "closure",
  accountId: "a1",
  createdAt: "t",
  updatedAt: "t",
  name: "Company shutdown",
  startDate: "2026-06-03",
  endDate: "2026-06-04",
};

describe("creation start availability", () => {
  it("intersects the company and personal calendars for allocation gestures", () => {
    expect(resolveEffectiveWorkingDays({ ...person, workingDays: [1, 2, 4, 5] }, [1, 2, 3, 4])).toEqual([1, 2, 4]);
  });

  it("rejects either recurring closure on move unless the allocation ignores working days", () => {
    const personalTuesdayThursday = { ...person, workingDays: [2, 4] as Resource["workingDays"] };

    expect(
      isAllocationMoveStartBlocked({
        resource: personalTuesdayThursday,
        date: "2026-06-01",
        accountWorkingDays: [1, 2, 3, 4, 5],
        ignoreWorkingDays: false,
      }),
    ).toBe(true);
    expect(
      isAllocationMoveStartBlocked({
        resource: personalTuesdayThursday,
        date: "2026-06-04",
        accountWorkingDays: [1, 2, 3],
        ignoreWorkingDays: false,
      }),
    ).toBe(true);
    expect(
      isAllocationMoveStartBlocked({
        resource: personalTuesdayThursday,
        date: "2026-06-04",
        accountWorkingDays: [1, 2, 3],
        ignoreWorkingDays: true,
      }),
    ).toBe(false);
  });
  registerCalendarAvailabilityTests();
  registerExternalAvailabilityTests();
  registerBlockReasonTests();
  registerReasonPrecedenceTests();
});

function registerCalendarAvailabilityTests() {
  it("blocks global non-working, personal non-working and time-off dates", () => {
    expect(
      isCreationStartBlocked({
        resource: person,
        date: "2026-06-01",
        timeOff: [],
        accountWorkingDays: [2, 3, 4, 5],
        closures: [],
      }),
    ).toBe(true);
    expect(
      isCreationStartBlocked({
        resource: person,
        date: "2026-06-06",
        timeOff: [],
        accountWorkingDays: [0, 1, 2, 3, 4, 5, 6],
        closures: [],
      }),
    ).toBe(true);
    expect(
      isCreationStartBlocked({
        resource: person,
        date: "2026-06-03",
        timeOff: [holiday],
        accountWorkingDays: [1, 2, 3, 4, 5],
        closures: [],
      }),
    ).toBe(true);
    expect(
      isCreationStartBlocked({
        resource: person,
        date: "2026-06-02",
        timeOff: [holiday],
        accountWorkingDays: [1, 2, 3, 4, 5],
        closures: [],
      }),
    ).toBe(false);
  });
}

function registerExternalAvailabilityTests() {
  it("applies the account boundary to externals without inventing personal capacity", () => {
    const external: Resource = { ...person, kind: "external", workingDays: [] };
    expect(resolveEffectiveWorkingDays(external, [2, 3, 4, 5])).toEqual([2, 3, 4, 5]);
    expect(
      isCreationStartBlocked({
        resource: external,
        date: "2026-06-01",
        timeOff: [],
        accountWorkingDays: [2, 3, 4, 5],
        closures: [],
      }),
    ).toBe(true);
    expect(
      isCreationStartBlocked({
        resource: external,
        date: "2026-06-01",
        timeOff: [],
        accountWorkingDays: [1, 2, 3, 4, 5],
        closures: [],
      }),
    ).toBe(false);
    // An external carries no time off of its own: a stray record must not gate its lane.
    expect(
      isCreationStartBlocked({
        resource: { ...external, id: "r1" },
        date: "2026-06-03",
        timeOff: [holiday],
        accountWorkingDays: [1, 2, 3, 4, 5],
        closures: [],
      }),
    ).toBe(false);
  });
}

function registerBlockReasonTests() {
  it("does not apply company closures to external resources", () => {
    const external: Resource = { ...person, kind: "external", workingDays: [] };

    expect(
      isCreationStartBlocked({
        resource: external,
        date: "2026-06-03",
        timeOff: [],
        accountWorkingDays: [1, 2, 3, 4, 5],
        closures: [companyClosure],
      }),
    ).toBe(false);
    expect(
      resolveCreationBlockReason({
        resource: external,
        date: "2026-06-03",
        timeOff: [],
        accountWorkingDays: [1, 2, 3, 4, 5],
        ignoreWorkingDays: true,
        closures: [companyClosure],
      }),
    ).toBe(null);
  });
}

function registerReasonPrecedenceTests() {
  it("names which rule blocked the start, and scopes time off to the resource asked about", () => {
    expect(
      resolveCreationBlockReason({
        resource: person,
        date: "2026-06-01",
        timeOff: [],
        accountWorkingDays: [2, 3, 4, 5],
        ignoreWorkingDays: undefined,
        closures: [],
      }),
    ).toBe("non-working");
    expect(
      resolveCreationBlockReason({
        resource: person,
        date: "2026-06-03",
        timeOff: [holiday],
        accountWorkingDays: [1, 2, 3, 4, 5],
        ignoreWorkingDays: undefined,
        closures: [],
      }),
    ).toBe("time-off");
    expect(
      resolveCreationBlockReason({
        resource: person,
        date: "2026-06-02",
        timeOff: [holiday],
        accountWorkingDays: [1, 2, 3, 4, 5],
        ignoreWorkingDays: undefined,
        closures: [],
      }),
    ).toBe(null);
    // Another person's time off is ignored, so callers need not pre-filter the list.
    expect(
      resolveCreationBlockReason({
        resource: person,
        date: "2026-06-03",
        timeOff: [{ ...holiday, resourceId: "r2" }],
        accountWorkingDays: [1, 2, 3, 4, 5],
        ignoreWorkingDays: undefined,
        closures: [],
      }),
    ).toBe(null);
    // The per-allocation override bypasses the calendars ONLY — time off passed in still blocks.
    expect(
      resolveCreationBlockReason({
        resource: person,
        date: "2026-06-03",
        timeOff: [holiday],
        accountWorkingDays: [1, 2, 3, 4, 5],
        ignoreWorkingDays: true,
        closures: [],
      }),
    ).toBe("time-off");
  });
}

describe("#257 characterization: creation and move gate boundaries", () => {
  // PERMANENT invariants: creation never accepts the override, and the override never bypasses time off.
  it("keeps a creation start blocked where the existing-allocation move override is allowed", () => {
    const companyMondayToThursday = [1, 2, 3, 4] as Resource["workingDays"];

    expect(
      resolveCreationBlockReason({
        resource: person,
        date: "2026-06-05",
        timeOff: [],
        accountWorkingDays: companyMondayToThursday,
        ignoreWorkingDays: true,
        closures: [],
      }),
    ).toBe(null);
    expect(
      isCreationStartBlocked({
        resource: person,
        date: "2026-06-05",
        timeOff: [],
        accountWorkingDays: companyMondayToThursday,
        closures: [],
      }),
    ).toBe(true);
  });

  it("returns time-off when the override bypasses both recurring calendars", () => {
    const fridayHoliday = makeTimeOff({ startDate: "2026-06-05", endDate: "2026-06-05" });

    expect(
      resolveCreationBlockReason({
        resource: person,
        date: "2026-06-05",
        timeOff: [fridayHoliday],
        accountWorkingDays: [1, 2, 3, 4],
        ignoreWorkingDays: true,
        closures: [],
      }),
    ).toBe("time-off");
  });

  it("never lets the override bypass a company closure", () => {
    expect(
      resolveCreationBlockReason({
        resource: person,
        date: "2026-06-03",
        timeOff: [],
        accountWorkingDays: [1, 2],
        ignoreWorkingDays: true,
        closures: [companyClosure],
      }),
    ).toBe("time-off");
  });
});
