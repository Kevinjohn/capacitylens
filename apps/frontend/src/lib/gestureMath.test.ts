import { describe, it, expect } from "vitest";
import { applyGesture } from "./gestureMath";
import type { DateRange } from "./gestureMath";
import type { Weekday } from "@capacitylens/shared/types/entities";

// Geometry owns endpoint-to-column snapping; this suite exercises working-calendar date placement.

const range: DateRange = { startDate: "2026-05-10", endDate: "2026-05-12" };

describe("applyGesture: move", () => {
  it("shifts both ends by the delta", () => {
    expect(applyGesture({ mode: "move", range: range, deltaDays: 2 })).toEqual({
      startDate: "2026-05-12",
      endDate: "2026-05-14",
    });
    expect(applyGesture({ mode: "move", range: range, deltaDays: -3 })).toEqual({
      startDate: "2026-05-07",
      endDate: "2026-05-09",
    });
  });

  it("snaps a weekend-aware moved start in the drag direction", () => {
    const weekdays = { workingDays: [1, 2, 3, 4, 5] as Weekday[] };
    const workingWeek: DateRange = { startDate: "2026-06-01", endDate: "2026-06-05" };

    expect(applyGesture({ mode: "move", range: workingWeek, deltaDays: 5, options: weekdays })).toEqual({
      startDate: "2026-06-08",
      endDate: "2026-06-12",
    });
    expect(applyGesture({ mode: "move", range: workingWeek, deltaDays: -1, options: weekdays })).toEqual({
      startDate: "2026-05-29",
      endDate: "2026-06-04",
    });
  });

  it("keeps a zero-delta move unchanged even when a legacy range starts on a weekend", () => {
    const weekendRange: DateRange = { startDate: "2026-06-06", endDate: "2026-06-07" };
    expect(
      applyGesture({
        mode: "move",
        range: weekendRange,
        deltaDays: 0,
        options: { workingDays: [1, 2, 3, 4, 5] as Weekday[] },
      }),
    ).toEqual(weekendRange);
  });
});

describe("applyGesture: move across resources with different working weeks", () => {
  const mid = [2, 3, 4] as Weekday[];
  const monToFri = [1, 2, 3, 4, 5] as Weekday[];
  const wholeWeek = [0, 1, 2, 3, 4, 5, 6] as Weekday[];

  it("shrinks a range whose duration the origin measured in fewer working days", () => {
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-13", endDate: "2026-08-18" },
        deltaDays: 0,
        options: { workingDays: monToFri, sourceWorkingDays: mid },
      }),
    ).toEqual({ startDate: "2026-08-13", endDate: "2026-08-14" });
  });

  it("stretches the same range back when it returns to the narrower week", () => {
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-13", endDate: "2026-08-14" },
        deltaDays: 0,
        options: { workingDays: mid, sourceWorkingDays: monToFri },
      }),
    ).toEqual({ startDate: "2026-08-13", endDate: "2026-08-18" });
  });

  it("reads a whole-week origin's duration as calendar days and re-places them as working days", () => {
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-13", endDate: "2026-08-18" },
        deltaDays: 0,
        options: { workingDays: monToFri, sourceWorkingDays: wholeWeek },
      }),
    ).toEqual({ startDate: "2026-08-13", endDate: "2026-08-20" });
  });

  it("re-places a working-day duration as calendar days on a whole-week destination", () => {
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-13", endDate: "2026-08-18" },
        deltaDays: 0,
        options: { workingDays: wholeWeek, sourceWorkingDays: monToFri },
      }),
    ).toEqual({ startDate: "2026-08-13", endDate: "2026-08-16" });
  });

  it("snaps the start against the DESTINATION while taking the duration from the ORIGIN", () => {
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-13", endDate: "2026-08-14" },
        deltaDays: 1,
        options: { workingDays: mid, sourceWorkingDays: monToFri },
      }),
    ).toEqual({ startDate: "2026-08-18", endDate: "2026-08-19" });
  });

  it("preserves the calendar span when the origin sees no working days in the range", () => {
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-14", endDate: "2026-08-16" },
        deltaDays: 0,
        options: { workingDays: monToFri, sourceWorkingDays: mid },
      }),
    ).toEqual({ startDate: "2026-08-14", endDate: "2026-08-16" });
  });

  it("snaps the start onto the destination's week even when the origin carries no duration", () => {
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-14", endDate: "2026-08-14" },
        deltaDays: 1,
        options: { workingDays: monToFri, sourceWorkingDays: mid },
      }),
    ).toEqual({ startDate: "2026-08-17", endDate: "2026-08-17" });
  });

  it("preserves the calendar span when the origin's working week has collapsed to none", () => {
    // An empty week is not weekend-aware, so it cannot be told apart from a seven-day week by
    // awareness alone. Reading "works no day" as "works every day" would measure six calendar days
    // and re-place them as six of the target's working days, inflating the booking to 2026-08-20.
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-13", endDate: "2026-08-18" },
        deltaDays: 0,
        options: { workingDays: monToFri, sourceWorkingDays: [] },
      }),
    ).toEqual({ startDate: "2026-08-13", endDate: "2026-08-18" });
  });

  it("ignores both weeks when the allocation opts out of weekend-awareness", () => {
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-13", endDate: "2026-08-18" },
        deltaDays: 0,
        options: { workingDays: monToFri, sourceWorkingDays: mid, ignoreWeekends: true },
      }),
    ).toEqual({ startDate: "2026-08-13", endDate: "2026-08-18" });
  });

  it("is unchanged from a single-week move when the two weeks are the same", () => {
    const single = applyGesture({
      mode: "move",
      range: { startDate: "2026-08-13", endDate: "2026-08-18" },
      deltaDays: 2,
      options: { workingDays: monToFri },
    });
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-13", endDate: "2026-08-18" },
        deltaDays: 2,
        options: { workingDays: monToFri, sourceWorkingDays: monToFri },
      }),
    ).toEqual(single);
  });
});

describe("applyGesture: resize-start", () => {
  it("moves the start edge", () => {
    expect(applyGesture({ mode: "resize-start", range: range, deltaDays: -2 })).toEqual({
      startDate: "2026-05-08",
      endDate: "2026-05-12",
    });
    expect(applyGesture({ mode: "resize-start", range: range, deltaDays: 1 })).toEqual({
      startDate: "2026-05-11",
      endDate: "2026-05-12",
    });
  });

  it("never lets the start pass the end (min 1 day)", () => {
    expect(applyGesture({ mode: "resize-start", range: range, deltaDays: 5 })).toEqual({
      startDate: "2026-05-12",
      endDate: "2026-05-12",
    });
  });
});

describe("applyGesture: resize-end", () => {
  it("moves the end edge", () => {
    expect(applyGesture({ mode: "resize-end", range: range, deltaDays: 3 })).toEqual({
      startDate: "2026-05-10",
      endDate: "2026-05-15",
    });
    expect(applyGesture({ mode: "resize-end", range: range, deltaDays: -1 })).toEqual({
      startDate: "2026-05-10",
      endDate: "2026-05-11",
    });
  });

  it("never lets the end precede the start (min 1 day)", () => {
    expect(applyGesture({ mode: "resize-end", range: range, deltaDays: -5 })).toEqual({
      startDate: "2026-05-10",
      endDate: "2026-05-10",
    });
  });
});

const wd = { workingDays: [1, 2, 3, 4, 5] as Weekday[] };

function registerWeekendAwareResizeScenarios(): void {
  it("resize-end dragging into a weekend snaps forward to the next working day", () => {
    const r: DateRange = { startDate: "2026-05-11", endDate: "2026-05-15" };

    expect(applyGesture({ mode: "resize-end", range: r, deltaDays: 1, options: wd }).endDate).toBe("2026-05-18");
  });

  it("resize-end dragging left onto a weekend snaps backward to a working day", () => {
    const r: DateRange = { startDate: "2026-05-11", endDate: "2026-05-18" };

    expect(applyGesture({ mode: "resize-end", range: r, deltaDays: -1, options: wd }).endDate).toBe("2026-05-15");
  });

  it("resize-start dragging onto a weekend snaps to a working day", () => {
    const r: DateRange = { startDate: "2026-05-18", endDate: "2026-05-22" };

    expect(applyGesture({ mode: "resize-start", range: r, deltaDays: -1, options: wd }).startDate).toBe("2026-05-15");
  });

  it("does NOT snap when the allocation opts out of weekend-awareness", () => {
    const r: DateRange = { startDate: "2026-05-11", endDate: "2026-05-15" };
    expect(
      applyGesture({ mode: "resize-end", range: r, deltaDays: 1, options: { ...wd, ignoreWeekends: true } }).endDate,
    ).toBe("2026-05-16");
  });

  it("resize-start over-dragged past a WEEKEND end pins to a working day (no zero-span)", () => {
    const r: DateRange = { startDate: "2026-06-01", endDate: "2026-06-06" };
    const out = applyGesture({ mode: "resize-start", range: r, deltaDays: 99, options: wd });
    expect(out.startDate).toBe("2026-06-05");
    expect(out.endDate).toBe("2026-06-06");
  });

  it("resize-end over-dragged past a WEEKEND start pins to a working day", () => {
    const r: DateRange = { startDate: "2026-06-07", endDate: "2026-06-12" };
    const out = applyGesture({ mode: "resize-end", range: r, deltaDays: -99, options: wd });
    expect(out.endDate).toBe("2026-06-08");
    expect(out.startDate).toBe("2026-06-07");
  });
}

function registerWeekendAwareResizeEdgeScenarios(): void {
  it("never widens a weekend-only range while pinning an over-dragged edge", () => {
    const range: DateRange = { startDate: "2026-06-06", endDate: "2026-06-07" };

    expect(applyGesture({ mode: "resize-start", range: range, deltaDays: 99, options: wd })).toEqual(range);
    expect(applyGesture({ mode: "resize-end", range: range, deltaDays: -99, options: wd })).toEqual(range);
  });

  it("does not invert a one-day resize when the opposite edge is non-working", () => {
    const weekendRange: DateRange = { startDate: "2026-06-06", endDate: "2026-06-07" };
    expect(applyGesture({ mode: "resize-start", range: weekendRange, deltaDays: 1, options: wd })).toEqual(
      weekendRange,
    );
    expect(applyGesture({ mode: "resize-end", range: weekendRange, deltaDays: -1, options: wd })).toEqual(weekendRange);
  });

  it("a move whose range has NO working days at all preserves its calendar span (does not collapse it)", () => {
    // 2026-06-06 Sat … 2026-06-07 Sun: 0 working days for a Mon-Fri resource. The
    // working-day-count branch would collapse this to a single day (endDateForWorkingDays with
    // count 0); the fallback must instead keep the original 2-calendar-day span.
    const r: DateRange = { startDate: "2026-06-06", endDate: "2026-06-07" };
    expect(applyGesture({ mode: "move", range: r, deltaDays: 7, options: wd })).toEqual({
      startDate: "2026-06-13",
      endDate: "2026-06-14",
    });
  });

  it("resize-start with a zero delta (no drag) is a no-op, even resting on a non-working day", () => {
    const r: DateRange = { startDate: "2026-06-06", endDate: "2026-06-10" };
    expect(applyGesture({ mode: "resize-start", range: r, deltaDays: 0, options: wd })).toEqual({
      startDate: "2026-06-06",
      endDate: "2026-06-10",
    });
  });

  it("resize-end with a zero delta (no drag) is a no-op, even resting on a non-working day", () => {
    const r: DateRange = { startDate: "2026-06-03", endDate: "2026-06-06" };
    expect(applyGesture({ mode: "resize-end", range: r, deltaDays: 0, options: wd })).toEqual({
      startDate: "2026-06-03",
      endDate: "2026-06-06",
    });
  });

  it("resize-start dragging FORWARD onto a weekend snaps forward (not backward) to a working day", () => {
    const r: DateRange = { startDate: "2026-05-15", endDate: "2026-05-22" };
    expect(applyGesture({ mode: "resize-start", range: r, deltaDays: 1, options: wd }).startDate).toBe("2026-05-18");
  });
}

describe("applyGesture: weekend-aware resize", () => {
  registerWeekendAwareResizeScenarios();
  registerWeekendAwareResizeEdgeScenarios();
});
