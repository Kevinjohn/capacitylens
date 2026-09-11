import { describe, it, expect } from "vitest";
import { applyGesture, type DateRange } from "./gestureMath";
import type { Weekday } from "@capacitylens/shared/types/entities";

// Pixel→day snapping no longer lives here: the drag hook derives the day delta from the
// ColumnGeometry inverse (geom.indexAt), so each endpoint snaps to a column independently —
// correct even across narrowed weekend columns. See columnGeometry.test.ts. applyGesture
// (the weekend-aware DATE math) is unchanged and still owned here.

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
  // Issue #338. 2026-08-13 is a Thursday, 08-14 a Friday, 08-17 a Monday, 08-18 a Tuesday.
  // "Mid" works Tue/Wed/Thu — neither Friday nor Monday; "full" works Mon-Fri.
  const mid = [2, 3, 4] as Weekday[];
  const monToFri = [1, 2, 3, 4, 5] as Weekday[];
  const wholeWeek = [0, 1, 2, 3, 4, 5, 6] as Weekday[];

  it("shrinks a range whose duration the origin measured in fewer working days", () => {
    // Thu 13 - Tue 18 is TWO working days for Mid. Dropped on Mon-Fri it must stay two days
    // (Thu, Fri), not be re-read as the four days Mon-Fri sees between those same dates.
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
    // A seven-day week is not weekend-aware, so Thu 13 - Tue 18 is six CALENDAR days. Six working
    // days on Mon-Fri run Thu 13 through Thu 20.
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
    // Thu 13 - Tue 18 is four working days on Mon-Fri; four calendar days from Thu 13 end Sun 16.
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
    // Diagonal: one column right lands on Fri 14, which Mid does not work, so the start snaps
    // forward to Tue 18. The duration is still the two working days Mon-Fri measured.
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
    // Sat 15 - Sun 16: zero working days for Mid, so there is no duration to carry across.
    expect(
      applyGesture({
        mode: "move",
        range: { startDate: "2026-08-15", endDate: "2026-08-16" },
        deltaDays: 0,
        options: { workingDays: monToFri, sourceWorkingDays: mid },
      }),
    ).toEqual({ startDate: "2026-08-15", endDate: "2026-08-16" });
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

const wd = { workingDays: [1, 2, 3, 4, 5] as Weekday[] }; // Mon–Fri
// Reference weekdays in May 2026: 11=Mon, 15=Fri, 16=Sat, 17=Sun, 18=Mon, 22=Fri.

function registerWeekendAwareResizeScenarios(): void {
  it("resize-end dragging into a weekend snaps forward to the next working day", () => {
    const r: DateRange = { startDate: "2026-05-11", endDate: "2026-05-15" }; // Mon–Fri
    // +1 calendar day lands on Sat 05-16; snap forward to Mon 05-18 (no weekend at the edge).
    expect(applyGesture({ mode: "resize-end", range: r, deltaDays: 1, options: wd }).endDate).toBe("2026-05-18");
  });

  it("resize-end dragging left onto a weekend snaps backward to a working day", () => {
    const r: DateRange = { startDate: "2026-05-11", endDate: "2026-05-18" }; // Mon–Mon
    // -1 from Mon 05-18 = Sun 05-17; snap backward to Fri 05-15.
    expect(applyGesture({ mode: "resize-end", range: r, deltaDays: -1, options: wd }).endDate).toBe("2026-05-15");
  });

  it("resize-start dragging onto a weekend snaps to a working day", () => {
    const r: DateRange = { startDate: "2026-05-18", endDate: "2026-05-22" }; // Mon–Fri
    // -1 from Mon 05-18 = Sun 05-17; snap backward to Fri 05-15.
    expect(applyGesture({ mode: "resize-start", range: r, deltaDays: -1, options: wd }).startDate).toBe("2026-05-15");
  });

  it("does NOT snap when the allocation opts out of weekend-awareness", () => {
    const r: DateRange = { startDate: "2026-05-11", endDate: "2026-05-15" };
    expect(
      applyGesture({ mode: "resize-end", range: r, deltaDays: 1, options: { ...wd, ignoreWeekends: true } }).endDate,
    ).toBe("2026-05-16");
  });

  it("resize-start over-dragged past a WEEKEND end pins to a working day (no zero-span)", () => {
    // 2026-06-01 Mon … 2026-06-06 Sat — the end is a Saturday.
    const r: DateRange = { startDate: "2026-06-01", endDate: "2026-06-06" };
    const out = applyGesture({ mode: "resize-start", range: r, deltaDays: 99, options: wd });
    expect(out.startDate).toBe("2026-06-05"); // Friday, NOT the Saturday end (was: 06-06, 0 working days)
    expect(out.endDate).toBe("2026-06-06");
  });

  it("resize-end over-dragged past a WEEKEND start pins to a working day", () => {
    // 2026-06-07 Sun … 2026-06-12 Fri — the start is a Sunday.
    const r: DateRange = { startDate: "2026-06-07", endDate: "2026-06-12" };
    const out = applyGesture({ mode: "resize-end", range: r, deltaDays: -99, options: wd });
    expect(out.endDate).toBe("2026-06-08"); // Monday, NOT the Sunday start
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
    // No actual drag happened (deltaDays 0) — weekend-awareness must NOT kick in and snap a
    // start that was already sitting on a non-working day away from its current position.
    const r: DateRange = { startDate: "2026-06-06", endDate: "2026-06-10" }; // Sat … Wed
    expect(applyGesture({ mode: "resize-start", range: r, deltaDays: 0, options: wd })).toEqual({
      startDate: "2026-06-06",
      endDate: "2026-06-10",
    });
  });

  it("resize-end with a zero delta (no drag) is a no-op, even resting on a non-working day", () => {
    const r: DateRange = { startDate: "2026-06-03", endDate: "2026-06-06" }; // Wed … Sat
    expect(applyGesture({ mode: "resize-end", range: r, deltaDays: 0, options: wd })).toEqual({
      startDate: "2026-06-03",
      endDate: "2026-06-06",
    });
  });

  it("resize-start dragging FORWARD onto a weekend snaps forward (not backward) to a working day", () => {
    // 2026-05-15 Fri … 2026-05-22 Fri, +1 day lands the start on Sat 05-16. A forward drag
    // (deltaDays > 0) must snap FORWARD to Mon 05-18, not backward to Fri 05-15.
    const r: DateRange = { startDate: "2026-05-15", endDate: "2026-05-22" };
    expect(applyGesture({ mode: "resize-start", range: r, deltaDays: 1, options: wd }).startDate).toBe("2026-05-18");
  });
}

describe("applyGesture: weekend-aware resize", () => {
  registerWeekendAwareResizeScenarios();
  registerWeekendAwareResizeEdgeScenarios();
});
