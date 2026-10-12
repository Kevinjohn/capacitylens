import { describe, it, expect } from "vitest";
import {
  LAYOUT,
  laneLayout,
  buildAllocationBarInset,
  DENSITY_SCALE,
  LANE_GAP_SCALE,
  SCHEDULER_DENSITY,
  SCHEDULER_LANE_LAYOUT,
} from "./layout";
import { resolveRowHeightForLanes } from "@/lib/lanePacking";

describe("laneLayout", () => {
  it("mirrors barHeight, laneGap and rowPadding from LAYOUT", () => {
    expect(laneLayout).toEqual({
      barHeight: LAYOUT.barHeight,
      laneGap: LAYOUT.laneGap,
      rowPadding: LAYOUT.rowPadding,
    });
  });
});

describe("allocation bar inset geometry", () => {
  it("keeps the bar's rendered position and width inside its raw column span", () => {
    expect(buildAllocationBarInset(96, 336)).toEqual({ insetLeft: 101, insetWidth: 326 });
  });

  it("keeps narrow bars visible while limiting their inset to one third", () => {
    expect(buildAllocationBarInset(24, 3)).toEqual({ insetLeft: 25, insetWidth: 1 });
  });
});

describe("schedulerDensity", () => {
  it("scales row padding and the toolbar/nav rhythm by DENSITY_SCALE", () => {
    expect(SCHEDULER_DENSITY.rowPadding).toBe(Math.round(LAYOUT.rowPadding * DENSITY_SCALE));

    expect(SCHEDULER_DENSITY.toolbarPadY).toBe(8 * DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.toolbarGapY).toBe(8 * DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.navMenuGapY).toBe(4 * DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.navSectionPadY).toBe(8 * DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.navSectionGapY).toBe(8 * DENSITY_SCALE);
  });

  // Discipline-band height remains fixed because its single label should not scale with row spacing.
  it("never changes the discipline band height", () => {
    expect(SCHEDULER_DENSITY.groupHeaderHeight).toBe(LAYOUT.groupHeaderHeight);
  });

  // Stacked-allocation gaps use a larger scale than row padding so adjacent bookings remain visually distinct.
  it("scales the gap between stacked allocations harder than the row padding", () => {
    expect(SCHEDULER_DENSITY.laneGap).toBe(Math.round(LAYOUT.laneGap * LANE_GAP_SCALE));
    expect(LANE_GAP_SCALE).toBeGreaterThan(DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.laneGap / LAYOUT.laneGap).toBeGreaterThan(
      SCHEDULER_DENSITY.rowPadding / LAYOUT.rowPadding,
    );
  });

  // The bar is content, not spacing: growing it would restyle every allocation and change how much
  // label fits. Only the gaps between things move.
  it("keeps the bar at its base height", () => {
    expect(SCHEDULER_LANE_LAYOUT.barHeight).toBe(LAYOUT.barHeight);
  });

  // The left column's identity band is pinned to exactly one lane band so the name/avatar stays
  // aligned with the first bar. If it ever diverges from rowHeightForLanes(1), the name will drift
  // off the bar it labels.
  it("keeps the identity band equal to a single-lane row", () => {
    expect(SCHEDULER_DENSITY.identityBandHeight).toBe(resolveRowHeightForLanes(1, SCHEDULER_LANE_LAYOUT));
  });

  it("gives a rendered row more height than the base layout, at every lane count", () => {
    for (const lanes of [1, 2, 3]) {
      expect(resolveRowHeightForLanes(lanes, SCHEDULER_LANE_LAYOUT)).toBeGreaterThan(
        resolveRowHeightForLanes(lanes, laneLayout),
      );
    }
  });
});
