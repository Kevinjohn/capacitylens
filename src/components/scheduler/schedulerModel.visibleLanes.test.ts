import { describe, expect, it } from "vitest";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { emptyAppData, type ISODate } from "@capacitylens/shared/types/entities";
import { buildEmptyFilters } from "../../store/useStore";
import { makeActivity, makeAllocation, makeResource, requireValue } from "../../test/fixtures";
import { buildColumnGeometry } from "./columnGeometry";
import { applyVisibleUtilization, buildSchedulerModel } from "./schedulerModel";

describe("visible-window lane projection", () => {
  it("does not retain row height from an off-screen overlap", () => {
    const data = {
      ...emptyAppData(),
      resources: [makeResource({ id: "r1", accountId: "acct-test", name: "Diana Prince" })],
      activities: [makeActivity({ id: "activity-1", accountId: "acct-test", kind: "internal" })],
      allocations: [
        makeAllocation({
          id: "august-overlap-a",
          accountId: "acct-test",
          resourceId: "r1",
          activityId: "activity-1",
          startDate: "2026-08-19",
          endDate: "2026-08-19",
        }),
        makeAllocation({
          id: "august-overlap-b",
          accountId: "acct-test",
          resourceId: "r1",
          activityId: "activity-1",
          startDate: "2026-08-19",
          endDate: "2026-08-20",
        }),
        makeAllocation({
          id: "september-occurrence-a",
          accountId: "acct-test",
          resourceId: "r1",
          activityId: "activity-1",
          startDate: "2026-09-16",
          endDate: "2026-09-16",
        }),
        makeAllocation({
          id: "september-occurrence-b",
          accountId: "acct-test",
          resourceId: "r1",
          activityId: "activity-1",
          startDate: "2026-09-23",
          endDate: "2026-09-23",
        }),
      ],
    };
    const timelineDays = eachDayISO("2026-08-17", "2026-10-31");
    const base = buildSchedulerModel({
      data,
      geom: buildColumnGeometry(timelineDays, 48, { minimiseWeekends: false, weekendWidth: 22 }),
      days: timelineDays,
      visibleWindow: { start: "2026-08-17", end: "2026-08-30" },
      overSoonWindow: { start: "2026-09-14", end: "2026-09-27" },
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: false, placeholdersEnabled: true, externalEnabled: true },
    });
    const projectWindow = (start: ISODate, end: ISODate) =>
      requireValue(
        applyVisibleUtilization({
          model: base,
          data,
          start,
          end,
          accountWorkingDays: [1, 2, 3, 4, 5],
        })
          .flatMap((group) => group.rows)
          .find((row) => row.resource.id === "r1"),
        "scheduler row",
      );

    const septemberRow = projectWindow("2026-09-14", "2026-09-27");
    expect(septemberRow.rowHeight).toBe(46);
    expect(new Set(septemberRow.bars.map((bar) => bar.top))).toEqual(new Set([10]));

    const augustRow = projectWindow("2026-08-17", "2026-08-30");
    expect(augustRow.rowHeight).toBe(76);
    expect(new Set(augustRow.bars.slice(0, 2).map((bar) => bar.top)).size).toBe(2);
  });
});
