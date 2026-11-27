import { describe, it, expect } from 'vitest'
import { LAYOUT, buildAllocationBarInset, SCHEDULER_LANE_LAYOUT } from './layout'
import { resolveRowHeightForLanes } from '@/lib/lanePacking'

describe('SCHEDULER_LANE_LAYOUT', () => {
  it('mirrors barHeight, laneGap and rowPadding from LAYOUT', () => {
    expect(SCHEDULER_LANE_LAYOUT).toEqual({
      barHeight: LAYOUT.barHeight,
      laneGap: LAYOUT.laneGap,
      rowPadding: LAYOUT.rowPadding,
    })
  })

  // The left column's identity band is pinned to exactly one lane band so the name/avatar stays
  // aligned with the first bar. If it ever diverges from rowHeightForLanes(1), the name will drift
  // off the bar it labels.
  it('keeps the identity band equal to a single-lane row', () => {
    expect(LAYOUT.identityBandHeight).toBe(resolveRowHeightForLanes(1, SCHEDULER_LANE_LAYOUT))
  })
})

describe('allocation bar inset geometry', () => {
  it("keeps the bar's rendered position and width inside its raw column span", () => {
    expect(buildAllocationBarInset(96, 336)).toEqual({ insetLeft: 101, insetWidth: 326 })
  })

  it('keeps narrow bars visible while limiting their inset to one third', () => {
    expect(buildAllocationBarInset(24, 3)).toEqual({ insetLeft: 25, insetWidth: 1 })
  })
})
