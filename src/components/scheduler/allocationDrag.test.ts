import { describe, it, expect } from "vitest";
import {
  resolveVolumePreservingHours,
  resolveGesture,
  buildSnappedBarGeometry,
  reconcileReassignedHours as reconcileReassignedHoursWithWeek,
} from "./allocationDrag";
import { buildColumnGeometry } from "./columnGeometry";
import { eachDayISO } from "@capacitylens/shared/lib/dateMath";
import { effectiveWorkingWeek } from "@capacitylens/shared/lib/effectiveWorkingWeek";
import type { DateRange } from "@/lib/gestureMath";
import type { Resource, Weekday } from "@capacitylens/shared/types/entities";
import { makeResource } from "@/test/fixtures";

interface ReconcileReassignedHoursTestInput {
  current: number;
  target: Resource;
  zeroLoadMode: boolean;
  startDate: string;
}

// The pure gesture suite covers invalid spans, clamping, no-op moves, and working-calendar placement independently of pointer events.

const IGNORE = { ignoreWeekends: true };
const range = (startDate: string, endDate: string): DateRange => ({ startDate, endDate });
const reconcileReassignedHours = ({ current, target, zeroLoadMode, startDate }: ReconcileReassignedHoursTestInput) =>
  reconcileReassignedHoursWithWeek({
    current,
    target,
    zeroLoadMode,
    startDate,
    effectiveWeek: effectiveWorkingWeek(target, [1, 2, 3, 4, 5]),
  });

describe("volumePreservingHoursClamped", () => {
  it("rescales hours inversely with the span (volume held constant)", () => {
    expect(
      resolveVolumePreservingHours({
        previousDate: range("2026-06-01", "2026-06-04"),
        next: range("2026-06-01", "2026-06-02"),
        options: IGNORE,
        hoursPerDay: 6,
      }).hours,
    ).toBe(12);
  });

  it("clamps the result to MAX_HOURS_PER_DAY (24)", () => {
    expect(
      resolveVolumePreservingHours({
        previousDate: range("2026-06-01", "2026-06-25"),
        next: range("2026-06-01", "2026-06-01"),
        options: IGNORE,
        hoursPerDay: 6,
      }).hours,
    ).toBe(24);
  });

  it("returns the original hours when the new span is zero (divide-by-zero guard)", () => {
    expect(
      resolveVolumePreservingHours({
        previousDate: range("2026-06-01", "2026-06-04"),
        next: range("2026-06-02", "2026-06-01"),
        options: IGNORE,
        hoursPerDay: 6,
      }).hours,
    ).toBe(6);
  });

  // Report clamped only when the hours cap truncates work volume so gesture callers can surface a persistent warning.
  it("flags clamped=true when the raw derived hours exceed MAX_HOURS_PER_DAY (24)", () => {
    expect(
      resolveVolumePreservingHours({
        previousDate: range("2026-06-01", "2026-06-25"),
        next: range("2026-06-01", "2026-06-01"),
        options: IGNORE,
        hoursPerDay: 6,
      }),
    ).toEqual({ hours: 24, clamped: true });
  });
});

describe("volumePreservingHoursClamped edge cases", () => {
  it("reports clamped=false for an in-range resize (no truncation)", () => {
    expect(
      resolveVolumePreservingHours({
        previousDate: range("2026-06-01", "2026-06-04"),
        next: range("2026-06-01", "2026-06-02"),
        options: IGNORE,
        hoursPerDay: 6,
      }),
    ).toEqual({ hours: 12, clamped: false });
  });

  it("reports clamped=false at exactly the cap (24 is allowed, only > caps)", () => {
    expect(
      resolveVolumePreservingHours({
        previousDate: range("2026-06-01", "2026-06-04"),
        next: range("2026-06-01", "2026-06-01"),
        options: IGNORE,
        hoursPerDay: 6,
      }),
    ).toEqual({ hours: 24, clamped: false });
  });

  it("reports clamped=false through the divide-by-zero guard (original hours, no clamp)", () => {
    expect(
      resolveVolumePreservingHours({
        previousDate: range("2026-06-01", "2026-06-04"),
        next: range("2026-06-02", "2026-06-01"),
        options: IGNORE,
        hoursPerDay: 6,
      }),
    ).toEqual({ hours: 6, clamped: false });
  });

  // A source span with no effective working days has no measurable work volume, so resizing must preserve its stored hours rather than derive zero.
  const WEEKDAYS_ONLY = { workingDays: [1, 2, 3, 4, 5] as Weekday[] };

  it("preserves hoursPerDay verbatim when the OLD span has zero working days (weekend-only allocation)", () => {
    expect(
      resolveVolumePreservingHours({
        previousDate: range("2026-06-06", "2026-06-07"),
        next: range("2026-06-01", "2026-06-04"),
        options: WEEKDAYS_ONLY,
        hoursPerDay: 6,
      }),
    ).toEqual({ hours: 6, clamped: false });
  });

  it("does not zero hours when a zero-working-day old span is resized onto weekdays", () => {
    // Resize-end drags a Sat-only allocation forward onto a full working week, the derived hours
    // must stay the stored value, not collapse to 0 just because oldSpan/newSpan would otherwise
    // divide out to nothing.
    const { hours, clamped } = resolveVolumePreservingHours({
      previousDate: range("2026-06-06", "2026-06-06"),
      next: range("2026-06-06", "2026-06-12"),
      options: WEEKDAYS_ONLY,
      hoursPerDay: 8,
    });
    expect(hours).toBe(8);
    expect(clamped).toBe(false);
  });
});

describe("computeGesture", () => {
  const current = range("2026-06-01", "2026-06-04");

  it("returns equivalent dates and unchanged hours for a zero-delta calendar move", () => {
    const { dates, hours } = resolveGesture({
      mode: "move",
      current,
      deltaDays: 0,
      options: IGNORE,
      hoursPerDay: 6,
      isDays: true,
    });
    expect(dates).toEqual(current);
    expect(hours).toBe(6);
  });

  it("normalises a zero-horizontal move against the target working week", () => {
    const { dates, hours } = resolveGesture({
      mode: "move",
      current: range("2026-06-05", "2026-06-07"),
      deltaDays: 0,
      options: { workingDays: [1, 2, 3, 4, 5] },
      hoursPerDay: 8,
      isDays: false,
    });

    expect(dates).toEqual(range("2026-06-05", "2026-06-05"));
    expect(hours).toBe(8);
  });

  it("carries the origin's working-day duration into the target week on a reassign", () => {
    const { dates, hours } = resolveGesture({
      mode: "move",
      current: range("2026-08-13", "2026-08-18"),
      deltaDays: 0,
      options: { workingDays: [1, 2, 3, 4, 5], sourceWorkingDays: [2, 3, 4] },
      hoursPerDay: 8,
      isDays: true,
    });

    expect(dates).toEqual(range("2026-08-13", "2026-08-14"));

    expect(hours).toBe(8);
  });

  it("keeps hours unchanged for a move (only a resize rescales)", () => {
    const { dates, hours } = resolveGesture({
      mode: "move",
      current,
      deltaDays: 2,
      options: IGNORE,
      hoursPerDay: 6,
      isDays: true,
    });
    expect(hours).toBe(6);
    expect(dates).toEqual(range("2026-06-03", "2026-06-06"));
  });

  it("rescales hours for a days-mode resize that changes the span", () => {
    const { dates, hours, clamped } = resolveGesture({
      mode: "resize-end",
      current,
      deltaDays: -2,
      options: IGNORE,
      hoursPerDay: 6,
      isDays: true,
    });
    expect(dates).toEqual(range("2026-06-01", "2026-06-02"));
    expect(hours).toBe(12);
    expect(clamped).toBe(false);
  });
});

describe("computeGesture rescaling guards", () => {
  const current = range("2026-06-01", "2026-06-04");

  it("does NOT rescale hours when not in days mode (hourly/blocks)", () => {
    const { hours, clamped } = resolveGesture({
      mode: "resize-end",
      current,
      deltaDays: -2,
      options: IGNORE,
      hoursPerDay: 6,
      isDays: false,
    });
    expect(hours).toBe(6);
    expect(clamped).toBe(false);
  });

  it("flags clamped on a days-mode resize that drives hours past the cap", () => {
    const { hours, clamped } = resolveGesture({
      mode: "resize-end",
      current,
      deltaDays: -3,
      options: IGNORE,
      hoursPerDay: 12,
      isDays: true,
    });
    expect(hours).toBe(24);
    expect(clamped).toBe(true);
  });

  it("never flags clamped for a move (only a volume-preserving resize can clamp)", () => {
    expect(
      resolveGesture({ mode: "move", current, deltaDays: 2, options: IGNORE, hoursPerDay: 24, isDays: true }).clamped,
    ).toBe(false);
  });

  // Use an over-cap value to distinguish a move that preserves stored hours from an accidentally entered resize/clamp path even when spans are equal.
  it("a move never enters the volume-preserving path, even with an out-of-range hoursPerDay", () => {
    const { hours, clamped } = resolveGesture({
      mode: "move",
      current,
      deltaDays: 2,
      options: IGNORE,
      hoursPerDay: 30,
      isDays: true,
    });
    expect(hours).toBe(30);
    expect(clamped).toBe(false);
  });

  // An over-cap fixture distinguishes a zero-delta no-op from accidentally entering the resize/clamp path.
  it("deltaDays === 0 skips the rescale entirely, even with an out-of-range hoursPerDay", () => {
    const { hours, clamped } = resolveGesture({
      mode: "resize-end",
      current,
      deltaDays: 0,
      options: IGNORE,
      hoursPerDay: 30,
      isDays: true,
    });
    expect(hours).toBe(30);
    expect(clamped).toBe(false);
  });
});

describe("snappedBarGeometry", () => {
  const current = range("2026-06-01", "2026-06-04");

  const geom = buildColumnGeometry(eachDayISO("2026-06-01", "2026-06-30"), 20, {
    minimiseWeekends: false,
    weekendWidth: 12,
  });

  it("converts a non-weekend-aware move to absolute pixels (left at the snapped start, width holds)", () => {
    const { left, width } = buildSnappedBarGeometry({
      mode: "move",
      current,
      deltaDays: 2,
      options: IGNORE,
      geometry: geom,
    });
    expect(left).toBe(2 * 20);
    expect(width).toBe(4 * 20);
  });

  it("threads opts through to applyGesture (weekend-aware result differs from naive)", () => {
    // Snapped geometry must honor working-calendar options so previews match committed ranges across a weekend.
    const thuFri = range("2026-06-04", "2026-06-05");
    const naive = buildSnappedBarGeometry({
      mode: "move",
      current: thuFri,
      deltaDays: 1,
      options: IGNORE,
      geometry: geom,
    });
    const weekendAware = buildSnappedBarGeometry({
      mode: "move",
      current: thuFri,
      deltaDays: 1,
      options: { workingDays: [1, 2, 3, 4, 5] },
      geometry: geom,
    });

    expect(naive).toEqual({ left: 4 * 20, width: 2 * 20 });
    expect(weekendAware).not.toEqual(naive);
  });

  it("keeps the preview pixel-identical to the view-model when the range crosses a narrow weekend", () => {
    // Narrow-weekend geometry must measure each real column width so a range crossing the weekend cannot use uniform dayWidth arithmetic.
    const narrow = buildColumnGeometry(eachDayISO("2026-06-01", "2026-06-30"), 20, {
      minimiseWeekends: true,
      weekendWidth: 8,
    });

    const committed = {
      left: narrow.xForDateInGeom("2026-06-05"),
      width: narrow.widthForDates("2026-06-05", "2026-06-08"),
    };

    const preview = buildSnappedBarGeometry({
      mode: "resize-end",
      current: range("2026-06-05", "2026-06-05"),
      deltaDays: 1,
      options: { workingDays: [1, 2, 3, 4, 5] },
      geometry: narrow,
    });
    expect(preview).toEqual(committed);

    expect(preview.width).toBe(56);
  });
});

describe("reconcileReassignedHours", () => {
  const res = (kind: Resource["kind"], workingHoursPerDay = 8): Resource =>
    makeResource({ id: "r", accountId: "a", kind, role: "R", workingHoursPerDay, color: "#000000" });
  it("forces 0 hours when reassigning onto an external (a capacity-free row carries no load)", () => {
    expect(
      reconcileReassignedHours({ current: 8, target: res("external"), zeroLoadMode: false, startDate: "2026-06-01" }),
    ).toBe(0);
    expect(
      reconcileReassignedHours({ current: 8, target: res("external"), zeroLoadMode: true, startDate: "2026-06-01" }),
    ).toBe(0);
  });
  it("keeps a real resource positive hours on a real-to-real reassign", () => {
    expect(
      reconcileReassignedHours({ current: 6, target: res("person"), zeroLoadMode: false, startDate: "2026-06-01" }),
    ).toBe(6);
  });
  it("promotes a 0-hour booking (dragged off an external) to the target working day", () => {
    expect(
      reconcileReassignedHours({ current: 0, target: res("person", 7), zeroLoadMode: false, startDate: "2026-06-01" }),
    ).toBe(8);
  });
  it("promotes a 0-hour booking to four hours on a target half day", () => {
    expect(
      reconcileReassignedHours({
        current: 0,
        target: { ...res("person", 7), halfDays: [2] },
        zeroLoadMode: false,
        startDate: "2026-06-02",
      }),
    ).toBe(4);
  });
  it("keeps a zero-hour block at zero when reassigning it off an external", () => {
    expect(
      reconcileReassignedHours({ current: 0, target: res("person", 7), zeroLoadMode: true, startDate: "2026-06-01" }),
    ).toBe(0);
  });
});
