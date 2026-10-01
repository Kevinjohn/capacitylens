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
import { resolveRowHeightForLanes } from "../../lib/lanePacking";

// laneLayout is the LaneLayout projection of LAYOUT handed to lanePacking (packLanes / laneTop /
// rowHeightForLanes) — schedulerModel.ts wires it through unmodified. Pin its shape directly so a
// regression collapsing it to an empty object (losing barHeight/laneGap/rowPadding) is caught here
// rather than surfacing as mysterious zero-height lanes downstream.
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

// Schedule density. LAYOUT is the base (tight) geometry; the schedule renders it with the vertical
// gaps scaled out. These pin the scaled numbers against the base.
describe("schedulerDensity", () => {
  it("scales row padding and the toolbar/nav rhythm by DENSITY_SCALE", () => {
    expect(SCHEDULER_DENSITY.rowPadding).toBe(Math.round(LAYOUT.rowPadding * DENSITY_SCALE));
    // Base rhythm: py-2/gap-y-2 (8px) for the toolbar, gap-1 (4px) and p-2/gap-2 (8px) for the nav.
    expect(SCHEDULER_DENSITY.toolbarPadY).toBe(8 * DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.toolbarGapY).toBe(8 * DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.navMenuGapY).toBe(4 * DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.navSectionPadY).toBe(8 * DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.navSectionGapY).toBe(8 * DENSITY_SCALE);
  });

  // Owner decision: a discipline band holds one short label and nothing else, so padding it out
  // just makes a tall empty stripe. It must stay put while everything around it grows.
  it("never changes the discipline band height", () => {
    expect(SCHEDULER_DENSITY.groupHeaderHeight).toBe(LAYOUT.groupHeaderHeight);
  });

  // Owner decision: at the shared scale the stacked-allocation gap moves 4px → 8px, which the row
  // padding either side swamps — it reads as "that gap never changed". It gets its own multiplier,
  // and must scale strictly harder than the padding around it or the complaint comes back.
  it("scales the gap between stacked allocations harder than the row padding", () => {
    expect(SCHEDULER_DENSITY.laneGap).toBe(Math.round(LAYOUT.laneGap * LANE_GAP_SCALE));
    expect(LANE_GAP_SCALE).toBeGreaterThan(DENSITY_SCALE);
    expect(SCHEDULER_DENSITY.laneGap / LAYOUT.laneGap).toBeGreaterThan(
      SCHEDULER_DENSITY.rowPadding / LAYOUT.rowPadding,
    );
  });

  // The bar is CONTENT, not spacing: growing it would restyle every allocation and change how much
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
