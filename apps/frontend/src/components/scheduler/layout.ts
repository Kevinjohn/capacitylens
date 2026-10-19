import type { LaneLayout } from "@/lib/lanePacking";

// Fixed pixel geometry for the scheduler. dayWidth is dynamic (zoom) and lives in
// the store; everything here is constant.
/** Shared pixel dimensions used by schedule rows and bars. */
export const LAYOUT = {
  barHeight: 26,
  laneGap: 4,
  // The horizontal inset is visual only; gesture range math uses the full column span.
  barInset: 5,

  rowPadding: 10,

  leftColWidth: 256,
  // Floor for the sticky header row, applied as min-height (not a hard height) so
  // the two-tier date header can grow to fit its content, and keep fitting when the
  // user bumps their font size, instead of clipping the weekday labels.
  headerHeight: 44,
  groupHeaderHeight: 30,
};

/** Insets a bar within its raw span, capping the inset so narrow bars keep a visible width. */
export function buildAllocationBarInset(left: number, width: number) {
  const inset = Math.min(LAYOUT.barInset, width / 3);
  return { insetLeft: left + inset, insetWidth: Math.max(1, width - inset * 2) };
}

/** The base (tight) lane geometry: buildSchedulerModel's default when a caller passes no layout. */
export const laneLayout: LaneLayout = {
  barHeight: LAYOUT.barHeight,
  laneGap: LAYOUT.laneGap,
  rowPadding: LAYOUT.rowPadding,
};

// Density scales vertical gaps while retaining bar and discipline-label sizes. Stacked allocations need a larger gap multiplier than row padding so overlaps remain distinct; horizontal dimensions stay fixed to preserve timeline space.
/** Scale factor applied to scheduler density presets. */
export const DENSITY_SCALE = 2;

/** Scale applied to the gap between stacked allocations so neighboring bookings remain distinct. */
export const LANE_GAP_SCALE = 4;

const TOOLBAR_PAD_Y = 8;
const TOOLBAR_GAP_Y = 8;
const NAV_MENU_GAP_Y = 4;
const NAV_SECTION_PAD_Y = 8;
const NAV_SECTION_GAP_Y = 8;

const resolveRoomySize = (value: number, scale: number = DENSITY_SCALE): number => Math.round(value * scale);

/** Spacing dimensions shared by scheduler rows and navigation. */
export interface SchedulerDensity {
  laneGap: number;
  rowPadding: number;
  /** Fixed discipline-band height, independent of row-spacing density. */
  groupHeaderHeight: number;
  /** Height of the left column's identity band, exactly one lane band, so the name/avatar stays
   * aligned with the first bar however tall a multi-allocation row grows. Mirrors the single-lane
   * case of `resolveRowHeightForLanes`; the two must move together. */
  identityBandHeight: number;
  /** Toolbar block padding and wrap-row gap, in px. Y axis only: the toolbar's horizontal gap is
   * fixed, because widening it would make the row wrap sooner and fight the Reflow behaviour
   * SchedulerToolbar documents. */
  toolbarPadY: number;
  toolbarGapY: number;
  /** Vertical sidebar spacing preserves square icon-rail buttons. */
  navMenuGapY: number;
  navSectionPadY: number;
  navSectionGapY: number;
}

/** Builds the scheduler's fixed vertical spacing and navigation rhythm. */
export function buildSchedulerDensity(): SchedulerDensity {
  const rowPadding = resolveRoomySize(LAYOUT.rowPadding);
  return {
    laneGap: resolveRoomySize(LAYOUT.laneGap, LANE_GAP_SCALE),
    rowPadding,
    groupHeaderHeight: LAYOUT.groupHeaderHeight,
    identityBandHeight: rowPadding * 2 + LAYOUT.barHeight,
    toolbarPadY: resolveRoomySize(TOOLBAR_PAD_Y),
    toolbarGapY: resolveRoomySize(TOOLBAR_GAP_Y),
    navMenuGapY: resolveRoomySize(NAV_MENU_GAP_Y),
    navSectionPadY: resolveRoomySize(NAV_SECTION_PAD_Y),
    navSectionGapY: resolveRoomySize(NAV_SECTION_GAP_Y),
  };
}

/** One shared instance, referentially stable and safe as a `useMemo`/effect dependency. */
export const SCHEDULER_DENSITY: SchedulerDensity = buildSchedulerDensity();

/** The lane-packing projection of {@link SCHEDULER_DENSITY}, handed to buildSchedulerModel. */
export const SCHEDULER_LANE_LAYOUT: LaneLayout = {
  barHeight: LAYOUT.barHeight,
  laneGap: SCHEDULER_DENSITY.laneGap,
  rowPadding: SCHEDULER_DENSITY.rowPadding,
};
