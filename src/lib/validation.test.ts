import { describe, it, expect, vi } from 'vitest'
import { validateName, validateHex, validateWorkingDays, validateText, validationMessages } from './validation'
import { MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '@capacitylens/shared/lib/strings'

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

  it('reports failures against the custom field name passed through, not the "name" default', () => {
    const fail = vi.fn()
    expect(validateName('   ', fail, 'discipline')).toBeNull()
    expect(fail).toHaveBeenCalledWith('discipline', validationMessages().nameRequired)
  })
})

describe('validateText (optional fields)', () => {
  it('allows an empty value when not required', () => {
    const fail = vi.fn()
    expect(validateText('', fail, { required: false })).toBe('')
    expect(fail).not.toHaveBeenCalled()
  })

  it('defaults the field to "name" when no options are given', () => {
    const fail = vi.fn()
    expect(validateText('   ', fail)).toBeNull() // default required: true, so blank fails
    expect(fail).toHaveBeenCalledWith('name', validationMessages().nameRequired)
  })

  it('defaults required to true when no options are given', () => {
    const fail = vi.fn()
    expect(validateText('', fail, {})).toBeNull()
    expect(fail).toHaveBeenCalledWith('name', validationMessages().nameRequired)
  })

  it('defaults multiline to false, so newlines are disallowed by default', () => {
    const fail = vi.fn()
    expect(validateText('line1\nline2', fail)).toBeNull()
    expect(fail).toHaveBeenCalledWith('name', validationMessages().textInvalid)
  })

  it('allows newlines when multiline is explicitly true', () => {
    const fail = vi.fn()
    expect(validateText('line1\nline2', fail, { multiline: true })).toBe('line1\nline2')
    expect(fail).not.toHaveBeenCalled()
  })

  it('defaults maxLength to MAX_NAME_LENGTH for single-line text', () => {
    const fail = vi.fn()
    const atLimit = 'a'.repeat(MAX_NAME_LENGTH)
    const overLimit = 'a'.repeat(MAX_NAME_LENGTH + 1)
    expect(validateText(atLimit, fail)).toBe(atLimit) // exactly at cap: NOT too long
    expect(fail).not.toHaveBeenCalled()
    expect(validateText(overLimit, fail)).toBeNull() // one over: too long
    expect(fail).toHaveBeenCalledWith('name', validationMessages().textTooLong)
  })

  it('defaults maxLength to MAX_NOTE_LENGTH when multiline', () => {
    const fail = vi.fn()
    const atLimit = 'a'.repeat(MAX_NOTE_LENGTH)
    expect(validateText(atLimit, fail, { multiline: true })).toBe(atLimit)
    expect(fail).not.toHaveBeenCalled()
  })

  it('is not "too long" exactly AT maxLength (strict > boundary), but is one char over', () => {
    const fail = vi.fn()
    expect(validateText('a'.repeat(10), fail, { maxLength: 10 })).toBe('a'.repeat(10))
    expect(fail).not.toHaveBeenCalled()
    fail.mockClear()
    expect(validateText('a'.repeat(11), fail, { maxLength: 10 })).toBeNull()
    expect(fail).toHaveBeenCalledWith('name', validationMessages().textTooLong)
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
