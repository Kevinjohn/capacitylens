import { describe, expect, it } from "vitest";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { emptyAppData, type ISODate } from "@capacitylens/shared/types/entities";
import { buildEmptyFilters } from "../../store/useStore";
import { makeActivity, makeAllocation, makeResource, requireValue } from "../../test/fixtures";
import { buildColumnGeometry } from "./columnGeometry";
import { applyVisibleUtilization, buildSchedulerModel } from "./schedulerModel";
import { partiallyExposesNextColumn } from "./useSchedulerGridModel";

describe("visible-window lane projection", () => {
  it.each([false, true])(
    "derives partial next-column exposure for aligned and offset scroll positions (minimise weekends: %s)",
    (minimiseWeekends) => {
      const days = eachDayISO("2026-06-01", "2026-06-30");
      const geometry = buildColumnGeometry(days, 48, {
        minimiseWeekends,
        weekendWidth: 22,
        targetWeekWidth: minimiseWeekends ? 289 : 336,
      });
      const timelineWidth = 256 + geometry.x(7);

      expect(partiallyExposesNextColumn({ geometry, days, scrollLeft: 0, timelineWidth, zoom: 1 })).toBe(false);
      expect(partiallyExposesNextColumn({ geometry, days, scrollLeft: 1, timelineWidth, zoom: 1 })).toBe(true);
    },
  );

  function projectWindow(partiallyExposesNextColumn: boolean) {
    const data = {
      ...emptyAppData(),
      resources: [makeResource({ id: "r1", accountId: "acct-test", name: "Diana Prince" })],
      activities: [makeActivity({ id: "activity-1", accountId: "acct-test", kind: "internal" })],
      allocations: [
        makeAllocation({
          id: "visible-allocation",
          accountId: "acct-test",
          resourceId: "r1",
          activityId: "activity-1",
          startDate: "2026-05-26",
          endDate: "2026-06-05",
        }),
        makeAllocation({
          id: "partially-exposed-allocation",
          accountId: "acct-test",
          resourceId: "r1",
          activityId: "activity-1",
          startDate: "2026-06-03",
          endDate: "2026-06-10",
        }),
      ],
    };
    const timelineDays = eachDayISO("2026-05-01", "2026-06-30");
    const base = buildSchedulerModel({
      data,
      geom: buildColumnGeometry(timelineDays, 48, { minimiseWeekends: false, weekendWidth: 22 }),
      days: timelineDays,
      visibleWindow: { start: "2026-05-01", end: "2026-06-30" },
      overSoonWindow: { start: "2026-05-01", end: "2026-06-30" },
      filters: buildEmptyFilters(),
      preferences: { disciplinesEnabled: false, placeholdersEnabled: true, externalEnabled: true },
    });

    return requireValue(
      applyVisibleUtilization({
        model: base,
        data,
        start: "2026-05-06",
        end: "2026-06-02",
        accountWorkingDays: [1, 2, 3, 4, 5],
        partiallyExposesNextColumn,
      })
        .flatMap((group) => group.rows)
        .find((candidate) => candidate.resource.id === "r1"),
      "scheduler row",
    );
  }

  it("packs the partially exposed next column with the visible window", () => {
    const row = projectWindow(true);
    expect(Object.fromEntries(row.bars.map((bar) => [bar.allocation.id, bar.top]))).toEqual({
      "visible-allocation": 10,
      "partially-exposed-allocation": 40,
    });
    expect(row.rowHeight).toBe(76);
  });

  it("does not pack a fully off-screen next column", () => {
    const row = projectWindow(false);
    expect(Object.fromEntries(row.bars.map((bar) => [bar.allocation.id, bar.top]))).toEqual({
      "visible-allocation": 10,
      "partially-exposed-allocation": 10,
    });
    expect(row.rowHeight).toBe(46);
  });

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
