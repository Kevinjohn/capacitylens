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
      color: '#2d75da',
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

  it('repairs a discipline sortOrder: junk / NaN → 0, keeps a valid integer', () => {
    expect(sanitizeImportedRecord('disciplines', { sortOrder: 5, name: 'D' }).sortOrder).toBe(5)
    expect(sanitizeImportedRecord('disciplines', { sortOrder: 'x', name: 'D' }).sortOrder).toBe(0)
    expect(sanitizeImportedRecord('disciplines', { sortOrder: NaN, name: 'D' }).sortOrder).toBe(0)
    expect(sanitizeImportedRecord('disciplines', { sortOrder: 1.5, name: 'D' }).sortOrder).toBe(0)
    expect(sanitizeImportedRecord('disciplines', { sortOrder: Number.MAX_SAFE_INTEGER + 1, name: 'D' }).sortOrder).toBe(0)
  })

  it('keeps only 0–6 integer weekdays, dropping out-of-range and non-numbers', () => {
    // Only real Weekday values survive: 7 / -1 / 9 / 'x' are all dropped, leaving [1].
    expect(sanitizeImportedRecord('resources', { workingDays: [1, 7, -1, 'x', 9] }).workingDays).toEqual([1])
    // 0 (Sun) and 6 (Sat) are INCLUSIVE bounds — a weekend-only week is legal, not clipped.
    expect(sanitizeImportedRecord('resources', { workingDays: [0, 3, 6] }).workingDays).toEqual([0, 3, 6])
    // an ARRAY that filters empty still falls back to Mon–Fri (not to [], which would model a
    // no-working-day resource).
    expect(sanitizeImportedRecord('resources', { workingDays: [9] }).workingDays).toEqual([1, 2, 3, 4, 5])
    expect(sanitizeImportedRecord('resources', { workingDays: [1.5, 2] }).workingDays).toEqual([2])
  })

  it('drops non-string optional text and non-boolean weekend flags', () => {
    expect(sanitizeImportedRecord('resources', { name: 42, role: 'R' }).name).toBeUndefined()
    expect(sanitizeImportedRecord('allocations', { note: {}, ignoreWeekends: 'false' })).not.toHaveProperty('note')
    expect(sanitizeImportedRecord('allocations', { ignoreWeekends: 'false' })).not.toHaveProperty('ignoreWeekends')
    expect(sanitizeImportedRecord('allocations', { ignoreWeekends: false }).ignoreWeekends).toBe(false)
  })

  it('repairs fields that are incoherent with the resource kind', () => {
    const person = sanitizeImportedRecord('resources', { kind: 'person', role: 'R', projectId: 'p1' })
    expect(person.projectId).toBeUndefined()

    const external = sanitizeImportedRecord('resources', {
      kind: 'external',
      role: 'Partner',
      disciplineId: 'd1',
      projectId: 'p1',
      employmentType: 'contractor',
      workingHoursPerDay: 12,
      workingDays: [1],
      color: '#abcdef',
    })
    expect(external).toMatchObject({
      employmentType: 'permanent',
      workingHoursPerDay: 8,
      workingDays: [1, 2, 3, 4, 5],
      color: '#9ca3af',
    })
    expect(external.disciplineId).toBeUndefined()
    expect(external.projectId).toBeUndefined()
  })

  it('keeps valid values untouched', () => {
    const out = sanitizeImportedRecord('allocations', { status: 'tentative', hoursPerDay: 6 })
    expect(out).toMatchObject({ status: 'tentative', hoursPerDay: 6 })
  })

  it('falls back an invalid allocation status / time-off type to a safe default', () => {
    expect(sanitizeImportedRecord('allocations', { status: 'maybe' }).status).toBe('confirmed')
    expect(sanitizeImportedRecord('timeOff', { type: 'vacation' }).type).toBe('other')
  })

  it('repairs a padded non-preset hex colour to the canonical default', () => {
    expect(sanitizeImportedRecord('clients', { color: '  #aAbBcC  ' }).color).toBe('#2d75da')
  })

  it('canonicalizes a padded preset colour and preserves it for an ordinary client', () => {
    expect(sanitizeImportedRecord('clients', { color: '  #5C34D4  ' }).color).toBe('#5c34d4')
  })

  it('falls back a malformed / overlong colour to the safe default', () => {
    expect(sanitizeImportedRecord('clients', { color: '#aabbccdd' }).color).toBe('#2d75da') // 8 digits
    expect(sanitizeImportedRecord('projects', { color: '#abc' }).color).toBe('#2d75da') // 3 digits
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

  it('normalizes ONLY a whole, trimmed Y-M-D string — not a partial or embedded match', () => {
    // trims surrounding whitespace before matching
    expect(sanitizeImportedRecord('allocations', { startDate: '  2026-6-1  ' }).startDate).toBe('2026-06-01')
    // pads a 1-digit month even when the day is already 2 digits (the whole string must match)
    expect(sanitizeImportedRecord('allocations', { startDate: '2026-6-12' }).startDate).toBe('2026-06-12')
    // a prefixed / suffixed value is NOT a date — it's left verbatim for validateDateRange to reject,
    // never partially rewritten from an embedded match.
    expect(sanitizeImportedRecord('allocations', { startDate: 'x2026-6-1' }).startDate).toBe('x2026-6-1')
    expect(sanitizeImportedRecord('allocations', { startDate: '2026-6-1x' }).startDate).toBe('2026-6-1x')
  })

  it('backfills a project-less activity’s kind to repeatable (a project-bound one to project)', () => {
    expect(sanitizeImportedRecord('activities', { name: 'Admin' }).kind).toBe('repeatable')
    expect(sanitizeImportedRecord('activities', { name: 'Wires', projectId: 'p1' }).kind).toBe('project')
  })

  it('leaves clean names and refs alone, backfilling activity kind from projectId', () => {
    const out = sanitizeImportedRecord('activities', { name: 'Build', projectId: 'p1' })
    expect(out).toEqual({ name: 'Build', kind: 'project', projectId: 'p1' })
  })

  it('falls back a REQUIRED text column (per entity) to its placeholder when empty / missing', () => {
    // The server marks these NOT NULL; an emoji-only or absent value collapses to '' locally,
    // so each case supplies the right field name + placeholder so both import paths agree.
    expect(sanitizeImportedRecord('clients', {}).name).toBe('Untitled')
    expect(sanitizeImportedRecord('clients', { name: '💩' }).name).toBe('Untitled')
    expect(sanitizeImportedRecord('projects', { name: '' }).name).toBe('Untitled')
    expect(sanitizeImportedRecord('phases', { name: '' }).name).toBe('Untitled')
    expect(sanitizeImportedRecord('activities', { name: '' }).name).toBe('Untitled')
    expect(sanitizeImportedRecord('disciplines', { name: '' }).name).toBe('Untitled')
    expect(sanitizeImportedRecord('resources', { role: '' }).role).toBe('Team member')
  })

  it('cleans a single-line name (collapsing newlines) but preserves newlines in multiline notes', () => {
    // resources.name uses the DEFAULT (single-line) mode — a newline collapses to a space...
    expect(sanitizeImportedRecord('resources', { name: 'a\nb', role: 'r' }).name).toBe('a b')
    // ...whereas allocation / time-off NOTES are multiline, so a newline is preserved.
    expect(sanitizeImportedRecord('allocations', { note: 'a\nb' }).note).toBe('a\nb')
    expect(sanitizeImportedRecord('timeOff', { note: 'a\nb' }).note).toBe('a\nb')
    // and a note is still stripped of emoji junk (proving the cleaned field really is 'note')
    expect(sanitizeImportedRecord('timeOff', { note: 'done ✅' }).note).toBe('done')
  })

  it('repairs a discipline colour only when present (an absent colour stays absent)', () => {
    expect(sanitizeImportedRecord('disciplines', { name: 'D' }).color).toBeUndefined()
    expect(sanitizeImportedRecord('disciplines', { name: 'D', color: 'notahex' }).color).toBe('#2d75da')
  })

  it('drops a non-true builtin flag on an imported client, keeping only an explicit true', () => {
    expect(sanitizeImportedRecord('clients', { name: 'C', builtin: 'yes' }).builtin).toBeUndefined()
    expect(sanitizeImportedRecord('clients', { name: 'C', builtin: false }).builtin).toBeUndefined()
    expect(sanitizeImportedRecord('clients', { name: 'C', builtin: true }).builtin).toBe(true)
  })

  it.each(['clients', 'projects'] as const)('%s keeps a coherent private code-name pair', (key) => {
    expect(sanitizeImportedRecord(key, {
      name: 'Real name',
      isPrivate: true,
      codeName: '  “Northstar”  ',
    })).toMatchObject({ isPrivate: true, codeName: 'Northstar' })

    const publicRow = sanitizeImportedRecord(key, {
      name: 'Public name',
      isPrivate: false,
      codeName: 'Must be removed',
    })
    expect(publicRow).not.toHaveProperty('isPrivate')
    expect(publicRow).not.toHaveProperty('codeName')
  })

  it.each(['clients', 'projects'] as const)('%s repairs a private row with no usable code name', (key) => {
    expect(sanitizeImportedRecord(key, { name: 'Real name', isPrivate: true, codeName: '""' }).codeName)
      .toBe('Confidential')
    expect(sanitizeImportedRecord(key, { name: 'Real name', isPrivate: true, codeName: 42 }).codeName)
      .toBe('Confidential')
  })

  it('never allows the built-in Internal client to become private', () => {
    const out = sanitizeImportedRecord('clients', {
      name: 'Internal',
      builtin: true,
      color: '#5c34d4',
      isPrivate: true,
      codeName: 'Hidden internal',
    })
    expect(out).not.toHaveProperty('isPrivate')
    expect(out).not.toHaveProperty('codeName')
    expect(out.color).toBe('#2d75da')
  })

  it('does NOT give a phase an activity kind (its case must not fall through to activities)', () => {
    expect(sanitizeImportedRecord('phases', { name: 'Build' })).toEqual({ name: 'Build' })
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

  // Lifecycle timestamps (archivedAt / deletedAt — P2.1) are optional ISO strings on
  // resources / clients / projects; a valid string is kept, anything non-string is dropped
  // (its absence reads back as active / not-deleted). Inert plumbing today.
  describe.each(['resources', 'clients', 'projects'] as const)('%s lifecycle timestamps (P2.1)', (key) => {
    it('keeps valid ISO-string archivedAt / deletedAt', () => {
      const out = sanitizeImportedRecord(key, {
        archivedAt: '2026-01-01T00:00:00.000Z',
        deletedAt: '2026-06-01T12:00:00.000Z',
      })
      expect(out.archivedAt).toBe('2026-01-01T00:00:00.000Z')
      expect(out.deletedAt).toBe('2026-06-01T12:00:00.000Z')
    })

    it('drops a non-string archivedAt / deletedAt', () => {
      const out = sanitizeImportedRecord(key, { archivedAt: 123, deletedAt: null })
      expect(out.archivedAt).toBeUndefined()
      expect(out.deletedAt).toBeUndefined()
    })

    it('canonicalizes valid timestamps and rejects impossible lifecycle ordering', () => {
      const canonical = sanitizeImportedRecord(key, {
        archivedAt: '2026-01-01T01:00:00+01:00',
        deletedAt: '2026-02-01T00:00:00Z',
      })
      expect(canonical.archivedAt).toBe('2026-01-01T00:00:00.000Z')
      expect(canonical.deletedAt).toBe('2026-02-01T00:00:00.000Z')

      const deletedWithoutArchive = sanitizeImportedRecord(key, { deletedAt: '2026-02-01T00:00:00Z' })
      expect(deletedWithoutArchive.deletedAt).toBeUndefined()

      const deletedBeforeArchive = sanitizeImportedRecord(key, {
        archivedAt: '2026-02-01T00:00:00Z',
        deletedAt: '2026-01-01T00:00:00Z',
      })
      expect(deletedBeforeArchive.archivedAt).toBe('2026-02-01T00:00:00.000Z')
      expect(deletedBeforeArchive.deletedAt).toBeUndefined()

      const emptyTimestamps = sanitizeImportedRecord(key, { archivedAt: '   ', deletedAt: '' })
      expect(emptyTimestamps.archivedAt).toBeUndefined()
      expect(emptyTimestamps.deletedAt).toBeUndefined()

      const invalidDeletion = sanitizeImportedRecord(key, {
        archivedAt: '2026-02-01T00:00:00Z',
        deletedAt: 'not-a-timestamp',
      })
      expect(invalidDeletion.archivedAt).toBe('2026-02-01T00:00:00.000Z')
      expect(invalidDeletion.deletedAt).toBeUndefined()

      const sameTimestamp = sanitizeImportedRecord(key, {
        archivedAt: '2026-02-01T00:00:00Z',
        deletedAt: '2026-02-01T00:00:00Z',
      })
      expect(sameTimestamp.deletedAt).toBe('2026-02-01T00:00:00.000Z')
    })
  })
})

describe('sanitizeAccount', () => {
  it('strips an invalid timezone', () => {
    const rec = { timezone: 'Not/A/Zone' }
    sanitizeAccount(rec)
    expect(rec.timezone).toBeUndefined()
  })

  it('strips a non-string timezone even if it stringifies to a valid zone (type-guard, not coercion)', () => {
    // Only a real string may be kept: the `typeof !== 'string'` branch must strip an object,
    // NOT fall through to Intl (which would String()-coerce it to a valid zone and keep junk).
    const rec: Record<string, unknown> = { timezone: { toString: () => 'Europe/London' } }
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

  it('keeps the two Internal colour modes and drops unknown values to the grey-by-absence default', () => {
    expect(sanitizeAccount({ internalColourMode: 'grey' }).internalColourMode).toBe('grey')
    expect(sanitizeAccount({ internalColourMode: 'palette' }).internalColourMode).toBe('palette')
    expect(sanitizeAccount({ internalColourMode: 'rainbow' }).internalColourMode).toBeUndefined()
    expect(sanitizeAccount({ internalColourMode: 1 }).internalColourMode).toBeUndefined()
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
