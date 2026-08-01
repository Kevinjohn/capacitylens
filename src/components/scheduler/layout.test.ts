import { describe, it, expect } from "vitest";
import { LAYOUT, laneLayout, laneLayoutFor, schedulerDensity, DENSITY_SCALE, LANE_GAP_SCALE } from "./layout";
import { rowHeightForLanes } from "../../lib/lanePacking";

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

// "Compact view" density. LAYOUT is the COMPACT geometry (what the schedule has always drawn), and
// the pref defaults OFF, so the ROOMY numbers are what ships — these pin both ends.
describe("schedulerDensity", () => {
  it("returns today's geometry unchanged when compact", () => {
    const compact = schedulerDensity(true);
    expect(compact.laneGap).toBe(LAYOUT.laneGap);
    expect(compact.rowPadding).toBe(LAYOUT.rowPadding);
    expect(compact.groupHeaderHeight).toBe(LAYOUT.groupHeaderHeight);
    expect(compact.identityBandHeight).toBe(LAYOUT.rowPadding * 2 + LAYOUT.barHeight);
  });

  it("scales row padding and the toolbar/nav rhythm by DENSITY_SCALE when roomy", () => {
    const compact = schedulerDensity(true);
    const roomy = schedulerDensity(false);
    expect(roomy.rowPadding).toBe(Math.round(LAYOUT.rowPadding * DENSITY_SCALE));
    expect(roomy.toolbarPadY).toBe(compact.toolbarPadY * DENSITY_SCALE);
    expect(roomy.toolbarGapY).toBe(compact.toolbarGapY * DENSITY_SCALE);
    expect(roomy.navMenuGapY).toBe(compact.navMenuGapY * DENSITY_SCALE);
    expect(roomy.navSectionPadY).toBe(compact.navSectionPadY * DENSITY_SCALE);
    expect(roomy.navSectionGapY).toBe(compact.navSectionGapY * DENSITY_SCALE);
  });

  // Owner decision: a discipline band holds one short label and nothing else, so padding it out
  // just makes a tall empty stripe. It must stay put while everything around it grows.
  it("never changes the discipline band height", () => {
    expect(schedulerDensity(true).groupHeaderHeight).toBe(LAYOUT.groupHeaderHeight);
    expect(schedulerDensity(false).groupHeaderHeight).toBe(LAYOUT.groupHeaderHeight);
  });

  // Owner decision: at the shared scale the stacked-allocation gap moves 4px → 8px, which the row
  // padding either side swamps — it reads as "that gap never changed". It gets its own multiplier,
  // and must scale strictly harder than the padding around it or the complaint comes back.
  it("scales the gap between stacked allocations harder than the row padding", () => {
    const compact = schedulerDensity(true);
    const roomy = schedulerDensity(false);
    expect(roomy.laneGap).toBe(Math.round(LAYOUT.laneGap * LANE_GAP_SCALE));
    expect(LANE_GAP_SCALE).toBeGreaterThan(DENSITY_SCALE);
    expect(roomy.laneGap / compact.laneGap).toBeGreaterThan(roomy.rowPadding / compact.rowPadding);
  });

  // The bar is CONTENT, not spacing: growing it would restyle every allocation and change how much
  // label fits. Only the gaps between things move.
  it("keeps the bar the same height in both densities", () => {
    expect(laneLayoutFor(true).barHeight).toBe(LAYOUT.barHeight);
    expect(laneLayoutFor(false).barHeight).toBe(LAYOUT.barHeight);
  });

  // The left column's identity band is pinned to exactly one lane band so the name/avatar stays
  // aligned with the first bar. If it ever diverges from rowHeightForLanes(1), the name will drift
  // off the bar it labels — at whichever density broke first.
  it("keeps the identity band equal to a single-lane row at both densities", () => {
    for (const compact of [true, false]) {
      expect(schedulerDensity(compact).identityBandHeight).toBe(rowHeightForLanes(1, laneLayoutFor(compact)));
    }
  });

  it("gives a roomy row more height than a compact one, at every lane count", () => {
    for (const lanes of [1, 2, 3]) {
      expect(rowHeightForLanes(lanes, laneLayoutFor(false))).toBeGreaterThan(
        rowHeightForLanes(lanes, laneLayoutFor(true)),
      );
    }
  });
});
