import { describe, it, expect } from "vitest";
import { buildColumnGeometry } from "./columnGeometry";
import { resolveWeekStartSnapTarget } from "./resolveWeekStartSnapTarget";
import { eachDayISO, startOfWeekISO } from "@capacitylens/shared/lib/dateMath";

// Use a multi-week window to prove snapping floors to the current week even when the next week boundary is nearer.
const DAYS = eachDayISO("2026-06-01", "2026-06-21");
const DAY_W = 48;
const OFF = { minimiseWeekends: false, weekendWidth: 20 };
const ON = { minimiseWeekends: true, weekendWidth: 20 };

const geom = buildColumnGeometry(DAYS, DAY_W, OFF);

const mon1 = geom.xForDateInGeom("2026-06-01");

describe("resolveWeekStartSnapTarget — floor to the current week start (uniform grid)", () => {
  const mon2 = geom.xForDateInGeom("2026-06-08");

  it("a left edge mid-week (Wed) floors BACK to the same Monday", () => {
    const wedX = geom.xForDateInGeom("2026-06-03");
    expect(resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: wedX, weekStartsOn: 1 })).toBe(mon1);
  });

  it("a left edge past the half-week (Fri) ALSO floors back to the SAME Monday, never forward", () => {
    const friX = geom.xForDateInGeom("2026-06-05");
    const target = resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: friX, weekStartsOn: 1 });
    expect(target).toBe(mon1);
    expect(target).toBeLessThan(mon2);
  });

  it("returns null when already exactly on a Monday (convergence — caller no-ops)", () => {
    expect(resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: mon1, weekStartsOn: 1 })).toBeNull();
    expect(resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: mon2, weekStartsOn: 1 })).toBeNull();
  });

  it("returns null within the 0.5px convergence band (sub-pixel already-aligned)", () => {
    // A position 0.4px above Monday resolves to that Monday and falls within the convergence band.
    // Rounding also keeps a position 0.4px below Monday on the same column, as tested below.
    expect(resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: mon2 + 0.4, weekStartsOn: 1 })).toBeNull();

    expect(resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: mon2 + 0.6, weekStartsOn: 1 })).toBe(mon2);
  });
});

describe("resolveWeekStartSnapTarget — Sunday week start (weekStartsOn=0)", () => {
  it("clamps the first partial week's preceding Sunday to the window origin", () => {
    const tueX = geom.xForDateInGeom("2026-06-02");
    expect(resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: tueX, weekStartsOn: 0 })).toBe(0);
  });

  it("floors to the SUNDAY, not the Monday", () => {
    const tueX = geom.xForDateInGeom("2026-06-09");
    const sunday = geom.xForDateInGeom("2026-06-07");
    expect(resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: tueX, weekStartsOn: 0 })).toBe(sunday);

    expect(resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: tueX, weekStartsOn: 0 })).not.toBe(
      geom.xForDateInGeom("2026-06-08"),
    );
  });
});

describe("resolveWeekStartSnapTarget — convergence boundary is <=, not <", () => {
  it("preserves an explicit zero epsilon", () => {
    const mondayOffset = geom.xForDateInGeom("2026-06-08");
    expect(
      resolveWeekStartSnapTarget({ geom, days: DAYS, scrollLeft: mondayOffset, weekStartsOn: 1, epsilon: 0 }),
    ).toBeNull();
    expect(
      resolveWeekStartSnapTarget({ geom, days: DAYS, scrollLeft: mondayOffset + 0.4, weekStartsOn: 1, epsilon: 0 }),
    ).toBe(mondayOffset);
  });

  it("a distance EXACTLY equal to a custom epsilon still counts as converged (returns null)", () => {
    expect(
      resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: mon1 + 2, weekStartsOn: 1, epsilon: 2 }),
    ).toBeNull();
  });
});

describe("resolveWeekStartSnapTarget — degenerate inputs stay finite", () => {
  it("an out-of-range (negative / huge) scrollLeft falls back via days[0]/last day, never NaN", () => {
    const lo = resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: -9999, weekStartsOn: 1 });
    expect(lo).toBe(0);
    expect(Number.isFinite(lo as number)).toBe(true);

    const hi = resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: 9_999_999, weekStartsOn: 1 });
    expect(Number.isFinite(hi as number)).toBe(true);
    expect(hi).toBe(geom.xForDateInGeom("2026-06-15"));
  });

  it("returns a no-op for an empty day window instead of throwing", () => {
    const empty = buildColumnGeometry([], DAY_W, OFF);
    expect(resolveWeekStartSnapTarget({ geom: empty, days: [], scrollLeft: 0, weekStartsOn: 1 })).toBeNull();
  });

  it("degrades invalid dates and an out-of-window first week start to zero", () => {
    const invalidDays = ["not-a-date"];
    const invalidGeom = buildColumnGeometry(invalidDays, DAY_W, OFF);
    expect(resolveWeekStartSnapTarget({ geom: invalidGeom, days: invalidDays, scrollLeft: 48, weekStartsOn: 1 })).toBe(
      0,
    );
    const partial = eachDayISO("2026-06-03", "2026-06-09");
    const partialGeom = buildColumnGeometry(partial, DAY_W, OFF);
    expect(resolveWeekStartSnapTarget({ geom: partialGeom, days: partial, scrollLeft: DAY_W, weekStartsOn: 1 })).toBe(
      0,
    );
  });
});

// Fractional scroll positions just below a Monday boundary must still resolve to that Monday within the convergence band. Narrow weekends make a mistaken floor jump back a whole week.
describe.each([
  ["minimise OFF", OFF],
  ["minimise ON", ON],
] as const)("resolveWeekStartSnapTarget — sub-pixel left edge near a Monday boundary (%s)", (_label, opts) => {
  const geom = buildColumnGeometry(DAYS, DAY_W, opts);
  const mondayOffset = geom.xForDateInGeom("2026-06-08");
  const prevMonday = geom.xForDateInGeom("2026-06-01");

  it("a position a sub-pixel BELOW the Monday boundary stays on that Monday (no week-back jump)", () => {
    const target = resolveWeekStartSnapTarget({
      geom: geom,
      days: DAYS,
      scrollLeft: mondayOffset - 0.4,
      weekStartsOn: 1,
    });

    expect(target).not.toBe(prevMonday);
    expect(target).toBeNull();
  });

  it("a position a sub-pixel ABOVE the Monday boundary also stays on that Monday (no-op)", () => {
    expect(
      resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: mondayOffset + 0.4, weekStartsOn: 1 }),
    ).toBeNull();
  });

  it("a genuinely mid-week (integer Wed) left edge still FLOORS to that week’s Monday", () => {
    const wedX = geom.xForDateInGeom("2026-06-10");
    expect(resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: wedX, weekStartsOn: 1 })).toBe(
      mondayOffset,
    );
  });
});

describe("resolveWeekStartSnapTarget — minimised-weekend geometry", () => {
  const geom = buildColumnGeometry(DAYS, DAY_W, ON);

  it("floors to the correct INTEGER week-start offset across narrowed weekends", () => {
    const wedX = geom.xForDateInGeom("2026-06-10");
    const mondayOfWeek2 = geom.xForDateInGeom("2026-06-08");
    const target = resolveWeekStartSnapTarget({ geom: geom, days: DAYS, scrollLeft: wedX, weekStartsOn: 1 });
    expect(target).toBe(mondayOfWeek2);
    // Snap targets use integer geometry offsets so zoom anchoring does not drift.
    expect(Number.isInteger(target as number)).toBe(true);

    expect(target).toBe(geom.xForDateInGeom(startOfWeekISO("2026-06-10", 1)));
  });
});
