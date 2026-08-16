import { describe, expect, it } from "vitest";
import type { Resource, Weekday } from "../types/entities";
import { effectiveWorkingWeek } from "./effectiveWorkingWeek";

type WorkingWeekResource = Pick<Resource, "kind" | "workingDays">;

const person = (workingDays: Weekday[]): WorkingWeekResource => ({ kind: "person", workingDays });

describe("effective working week", () => {
  it("intersects company and personal working days", () => {
    expect(effectiveWorkingWeek(person([1, 2, 4, 5]), [1, 2, 3, 4])).toEqual({
      kind: "days",
      days: [1, 2, 4],
    });
  });

  it("deduplicates and sorts unsorted inputs", () => {
    expect(effectiveWorkingWeek(person([5, 2, 2, 1, 4]), [4, 1, 5, 4, 2])).toEqual({
      kind: "days",
      days: [1, 2, 4, 5],
    });
  });

  it("returns none when two non-empty calendars do not overlap", () => {
    expect(effectiveWorkingWeek(person([1, 3, 5]), [0, 2, 4, 6])).toEqual({ kind: "none" });
  });

  it("returns none for an empty company calendar", () => {
    expect(effectiveWorkingWeek(person([1, 2, 3, 4, 5]), [])).toEqual({ kind: "none" });
    expect(effectiveWorkingWeek({ kind: "external", workingDays: [1, 2, 3] }, [])).toEqual({ kind: "none" });
  });

  it("uses the complete company calendar for externals regardless of their stored working days", () => {
    expect(effectiveWorkingWeek({ kind: "external", workingDays: [1, 2] }, [5, 3, 4])).toEqual({
      kind: "days",
      days: [3, 4, 5],
    });
  });

  it("treats placeholders like people", () => {
    expect(effectiveWorkingWeek({ kind: "placeholder", workingDays: [1, 3, 5] }, [2, 3, 4, 5])).toEqual({
      kind: "days",
      days: [3, 5],
    });
  });

  it("does not mutate either input", () => {
    const resourceWorkingDays: Weekday[] = [5, 2, 2, 1];
    const companyWorkingDays: Weekday[] = [4, 2, 5, 4, 1];
    const resource = person(resourceWorkingDays);

    effectiveWorkingWeek(resource, companyWorkingDays);

    expect(resourceWorkingDays).toEqual([5, 2, 2, 1]);
    expect(companyWorkingDays).toEqual([4, 2, 5, 4, 1]);
  });
});
