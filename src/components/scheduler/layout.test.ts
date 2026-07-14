import { describe, it, expect } from 'vitest'
import { LAYOUT, laneLayout } from './layout'

// laneLayout is the LaneLayout projection of LAYOUT handed to lanePacking (packLanes / laneTop /
// rowHeightForLanes) — schedulerModel.ts wires it through unmodified. Pin its shape directly so a
// regression collapsing it to an empty object (losing barHeight/laneGap/rowPadding) is caught here
// rather than surfacing as mysterious zero-height lanes downstream.
describe('laneLayout', () => {
  it('mirrors barHeight, laneGap and rowPadding from LAYOUT', () => {
    expect(laneLayout).toEqual({
      barHeight: LAYOUT.barHeight,
      laneGap: LAYOUT.laneGap,
      rowPadding: LAYOUT.rowPadding,
    })
  })
})
