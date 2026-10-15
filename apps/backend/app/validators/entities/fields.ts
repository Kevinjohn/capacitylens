import vine from '@vinejs/vine'
import { INTERNAL_CLIENT_COLOR } from '@capacitylens/shared/data/internalClient'
import { isWeekdaySet } from '@capacitylens/shared/lib/accountWorkingDays'
import { isPresetColor, NEUTRAL_COLOR } from '@capacitylens/shared/lib/color'
import { isValidISODate } from '@capacitylens/shared/lib/integrity'
import {
  hasDisallowedChars,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeUserText,
  unicodeCharacterCount,
} from '@capacitylens/shared/lib/strings'
import {
  CAPACITY_OVERVIEW_ACCESS_VALUES,
  DATE_STYLES,
  SCHEDULING_MODES,
} from '@capacitylens/shared/types/entities'
import { parseResourceAvatarUrl } from '@capacitylens/shared/domain/resourceAvatarUrl'
import type { AppDataKey } from '@capacitylens/shared/types/entities'
import { NULLABLE_FIELDS } from '@capacitylens/shared/types/nullableFields'

export type FieldKind =
  | 'identifier'
  | 'text'
  | 'note'
  | 'boolean'
  | 'number'
  | 'date'
  | 'weekdays'
  | 'color'
  | 'avatar'
  | 'timezone'
  | 'weekStart'
  | 'choice'

const choices: Record<string, readonly unknown[]> = {
  schedulingMode: SCHEDULING_MODES,
  capacityOverviewAccess: CAPACITY_OVERVIEW_ACCESS_VALUES,
  dateStyle: DATE_STYLES,
  language: ['en'],
  employmentType: ['permanent', 'freelancer', 'contractor'],
  engagement: ['studio', 'supplementary'],
  status: ['confirmed', 'tentative', 'completed'],
  type: ['holiday', 'sick', 'unpaid', 'other'],
}

const strictField = vine.createRule<{
  table: AppDataKey
  field: string
  kind: FieldKind
  row: Record<string, unknown>
}>(
  (value, { table, field, kind, row }, ctx) => {
    const fail = (reason: string) => ctx.report(`${field} ${reason}.`, 'entityField', ctx)
    if (value === undefined) return
    if (value === null) {
      if (field in NULLABLE_FIELDS[table]) return
      return fail('cannot be null')
    }
    if (kind === 'text' || kind === 'note') {
      if (typeof value !== 'string') return fail('must be text')
      const canonical = value.normalize('NFC')
      const multiline = kind === 'note'
      if (hasDisallowedChars(canonical, { multiline }))
        return fail('contains unsupported characters')
      if (
        unicodeCharacterCount(normalizeUserText(canonical, { multiline })) >
        (multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH)
      )
        return fail('is too long')
      if (field === 'name' && normalizeUserText(canonical).length === 0) return fail('is required')
      return
    }
    if (kind === 'boolean')
      return typeof value === 'boolean' ? undefined : fail('must be a boolean')
    if (kind === 'number') {
      if (typeof value !== 'number' || !Number.isFinite(value))
        return fail('must be a finite number')
      if (field === 'sortOrder' && !Number.isSafeInteger(value))
        return fail('must be a safe integer')
      if (field === 'hoursPerDay' && (value < 0 || value > 24))
        return fail('must be between 0 and 24')
      if (field === 'workingHoursPerDay' && (value <= 0 || value > 24))
        return fail('must be greater than 0 and at most 24')
      return
    }
    if (kind === 'date')
      return isValidISODate(value) ? undefined : fail('must be a valid calendar date (YYYY-MM-DD)')
    if (kind === 'weekdays') {
      if (!isWeekdaySet(value)) return fail('must contain distinct weekdays from 0 to 6')
      if (field === 'workingDays' && value.length === 0) return fail('must contain a working day')
      return
    }
    if (kind === 'weekStart')
      return value === 0 || value === 1 ? undefined : fail('must be Sunday or Monday')
    if (kind === 'choice') {
      const accepted =
        field === 'kind'
          ? table === 'activities'
            ? ['project', 'internal', 'repeatable']
            : ['person', 'placeholder', 'external']
          : choices[field]
      return accepted?.includes(value) ? undefined : fail('is not supported')
    }
    if (kind === 'color') {
      return isPresetColor(value) ||
        (table === 'resources' && row.kind === 'external' && value === NEUTRAL_COLOR) ||
        (table === 'clients' && row.builtin === true && value === INTERNAL_CLIENT_COLOR)
        ? undefined
        : fail('must be a preset colour')
    }
    if (kind === 'avatar') {
      const parsed = parseResourceAvatarUrl(value)
      return parsed === null || parsed === undefined
        ? ctx.report(
            'Avatar URL must be an HTTPS URL without embedded credentials.',
            'resource_avatar_url_invalid',
            ctx
          )
        : undefined
    }
    if (kind === 'timezone') {
      if (typeof value !== 'string' || value.length > 128)
        return fail('must be a supported time zone')
      try {
        new Intl.DateTimeFormat(undefined, { timeZone: value })
      } catch {
        return fail('must be a supported time zone')
      }
      return
    }
    return typeof value === 'string' &&
      value.length > 0 &&
      value.length <= 256 &&
      !/[\p{C}\s]/u.test(value)
      ? undefined
      : fail('must be a bounded identifier')
  },
  { name: 'entityField', implicit: true }
)

export function fieldSchema(
  table: AppDataKey,
  field: string,
  kind: FieldKind,
  row: Record<string, unknown>
) {
  return vine.any().optional().use(strictField({ table, field, kind, row }))
}
