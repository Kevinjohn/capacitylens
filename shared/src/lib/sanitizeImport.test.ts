import { describe, it, expect } from 'vitest'
import { sanitizeImportedRecord } from './sanitizeImport'

describe('sanitizeImportedRecord', () => {
  it('repairs a resource with junk enum / numeric / colour fields', () => {
    const out = sanitizeImportedRecord('resources', {
      kind: 'wizard',
      employmentType: 'slave',
      workingHoursPerDay: -5,
      workingDays: 'nope',
      color: 'red',
    })
    expect(out).toMatchObject({
      kind: 'person',
      employmentType: 'permanent',
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      color: '#6366f1',
    })
  })

  it('clamps over-large hours and rejects NaN', () => {
    expect(sanitizeImportedRecord('resources', { workingHoursPerDay: 999 }).workingHoursPerDay).toBe(24)
    expect(sanitizeImportedRecord('allocations', { hoursPerDay: NaN }).hoursPerDay).toBe(8)
  })

  it('keeps valid values untouched', () => {
    const out = sanitizeImportedRecord('allocations', { status: 'tentative', hoursPerDay: 6 })
    expect(out).toMatchObject({ status: 'tentative', hoursPerDay: 6 })
  })

  it('falls back an invalid allocation status / time-off type to a safe default', () => {
    expect(sanitizeImportedRecord('allocations', { status: 'maybe' }).status).toBe('confirmed')
    expect(sanitizeImportedRecord('timeOff', { type: 'vacation' }).type).toBe('other')
  })

  it('leaves clean names and refs alone', () => {
    const out = sanitizeImportedRecord('tasks', { name: 'Build', projectId: 'p1' })
    expect(out).toEqual({ name: 'Build', projectId: 'p1' })
  })

  it('strips emoji / control junk from text fields but keeps refs', () => {
    const out = sanitizeImportedRecord('tasks', { name: `Build ${String.fromCodePoint(0x1f389)} it`, projectId: 'p1' })
    expect(out).toEqual({ name: 'Build it', projectId: 'p1' })

    const res = sanitizeImportedRecord('resources', {
      name: `Jos${String.fromCodePoint(0x1f4a9)}e`,
      role: `Design${String.fromCodePoint(0x200d)}er`,
    })
    expect(res.name).toBe('Jose')
    expect(res.role).toBe('Designer')

    const alloc = sanitizeImportedRecord('allocations', { note: `done ${String.fromCodePoint(0x2705)}` })
    expect(alloc.note).toBe('done')
  })
})
