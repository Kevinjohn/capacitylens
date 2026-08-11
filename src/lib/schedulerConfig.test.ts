import { describe, it, expect } from "vitest";
import {
  DAY_COLUMN_MIN_WIDTH,
  DEFAULT_RANGE_DAYS,
  DEFAULT_ZOOM,
  FALLBACK_TIMELINE_WIDTH,
  MIN_DAY_WIDTH,
  PAST_BUFFER_DAYS,
  resolveColumnFit,
  UTILIZATION_WINDOW_DAYS,
  WEEKDAY_LABEL_MIN_WIDTH,
  WEEKEND_COLUMN_REM,
  WEEK_SNAP_IDLE_MS,
  ZOOM_LEVELS,
} from "./schedulerConfig";

describe("resolveColumnFit", () => {
  it("targets enough whole pixels per week to cover the viewport", () => {
    expect(resolveColumnFit(800, 4)).toEqual({ dayWidth: 28, weekWidth: 200 });
    expect(resolveColumnFit(803, 4)).toEqual({ dayWidth: 28, weekWidth: 201 });
    expect(resolveColumnFit(840, 2)).toEqual({ dayWidth: 60, weekWidth: 420 });
  });

  it("lets a one-week view fill wide viewports instead of revealing later dates", () => {
    expect(resolveColumnFit(2000, 1)).toEqual({ dayWidth: 285, weekWidth: 2000 });
    expect(resolveColumnFit(5000, 1)).toEqual({ dayWidth: 714, weekWidth: 5000 });
  });

  it("with a weekend width, widens weekday columns so N weeks fill the space (minimise fit)", () => {
    // 1 week into 1064 with 22px weekends: 5·dw + 2·22 = 1064 -> dw = (1064-44)/5 = 204.
    expect(resolveColumnFit(1064, 1, 22)).toEqual({ dayWidth: 204, weekWidth: 1064 });
    // 2 weeks: each week is 532px; (532 - 2·22)/5 = 97.6 -> base 97 + distributed remainder.
    expect(resolveColumnFit(1064, 2, 22)).toEqual({ dayWidth: 97, weekWidth: 532 });
    // The fit is WIDER than the uniform 7-equal-columns width (which under-fills with narrow weekends).
    expect(resolveColumnFit(1064, 1).dayWidth).toBe(152); // uniform: 1064/7
    expect(204).toBeGreaterThan(152);
  });

  it("keeps the weekend-aware fit wide enough, and ignores a non-positive / non-finite weekend width", () => {
    expect(resolveColumnFit(2000, 1, 22)).toEqual({ dayWidth: 391, weekWidth: 2000 });
    expect(resolveColumnFit(50, 1, 22).dayWidth).toBe(MIN_DAY_WIDTH);
    expect(resolveColumnFit(1064, 1, 0).dayWidth).toBe(152); // 0 weekend width -> uniform fit
    expect(resolveColumnFit(1064, 1, NaN).dayWidth).toBe(152); // NaN -> uniform fit
  });

  it("clamps to MIN for tiny / many-week views and non-positive widths", () => {
    expect(resolveColumnFit(50, 8).dayWidth).toBe(MIN_DAY_WIDTH);
    expect(resolveColumnFit(0, 4).dayWidth).toBe(MIN_DAY_WIDTH);
    expect(resolveColumnFit(-100, 1).dayWidth).toBe(MIN_DAY_WIDTH);
  });

  it("falls back to MIN for a non-finite (NaN) available width, without propagating NaN", () => {
    // A measured DOM rect can be NaN (unmeasured/detached). Without the early `!Number.isFinite`
    // guard, the fit calculations would propagate NaN straight through the geometry — this
    // specifically exercises that guard, not the `<= 0` half.
    expect(resolveColumnFit(NaN, 4)).toEqual({ dayWidth: MIN_DAY_WIDTH, weekWidth: MIN_DAY_WIDTH * 7 });
    expect(Number.isFinite(resolveColumnFit(NaN, 4).dayWidth)).toBe(true);
  });

  it("exposes the expected zoom levels", () => {
    expect(ZOOM_LEVELS).toEqual([1, 2, 4, 6, 8]);
    expect(DEFAULT_ZOOM).toBe(2);
  });

  it("keeps geometry and time-window constants internally coherent", () => {
    expect(MIN_DAY_WIDTH).toBeLessThan(DAY_COLUMN_MIN_WIDTH);
    expect(DAY_COLUMN_MIN_WIDTH).toBeLessThan(WEEKDAY_LABEL_MIN_WIDTH);
    expect(FALLBACK_TIMELINE_WIDTH).toBeGreaterThan(WEEKDAY_LABEL_MIN_WIDTH);
    expect(WEEKEND_COLUMN_REM).toBeGreaterThan(0);
    expect(WEEK_SNAP_IDLE_MS).toBeGreaterThan(0);
    expect(DEFAULT_RANGE_DAYS).toBeGreaterThan(UTILIZATION_WINDOW_DAYS);
    expect(PAST_BUFFER_DAYS % 7).toBe(0);
  });
});
