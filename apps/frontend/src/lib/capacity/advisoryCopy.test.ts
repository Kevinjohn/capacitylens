import { describe, it, expect } from 'vitest'
import { formatCapacityAdvisory } from './advisoryCopy'

describe('formatCapacityAdvisory', () => {
  it('says nothing when neither count is set', () => {
    expect(formatCapacityAdvisory({ overDays: 0, timeOffDays: 0 }, 'toast')).toBe('')
    expect(formatCapacityAdvisory({ overDays: 0, timeOffDays: 0 }, 'form')).toBe('')
  })

  it('names the over-capacity bit before the time-off bit, joined and wrapped per surface', () => {
    expect(formatCapacityAdvisory({ overDays: 2, timeOffDays: 1 }, 'toast')).toBe(
      ' — now over capacity on 2 days and on time off for 1 day'
    )
    expect(formatCapacityAdvisory({ overDays: 1, timeOffDays: 0 }, 'form')).toBe(
      'Saved. This allocation is over capacity on 1 day.'
    )
  })

  it('counts allocations, not days, on the repeat surface', () => {
    expect(formatCapacityAdvisory({ overDays: 0, timeOffDays: 3 }, 'repeat')).toBe(
      'Saved. For this repeat, 3 allocations overlap time off.'
    )
  })

  it('appends the repeat-only non-effective-start count as the third sentence fragment', () => {
    expect(
      formatCapacityAdvisory(
        { overDays: 1, timeOffDays: 2, nonEffectiveStartAllocations: 3 },
        'repeat'
      )
    ).toBe(
      'Saved. For this repeat, 1 allocation exceeds capacity and 2 allocations overlap time off and 3 allocations start on a non-working day.'
    )
  })
})
