import { describe, expect, it } from 'vitest'
import { resolveTimeOffRepeatPattern } from './repeatingTimeOff'

describe('resolveTimeOffRepeatPattern', () => {
  it('maps every visible cadence to a shared calendar rule', () => {
    expect([
      resolveTimeOffRepeatPattern('weekly'),
      resolveTimeOffRepeatPattern('every-two-weeks'),
      resolveTimeOffRepeatPattern('every-three-weeks'),
      resolveTimeOffRepeatPattern('every-four-weeks'),
      resolveTimeOffRepeatPattern('monthly-date'),
      resolveTimeOffRepeatPattern('monthly-last-weekday'),
    ]).toEqual([
      { kind: 'weeks', interval: 1 },
      { kind: 'weeks', interval: 2 },
      { kind: 'weeks', interval: 3 },
      { kind: 'weeks', interval: 4 },
      { kind: 'monthly-date' },
      { kind: 'monthly-last-weekday' },
    ])
  })
})
