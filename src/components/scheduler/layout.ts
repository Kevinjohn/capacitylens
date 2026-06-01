import type { LaneLayout } from '../../lib/lanePacking'

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
  // Left-edge breathing room when recentring the focus date (Today / jump-to-date),
  // so a little past context shows to the left of it rather than it being flush.
  recenterLeftPad: 120,
}

export const laneLayout: LaneLayout = {
  barHeight: LAYOUT.barHeight,
  laneGap: LAYOUT.laneGap,
  rowPadding: LAYOUT.rowPadding,
}
