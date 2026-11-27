import type { LaneLayout } from '@/lib/lanePacking'

// Fixed pixel geometry for the scheduler. dayWidth is dynamic (zoom) and lives in
// the store; everything here is constant.
/** Shared pixel dimensions used by schedule rows and bars. */
export const LAYOUT = {
  barHeight: 26,
  // Wider than the row padding so stacked allocations remain visibly distinct.
  laneGap: 16,
  // The horizontal inset is visual only; gesture range math uses the full column span.
  barInset: 5,

  rowPadding: 20,

  leftColWidth: 256,
  // Floor for the sticky header row, applied as min-height (not a hard height) so
  // the two-tier date header can grow to fit its content, and keep fitting when the
  // user bumps their font size, instead of clipping the weekday labels.
  headerHeight: 44,
  groupHeaderHeight: 30,
  /** Height of the left column's identity band, exactly one lane band (rowPadding * 2 + barHeight),
   * so the name/avatar stays aligned with the first bar however tall a multi-allocation row grows.
   * Mirrors the single-lane case of `resolveRowHeightForLanes`; the two must move together. */
  identityBandHeight: 66,
}

/** Insets a bar within its raw span, capping the inset so narrow bars keep a visible width. */
export function buildAllocationBarInset(left: number, width: number) {
  const inset = Math.min(LAYOUT.barInset, width / 3)
  return { insetLeft: left + inset, insetWidth: Math.max(1, width - inset * 2) }
}

/** The lane geometry buildSchedulerModel packs rows with. */
export const SCHEDULER_LANE_LAYOUT: LaneLayout = {
  barHeight: LAYOUT.barHeight,
  laneGap: LAYOUT.laneGap,
  rowPadding: LAYOUT.rowPadding,
}

/** Vertical rhythm of the scheduler toolbar and the app sidebar, in px. Y axis only: the toolbar's
 * horizontal gap is fixed, because widening it would make the row wrap sooner and fight the Reflow
 * behaviour SchedulerToolbar documents. Sidebar spacing preserves square icon-rail buttons. */
export const CHROME_SPACING = {
  toolbarPadY: 16,
  toolbarGapY: 16,
  navMenuGapY: 8,
  navSectionPadY: 16,
  navSectionGapY: 16,
}
