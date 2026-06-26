import { describe, it, expect } from 'vitest'
import { sanitizeImportedRecord, sanitizeAccount } from './sanitizeImport'

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

  it('clamps a NEGATIVE allocation hours/day to 0 (matching the store clamp), not the fallback', () => {
    // import + store share one clampHoursPerDay, so a finite out-of-range value clamps to
    // the [0,24] floor rather than diverging to the import fallback.
    expect(sanitizeImportedRecord('allocations', { hoursPerDay: -3 }).hoursPerDay).toBe(0)
  })

  it('de-duplicates a resource’s working days so length reflects real coverage', () => {
    // [1×7] must NOT reach length 7 (which the scheduling math reads as a full 7-day
    // week and flips weekend-awareness off) — a Monday-only resource stays Monday-only.
    expect(sanitizeImportedRecord('resources', { workingDays: [1, 1, 1, 1, 1, 1, 1] }).workingDays).toEqual([1])
    expect(sanitizeImportedRecord('resources', { workingDays: [5, 1, 3, 1, 5] }).workingDays).toEqual([1, 3, 5])
  })

  it('keeps valid values untouched', () => {
    const out = sanitizeImportedRecord('allocations', { status: 'tentative', hoursPerDay: 6 })
    expect(out).toMatchObject({ status: 'tentative', hoursPerDay: 6 })
  })

  it('falls back an invalid allocation status / time-off type to a safe default', () => {
    expect(sanitizeImportedRecord('allocations', { status: 'maybe' }).status).toBe('confirmed')
    expect(sanitizeImportedRecord('timeOff', { type: 'vacation' }).type).toBe('other')
  })

  it('trims a padded hex colour rather than storing it verbatim', () => {
    // isHexColor trims before validating, so a padded value passes — but it must be
    // STORED trimmed, else downstream colour math NaN-fails on the whitespace.
    expect(sanitizeImportedRecord('clients', { color: '  #aAbBcC  ' }).color).toBe('#aAbBcC')
  })

  it('falls back a malformed / overlong colour to the safe default', () => {
    expect(sanitizeImportedRecord('clients', { color: '#aabbccdd' }).color).toBe('#6366f1') // 8 digits
    expect(sanitizeImportedRecord('projects', { color: '#abc' }).color).toBe('#6366f1') // 3 digits
  })

  it('normalizes sloppily-padded dates to canonical YYYY-MM-DD so the record is kept', () => {
    const a = sanitizeImportedRecord('allocations', { startDate: '2026-6-1', endDate: '2026-12-5' })
    expect(a.startDate).toBe('2026-06-01')
    expect(a.endDate).toBe('2026-12-05')
    const t = sanitizeImportedRecord('timeOff', { startDate: '2026-1-9', endDate: '2026-1-9' })
    expect(t.startDate).toBe('2026-01-09')
    // Already-canonical stays put; a non-date string is left for validateDateRange to reject.
    expect(sanitizeImportedRecord('allocations', { startDate: '2026-06-01' }).startDate).toBe('2026-06-01')
    expect(sanitizeImportedRecord('allocations', { startDate: 'nope' }).startDate).toBe('nope')
  })

  it('leaves clean names and refs alone, backfilling activity kind from projectId', () => {
    const out = sanitizeImportedRecord('activities', { name: 'Build', projectId: 'p1' })
    expect(out).toEqual({ name: 'Build', kind: 'project', projectId: 'p1' })
  })

  it('strips emoji / control junk from text fields but keeps refs', () => {
    const out = sanitizeImportedRecord('activities', { name: `Build ${String.fromCodePoint(0x1f389)} it`, projectId: 'p1' })
    expect(out).toEqual({ name: 'Build it', kind: 'project', projectId: 'p1' })

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

describe('sanitizeAccount', () => {
  it('strips an invalid timezone', () => {
    const rec = { timezone: 'Not/A/Zone' }
    sanitizeAccount(rec)
    expect(rec.timezone).toBeUndefined()
  })

  it('keeps a valid IANA timezone', () => {
    const rec = { timezone: 'Europe/London' }
    sanitizeAccount(rec)
    expect(rec.timezone).toBe('Europe/London')
  })

  it('strips a non-string timezone', () => {
    const rec: Record<string, unknown> = { timezone: 42 }
    sanitizeAccount(rec)
    expect(rec.timezone).toBeUndefined()
  })

  it('strips weekStartsOn values that are not 0 or 1', () => {
    expect(sanitizeAccount({ weekStartsOn: 2 }).weekStartsOn).toBeUndefined()
    expect(sanitizeAccount({ weekStartsOn: 'monday' }).weekStartsOn).toBeUndefined()
    expect(sanitizeAccount({ weekStartsOn: null }).weekStartsOn).toBeUndefined()
  })

  it('keeps weekStartsOn = 0 or 1', () => {
    expect(sanitizeAccount({ weekStartsOn: 0 }).weekStartsOn).toBe(0)
    expect(sanitizeAccount({ weekStartsOn: 1 }).weekStartsOn).toBe(1)
  })

  it('strips a non-boolean disciplinesEnabled', () => {
    expect(sanitizeAccount({ disciplinesEnabled: 'yes' }).disciplinesEnabled).toBeUndefined()
    expect(sanitizeAccount({ disciplinesEnabled: 1 }).disciplinesEnabled).toBeUndefined()
    expect(sanitizeAccount({ disciplinesEnabled: null }).disciplinesEnabled).toBeUndefined()
  })

  it('keeps a boolean disciplinesEnabled', () => {
    expect(sanitizeAccount({ disciplinesEnabled: false }).disciplinesEnabled).toBe(false)
    expect(sanitizeAccount({ disciplinesEnabled: true }).disciplinesEnabled).toBe(true)
  })

  it('strips a non-boolean placeholdersEnabled', () => {
    expect(sanitizeAccount({ placeholdersEnabled: 'yes' }).placeholdersEnabled).toBeUndefined()
    expect(sanitizeAccount({ placeholdersEnabled: 1 }).placeholdersEnabled).toBeUndefined()
    expect(sanitizeAccount({ placeholdersEnabled: null }).placeholdersEnabled).toBeUndefined()
  })

  it('keeps a boolean placeholdersEnabled', () => {
    expect(sanitizeAccount({ placeholdersEnabled: false }).placeholdersEnabled).toBe(false)
    expect(sanitizeAccount({ placeholdersEnabled: true }).placeholdersEnabled).toBe(true)
  })

  it('strips a non-boolean externalEnabled', () => {
    expect(sanitizeAccount({ externalEnabled: 'yes' }).externalEnabled).toBeUndefined()
    expect(sanitizeAccount({ externalEnabled: 1 }).externalEnabled).toBeUndefined()
    expect(sanitizeAccount({ externalEnabled: null }).externalEnabled).toBeUndefined()
  })

  it('keeps a boolean externalEnabled', () => {
    expect(sanitizeAccount({ externalEnabled: false }).externalEnabled).toBe(false)
    expect(sanitizeAccount({ externalEnabled: true }).externalEnabled).toBe(true)
  })

  it('drops a language that is not the supported value (English-only until P1.5.1)', () => {
    expect(sanitizeAccount({ language: 'fr' }).language).toBeUndefined()
    expect(sanitizeAccount({ language: 123 }).language).toBeUndefined()
    expect(sanitizeAccount({ language: null }).language).toBeUndefined()
  })

  it("keeps language === 'en'", () => {
    expect(sanitizeAccount({ language: 'en' }).language).toBe('en')
  })
})
