import { describe, it, expect, vi } from 'vitest'
import { validateName, validateHex, validateWorkingDays, validateText, validationMessages } from './validation'

describe('validateName', () => {
  it('returns the trimmed value for a clean name', () => {
    const fail = vi.fn()
    expect(validateName('  Acme  ', fail)).toBe('Acme')
    expect(fail).not.toHaveBeenCalled()
  })
  it('fails an empty/whitespace name', () => {
    const fail = vi.fn()
    expect(validateName('   ', fail)).toBeNull()
    expect(fail).toHaveBeenCalledWith('name', validationMessages().nameRequired)
  })
  it('rejects emoji / control junk', () => {
    const fail = vi.fn()
    expect(validateName(`Bad ${String.fromCodePoint(0x1f4a9)}`, fail)).toBeNull()
    expect(fail).toHaveBeenCalledWith('name', validationMessages().textInvalid)
  })
})

describe('validateText (optional fields)', () => {
  it('allows an empty value when not required', () => {
    const fail = vi.fn()
    expect(validateText('', fail, { required: false })).toBe('')
    expect(fail).not.toHaveBeenCalled()
  })
})

describe('validateHex', () => {
  it('accepts a 6-digit hex and rejects anything else', () => {
    const fail = vi.fn()
    expect(validateHex('#3b82f6', fail)).toBe(true)
    expect(validateHex('nope', fail)).toBe(false)
    expect(fail).toHaveBeenCalledWith('color', validationMessages().hexInvalid)
  })
})

describe('validateWorkingDays', () => {
  it('passes when at least one day is selected', () => {
    const fail = vi.fn()
    expect(validateWorkingDays([1, 2, 3], fail)).toBe(true)
    expect(fail).not.toHaveBeenCalled()
  })
  it('fails on an empty set and reports the field', () => {
    const fail = vi.fn()
    expect(validateWorkingDays([], fail)).toBe(false)
    expect(fail).toHaveBeenCalledWith('workingDays', validationMessages().workingDaysRequired)
  })
})
