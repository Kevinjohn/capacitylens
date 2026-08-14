import { useMemo } from "react";
import { useStore } from "../../store/useStore";
import type { LaneLayout } from "../../lib/lanePacking";

// Fixed pixel geometry for the scheduler. dayWidth is dynamic (zoom) and lives in
// the store; everything here is constant.
export const LAYOUT = {
  barHeight: 26,
  laneGap: 4,
  // Horizontal breathing room on each side of an allocation bar so it doesn't run
  // flush against the day gridlines. Purely visual — gesture math is unaffected.
  // Expect to tweak this; it's the single knob for the bar's left/right gap.
  barInset: 5,
  // A little extra vertical room per row so the left-column content (avatar, name,
  // and the stacked +/% control) breathes — also gives the 2-cell control space to sit.
  rowPadding: 10,
  // Wider resource column so names/roles aren't cramped and the +/% box has room.
  leftColWidth: 256,
  // Floor for the sticky header row, applied as min-height (not a hard height) so
  // the two-tier date header can grow to fit its content — and keep fitting when the
  // user bumps their font size — instead of clipping the weekday labels.
  headerHeight: 44,
  groupHeaderHeight: 30,
};

export const laneLayout: LaneLayout = {
  barHeight: LAYOUT.barHeight,
  laneGap: LAYOUT.laneGap,
  rowPadding: LAYOUT.rowPadding,
};

// "Compact view" density (device pref, default OFF — see displayPrefs). LAYOUT above is the COMPACT
// geometry: it is what the schedule has always rendered, and Compact ON keeps it exactly. With the
// pref off the vertical gaps are multiplied out, and that roomier layout is what ships by default.
//
// Three deliberate rules, all owner decisions:
//
//  1. barHeight NEVER scales. The bar is content, not spacing — growing it would restyle every
//     allocation and change how much of a label fits, where the ask was room BETWEEN things.
//  2. groupHeaderHeight NEVER scales either. A discipline band holds one short label and nothing
//     else, so padding it out just makes a tall empty stripe rather than a calmer one.
//  3. The gap BETWEEN two stacked allocations gets its own, larger multiplier. At the shared scale
//     it moves 4px → 8px, which is swamped by the row padding either side of it and reads as "that
//     gap never changed". LANE_GAP_SCALE lifts it to 16px so two overlapping projects visibly
//     separate — just under the 20px of padding above and below, so the row still groups as one.
//
// X-axis geometry (barInset, leftColWidth) is deliberately untouched: the timeline's horizontal
// budget is already the scarce one.
//
// TOOLBAR_* and NAV_* are the compact rhythm in px for the schedule toolbar and the left-hand nav,
// matching the Tailwind utilities they replace (py-2/gap-y-2, and the sidebar's gap-1/gap-2/p-2).
// They live here so ONE knob moves every vertical gap in the app shell and nothing drifts.
export const DENSITY_SCALE = 2;

/** The stacked-allocation gap scales harder than everything else — see rule 3 above. */
export const LANE_GAP_SCALE = 4;

const TOOLBAR_PAD_Y = 8;
const TOOLBAR_GAP_Y = 8;
const NAV_MENU_GAP_Y = 4;
const NAV_SECTION_PAD_Y = 8;
const NAV_SECTION_GAP_Y = 8;

const roomy = (value: number, scale: number = DENSITY_SCALE): number => Math.round(value * scale);

export interface SchedulerDensity {
  laneGap: number;
  rowPadding: number;
  /** Discipline band header. Fixed across densities by design — see rule 2 above. */
  groupHeaderHeight: number;
  /** Height of the left column's identity band — exactly one lane band, so the name/avatar stays
   *  aligned with the first bar however tall a multi-allocation row grows. Mirrors the single-lane
   *  case of `rowHeightForLanes`; the two must move together. */
  identityBandHeight: number;
  /** Toolbar block padding and wrap-row gap, in px. Y axis only: the toolbar's horizontal gap is
   *  fixed, because widening it would make the row wrap sooner and fight the Reflow behaviour
   *  SchedulerToolbar documents. */
  toolbarPadY: number;
  toolbarGapY: number;
  /** Left-hand nav rhythm, in px: gap between menu items, block padding of each section, and the
   *  gap between sections/footer rows. Item HEIGHT is untouched (content, per rule 1), so the
   *  collapsed icon rail — which pins each button to a square — is unaffected. */
  navMenuGapY: number;
  navSectionPadY: number;
  navSectionGapY: number;
}

/** Vertical geometry for the current density. `compact` true === today's tight layout. */
export function schedulerDensity(compact: boolean): SchedulerDensity {
  const laneGap = compact ? LAYOUT.laneGap : roomy(LAYOUT.laneGap, LANE_GAP_SCALE);
  const rowPadding = compact ? LAYOUT.rowPadding : roomy(LAYOUT.rowPadding);
  return {
    laneGap,
    rowPadding,
    groupHeaderHeight: LAYOUT.groupHeaderHeight,
    identityBandHeight: rowPadding * 2 + LAYOUT.barHeight,
    toolbarPadY: compact ? TOOLBAR_PAD_Y : roomy(TOOLBAR_PAD_Y),
    toolbarGapY: compact ? TOOLBAR_GAP_Y : roomy(TOOLBAR_GAP_Y),
    navMenuGapY: compact ? NAV_MENU_GAP_Y : roomy(NAV_MENU_GAP_Y),
    navSectionPadY: compact ? NAV_SECTION_PAD_Y : roomy(NAV_SECTION_PAD_Y),
    navSectionGapY: compact ? NAV_SECTION_GAP_Y : roomy(NAV_SECTION_GAP_Y),
  };
}

/**
 * The active density, for a component that just wants the numbers. Every consumer otherwise
 * repeated the same two lines — subscribe to `compactView`, call {@link schedulerDensity} — and
 * the pref is the ONLY input, so there is nothing for a caller to decide. Memoised on the flag,
 * so the object is referentially stable and safe as a `useMemo`/effect dependency.
 */
export function useSchedulerDensity(): SchedulerDensity {
  const compact = useStore((state) => state.compactView);
  return useMemo(() => schedulerDensity(compact), [compact]);
}

/** The lane-packing projection of `schedulerDensity`, handed to buildSchedulerModel. */
export function laneLayoutFor(compact: boolean): LaneLayout {
  const density = schedulerDensity(compact);
  return { barHeight: LAYOUT.barHeight, laneGap: density.laneGap, rowPadding: density.rowPadding };
}
