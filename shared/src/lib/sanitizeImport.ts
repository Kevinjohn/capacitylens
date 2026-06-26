import { isHexColor } from './color'
import { cleanText } from './strings'
import { clampHoursPerDay, clampWorkingHoursPerDay, type ScopedEntityKey, type Weekday } from '../types/entities'

// Import is the one write path that bypasses the form validators (a hand-edited or
// corrupt file never went through them). The store already drops allocations/time-off
// with broken ranges or dangling refs; this repairs the *value*-level fields the forms
// would otherwise have guarded — so a negative/NaN hoursPerDay, a junk status enum, or
// a non-hex colour can't land in the store and render as broken geometry.

const FALLBACK_COLOR = '#6366f1' // brand
const VALID_STATUS = ['confirmed', 'tentative', 'completed'] as const
const VALID_KIND = ['person', 'placeholder', 'external'] as const
const VALID_ACTIVITY_KIND = ['project', 'internal', 'repeatable'] as const
const VALID_EMPLOYMENT = ['permanent', 'freelancer', 'contractor'] as const
const VALID_TIMEOFF = ['holiday', 'sick', 'unpaid', 'other'] as const

const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : fallback

// A RESOURCE's working day must be POSITIVE (a 0-hour working day has no capacity) — route
// it through the SHARED clampWorkingHoursPerDay so import and the store resource path agree
// (a finite value clamps to (0,24]; junk / <= 0 / a non-number falls back to a normal 8h day).
const clampHours = (v: unknown): number =>
  typeof v === 'number' ? clampWorkingHoursPerDay(v) : 8

// Allocation hours/day, unlike a resource's working day, may legitimately be 0 (a
// "blocks"-mode booking persists hoursPerDay: 0 — the span counts but the load doesn't).
// Route a finite value through the SHARED clampHoursPerDay so import and the store write
// boundary can never drift (a negative clamps to 0, not the fallback); only a missing /
// non-numeric / NaN value falls back to a normal 8h day.
const clampAllocHours = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? clampHoursPerDay(v) : fallback

// isHexColor trims before testing, so return the TRIMMED value — otherwise a padded
// '  #aabbcc  ' passes validation but is stored verbatim, and the colour math then
// NaN-fails on it and the bar renders the fallback grey (with the junk persisted).
const safeColor = (v: unknown, fallback = FALLBACK_COLOR): string =>
  typeof v === 'string' && isHexColor(v) ? v.trim() : fallback

const safeInt = (v: unknown, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fallback

// Repair a sloppily-formatted date to the canonical zero-padded "YYYY-MM-DD". The whole
// app relies on dates being zero-padded so they sort chronologically as strings (see
// isWithin), and the forms guarantee that — but a hand-edited import might carry
// "2026-6-1". Pad it so the record is KEPT (the alternative — validateDateRange dropping
// it — silently loses real data). A value that isn't a recognizable Y-M-D is left as-is
// for validateDateRange to reject. Real-calendar validity (e.g. month 13) is still its job.
const normalizeISODate = (v: unknown): unknown => {
  if (typeof v !== 'string') return v
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(v.trim())
  if (!m) return v
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
}

// DE-DUPLICATE: the scheduling math keys weekend-awareness on workingDays.length (a
// length-7 array means "works every calendar day"), so a duplicated set like
// [1,1,1,1,1,1,1] would otherwise reach length 7 and model a Monday-only resource as a
// 7-day worker. Collapse to the distinct sorted weekdays so length reflects real coverage.
const safeWorkingDays = (v: unknown): Weekday[] => {
  if (!Array.isArray(v)) return [1, 2, 3, 4, 5]
  const days = v.filter((d): d is Weekday => typeof d === 'number' && d >= 0 && d <= 6)
  const unique = [...new Set(days)].sort((a, b) => a - b)
  return unique.length ? unique : [1, 2, 3, 4, 5]
}

// Strip emoji / control / zero-width junk from a free-text field in place (the forms
// reject it; import can't, so it repairs). No-op on a missing/non-string field.
const cleanField = (rec: Record<string, unknown>, field: string, multiline = false): void => {
  if (typeof rec[field] === 'string') rec[field] = cleanText(rec[field] as string, { multiline })
}

// Like cleanField, but for a REQUIRED text column (the server schema marks these NOT NULL).
// Cleaning a hand-edited value can collapse it to empty (e.g. an emoji-only name), and a
// missing value is empty too — either would persist locally (localStorage has no NOT NULL)
// yet be REJECTED by the server, diverging the two import paths. Fall back to a placeholder
// so a required column is never empty and both paths accept the record identically.
const cleanRequiredField = (rec: Record<string, unknown>, field: string, fallback: string): void => {
  const cleaned = typeof rec[field] === 'string' ? cleanText(rec[field] as string) : ''
  rec[field] = cleaned.length > 0 ? cleaned : fallback
}

/** Sanitize the optional calendar fields of an account record in place.
 *  Called by the server write path; the import path doesn't re-import accounts. */
export function sanitizeAccount(rec: Record<string, unknown>): Record<string, unknown> {
  if (rec.timezone !== undefined) {
    if (typeof rec.timezone !== 'string') {
      delete rec.timezone
    } else {
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: rec.timezone as string })
      } catch {
        delete rec.timezone
      }
    }
  }
  if (rec.weekStartsOn !== undefined && rec.weekStartsOn !== 0 && rec.weekStartsOn !== 1) {
    delete rec.weekStartsOn
  }
  // Drop any language that isn't the one supported value ('en'). English-only until P1.5.1
  // (Paraglide); a hand-edited 'fr'/123/etc. must not persist — its absence reads back as 'en'.
  if (rec.language !== undefined && rec.language !== 'en') {
    delete rec.language
  }
  // Drop a non-boolean disciplinesEnabled rather than persist junk; its absence reads
  // back as the default (true) on the client.
  if (rec.disciplinesEnabled !== undefined && typeof rec.disciplinesEnabled !== 'boolean') {
    delete rec.disciplinesEnabled
  }
  // Drop a non-boolean placeholdersEnabled rather than persist junk; its absence reads
  // back as the default (false — hidden) on the client.
  if (rec.placeholdersEnabled !== undefined && typeof rec.placeholdersEnabled !== 'boolean') {
    delete rec.placeholdersEnabled
  }
  // Drop a non-boolean externalEnabled rather than persist junk; its absence reads
  // back as the default (false — hidden) on the client.
  if (rec.externalEnabled !== undefined && typeof rec.externalEnabled !== 'boolean') {
    delete rec.externalEnabled
  }
  return rec
}

/** Repair the value-level fields of one imported scoped record in place. The record
 *  has already had its id remapped + accountId stamped; we only touch constrained
 *  fields, leaving names/notes/refs alone. */
export function sanitizeImportedRecord(
  key: ScopedEntityKey,
  rec: Record<string, unknown>,
): Record<string, unknown> {
  switch (key) {
    case 'resources':
      rec.kind = oneOf(rec.kind, VALID_KIND, 'person')
      rec.employmentType = oneOf(rec.employmentType, VALID_EMPLOYMENT, 'permanent')
      rec.workingHoursPerDay = clampHours(rec.workingHoursPerDay)
      rec.workingDays = safeWorkingDays(rec.workingDays)
      rec.color = safeColor(rec.color)
      cleanField(rec, 'name') // resources.name is optional (nullable)
      cleanRequiredField(rec, 'role', 'Team member') // resources.role is NOT NULL
      break
    case 'allocations':
      rec.status = oneOf(rec.status, VALID_STATUS, 'confirmed')
      rec.hoursPerDay = clampAllocHours(rec.hoursPerDay, 8)
      rec.startDate = normalizeISODate(rec.startDate)
      rec.endDate = normalizeISODate(rec.endDate)
      cleanField(rec, 'note', true)
      break
    case 'timeOff':
      rec.type = oneOf(rec.type, VALID_TIMEOFF, 'other')
      rec.startDate = normalizeISODate(rec.startDate)
      rec.endDate = normalizeISODate(rec.endDate)
      cleanField(rec, 'note', true)
      break
    case 'disciplines':
      rec.sortOrder = safeInt(rec.sortOrder, 0)
      if (rec.color !== undefined) rec.color = safeColor(rec.color)
      cleanRequiredField(rec, 'name', 'Untitled') // name is NOT NULL
      break
    case 'clients':
      rec.color = safeColor(rec.color)
      cleanRequiredField(rec, 'name', 'Untitled') // name is NOT NULL
      // `builtin` is an OPTIONAL boolean (true only for the Internal pseudo-client). This is
      // DEFENSIVE NORMALISATION for a hand-edited / legacy file: drop anything that isn't strictly
      // `true` so junk (a string, 0, or an explicit `false`) can't persist — its absence reads back
      // as a normal client, and the round-trip omits the column rather than writing a NULL. (The code
      // itself never writes `false`; absent and false mean the same thing.) The import path
      // (remapAndValidateImport) does NOT remove imported builtins — it normalises them to exactly
      // one per account (keeps the FIRST, re-stamping its name/colour, and folds any duplicates into
      // it). This sanitiser still runs per-record there, so a kept builtin's flag survives untouched.
      if (rec.builtin !== true) delete rec.builtin
      break
    case 'projects':
      rec.color = safeColor(rec.color)
      cleanRequiredField(rec, 'name', 'Untitled') // name is NOT NULL
      break
    case 'phases':
      cleanRequiredField(rec, 'name', 'Untitled') // name is NOT NULL
      break
    case 'activities':
      cleanRequiredField(rec, 'name', 'Untitled') // name is NOT NULL
      // kind is NOT NULL. Default a missing/junk value from the only signal a legacy (pre-kind)
      // record carried: a project-bound activity is 'project', a project-less one is 'repeatable'
      // (the rename of "general"). The referential repair pass then strips any project/phase an
      // internal/repeatable activity carries, keeping kind ⇆ projectId coherent.
      rec.kind = oneOf(rec.kind, VALID_ACTIVITY_KIND, rec.projectId !== undefined ? 'project' : 'repeatable')
      break
    default: {
      // Exhaustiveness check: if a new ScopedEntityKey is added to the union without
      // a corresponding case above, this line will fail to compile.
      const _exhaustive: never = key
      void _exhaustive
      break
    }
  }
  return rec
}
