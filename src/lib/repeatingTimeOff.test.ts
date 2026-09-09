import { describe, expect, it } from "vitest";
import type { Draft } from "../store/useStore";
import type { TimeOff } from "@capacitylens/shared/types/entities";
import { buildRepeatedTimeOffDrafts, resolveTimeOffRepeatPattern } from "./repeatingTimeOff";

const draft = (startDate: string, endDate: string = startDate): Draft<TimeOff> => ({
  resourceId: "resource-1",
  startDate: startDate as Draft<TimeOff>["startDate"],
  endDate: endDate as Draft<TimeOff>["endDate"],
  type: "holiday",
  note: "Family trip",
});

describe("buildRepeatedTimeOffDrafts", () => {
  it("preserves inclusive calendar-day duration and all non-date fields", () => {
    const result = buildRepeatedTimeOffDrafts(draft("2026-03-27", "2026-03-29"), "2027-02-28", "monthly-last-weekday");

    expect(result.drafts).toHaveLength(12);
    expect(result.drafts[0]).toEqual(draft("2026-03-27", "2026-03-29"));
    expect(result.drafts.at(-1)).toEqual(draft("2027-02-26", "2027-02-28"));
    expect(
      result.drafts.every(
        ({ resourceId, type, note }) => resourceId === "resource-1" && type === "holiday" && note === "Family trip",
      ),
    ).toBe(true);
  });

  it("keeps weekly anchors stable across daylight-saving transitions", () => {
    const result = buildRepeatedTimeOffDrafts(draft("2026-03-20"), "2026-04-10", "weekly");

    expect(result.drafts.map(({ startDate }) => startDate)).toEqual([
      "2026-03-20",
      "2026-03-27",
      "2026-04-03",
      "2026-04-10",
    ]);
  });

  it("includes an occurrence starting on the cutoff even when its multi-day range ends later", () => {
    const result = buildRepeatedTimeOffDrafts(draft("2026-03-20", "2026-03-22"), "2026-03-27", "weekly");

    expect(result.drafts.at(-1)).toEqual(draft("2026-03-27", "2026-03-29"));
  });

  it("rejects the whole projection when any generated end exceeds the ISO domain", () => {
    expect(() =>
      buildRepeatedTimeOffDrafts(draft("9999-11-30", "9999-12-31"), "9999-12-31", "monthly-last-weekday"),
    ).toThrow(/supported|range|9999/i);
  });

  it("rejects a reversed base range before generating anything", () => {
    expect(() => buildRepeatedTimeOffDrafts(draft("2026-03-29", "2026-03-27"), "2027-02-28", "monthly-date")).toThrow(
      /valid inclusive date range/i,
    );
  });
});

describe("resolveTimeOffRepeatPattern", () => {
  it("maps every visible cadence to a shared calendar rule", () => {
    expect([
      resolveTimeOffRepeatPattern("weekly"),
      resolveTimeOffRepeatPattern("every-two-weeks"),
      resolveTimeOffRepeatPattern("every-three-weeks"),
      resolveTimeOffRepeatPattern("every-four-weeks"),
      resolveTimeOffRepeatPattern("monthly-date"),
      resolveTimeOffRepeatPattern("monthly-last-weekday"),
    ]).toEqual([
      { kind: "weeks", interval: 1 },
      { kind: "weeks", interval: 2 },
      { kind: "weeks", interval: 3 },
      { kind: "weeks", interval: 4 },
      { kind: "monthly-date" },
      { kind: "monthly-last-weekday" },
    ]);
  });
});
