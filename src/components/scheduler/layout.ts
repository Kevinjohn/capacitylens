import type { LaneLayout } from '../../lib/lanePacking'

// Fixed pixel geometry for the scheduler. dayWidth is dynamic (zoom) and lives in
// the store; everything here is constant.
export const LAYOUT = {
  barHeight: 26,
  laneGap: 4,
  // A little extra vertical room per row so the left-column content (avatar, name,
  // and the stacked +/% control) breathes — also gives the 2-cell control space to sit.
  rowPadding: 10,
  // Wider resource column so names/roles aren't cramped and the +/% box has room.
  leftColWidth: 256,
  headerHeight: 44,
  groupHeaderHeight: 30,
  // Left-edge breathing room when recentring the focus date (Today / jump-to-date),
  // so a little past context shows to the left of it rather than it being flush.
  recenterLeftPad: 120,
}

export const laneLayout: LaneLayout = {
  barHeight: LAYOUT.barHeight,
  laneGap: LAYOUT.laneGap,
  rowPadding: LAYOUT.rowPadding,
}
