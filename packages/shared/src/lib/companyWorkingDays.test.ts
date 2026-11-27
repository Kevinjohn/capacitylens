import { describe, expect, it } from 'vitest'
import {
  buildDefaultCompanyWorkingDays,
  isWeekday,
  isWeekdaySet,
  normalizeCompanyWorkingDays,
  listOrderedWeekdays,
} from './companyWorkingDays.js'

describe('company working days', () => {
  it('defaults to the first five days of the configured week', () => {
    expect(buildDefaultCompanyWorkingDays(1)).toEqual([1, 2, 3, 4, 5])
    expect(buildDefaultCompanyWorkingDays(0)).toEqual([0, 1, 2, 3, 4])
  })

  it("repairs empty and malformed selections to the configured week's default", () => {
    expect(normalizeCompanyWorkingDays([5, 1, 5], 1)).toEqual([1, 5])
    expect(normalizeCompanyWorkingDays([], 1)).toEqual([1, 2, 3, 4, 5])
    expect(normalizeCompanyWorkingDays([], 0)).toEqual([0, 1, 2, 3, 4])
    expect(normalizeCompanyWorkingDays([1, 7], 1)).toEqual([1, 2, 3, 4, 5])
    expect(normalizeCompanyWorkingDays('weekdays', 0)).toEqual([0, 1, 2, 3, 4])
  })

  it.each([-1, 7, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'repairs a selection containing the invalid day %s',
    (invalidDay) => {
      expect(normalizeCompanyWorkingDays([0, invalidDay, 6], 1)).toEqual([1, 2, 3, 4, 5])
      expect(normalizeCompanyWorkingDays([0, invalidDay, 6], 0)).toEqual([0, 1, 2, 3, 4])
    }
  )

  it('accepts both weekday boundaries and returns a deduplicated canonical set', () => {
    expect(normalizeCompanyWorkingDays([6, 0, 3, 6, 0], 1)).toEqual([0, 3, 6])
  })

  it('recognises only whole-number days inside the week', () => {
    expect([0, 3, 6].every(isWeekday)).toBe(true)
    for (const invalid of [
      -1,
      7,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      '1',
      null,
      undefined,
    ]) {
      expect(isWeekday(invalid)).toBe(false)
    }
  })

  it('recognises a distinct weekday set, empty included, and rejects duplicates or non-arrays', () => {
    expect(isWeekdaySet([])).toBe(true)
    expect(isWeekdaySet([5, 1, 0])).toBe(true)
    expect(isWeekdaySet([1, 1])).toBe(false)
    expect(isWeekdaySet([1, 7])).toBe(false)
    expect(isWeekdaySet('weekdays')).toBe(false)
  })

  it('orders the same saved set from the configured week start', () => {
    expect(listOrderedWeekdays(1)).toEqual([1, 2, 3, 4, 5, 6, 0])
    expect(listOrderedWeekdays(0)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })
})

it('rejects sparse weekday input at both unknown-input boundaries', () => {
  const leading = new Array<number>(2)
  leading[1] = 1
  const middle = new Array<number>(3)
  middle[0] = 1
  middle[2] = 5
  for (const days of [new Array<number>(1), leading, middle]) {
    expect(isWeekdaySet(days)).toBe(false)
    expect(normalizeCompanyWorkingDays(days, 0)).toEqual([0, 1, 2, 3, 4])
  }
})
