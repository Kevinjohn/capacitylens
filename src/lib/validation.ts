import { isPresetColor } from '@capacitylens/shared/lib/color'
import { hasDisallowedChars, MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '@capacitylens/shared/lib/strings'
import { m } from '@/i18n'

// Shared form-validation copy + helpers. Centralised so the same message isn't
// re-typed in every form (it was duplicated ~15 times across the CRUD forms).
//
// i18n: the copy resolves through Paraglide (`@/i18n`). This is a GETTER (not a const object) so each
// message re-resolves the active locale at validation time — a const captured at module load would
// freeze the import-time language (the locale can switch without reload). Mirrors metadata.ts /
// introCopy.ts. The validators below call `m.*()` directly; this getter is the catalogue view used by
// tests + any caller that wants the whole set.
export function validationMessages() {
  return {
    nameRequired: m.validation_name_required(),
    hexInvalid: m.validation_hex_invalid(),
    textInvalid: m.validation_text_invalid(),
    textTooLong: m.validation_text_too_long(),
    workingDaysRequired: m.validation_working_days_required(),
  }
}

type Fail = (field: string, message: string) => void

interface TextOptions {
  /** Field key for fail()/aria wiring. Default 'name'. */
  field?: string
  /** Empty (after trim) fails when true. Default true. */
  required?: boolean
  /** Message used when a required field is empty. Default VALIDATION.nameRequired. */
  requiredMessage?: string
  /** Allow newlines (notes). Default false. */
  multiline?: boolean
  /** Max length. Defaults to MAX_NAME_LENGTH (or MAX_NOTE_LENGTH when multiline). */
  maxLength?: number
}

/**
 * Validate a user-entered text field: required-ness, no emoji / control / zero-width
 * characters (via the shared denylist), and a length cap. Returns the trimmed value on
 * success ('' for an allowed-empty optional field), or null after calling fail().
 */
export function validateText(value: string, fail: Fail, options: TextOptions = {}): string | null {
  const {
    field = 'name',
    required = true,
    requiredMessage = m.validation_name_required(),
    multiline = false,
    maxLength = multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH,
  } = options
  const trimmed = value.trim()
  if (!trimmed) {
    if (required) {
      fail(field, requiredMessage)
      return null
    }
    return ''
  }
  // Length cap FIRST, before the denylist scan: a unicode-property regex shouldn't run on an
  // unbounded string. Defence-in-depth — the denylist isn't ReDoS-prone today, but bounding the
  // input keeps it that way. Outcome-identical: an over-long string fails either way, and only a
  // string that's BOTH over-long AND has junk changes message (now "too long" — caps win first).
  if (trimmed.length > maxLength) {
    fail(field, m.validation_text_too_long())
    return null
  }
  if (hasDisallowedChars(trimmed, { multiline })) {
    fail(field, m.validation_text_invalid())
    return null
  }
  return trimmed
}

/** Require a non-empty, clean name. Returns the trimmed value, or null after fail(). */
export function validateName(value: string, fail: Fail, field = 'name'): string | null {
  return validateText(value, fail, { field, required: true })
}

/** Require a 6-digit hex colour. Returns true if valid, else calls fail() and returns false. */
export function validateHex(value: string, fail: Fail, field = 'color'): boolean {
  if (!isPresetColor(value)) {
    fail(field, m.validation_hex_invalid())
    return false
  }
  return true
}

/** Require at least one working day. A resource with zero working days has zero capacity
 *  every day (reads as permanently over-allocated), so the form must reject it — the
 *  import path repairs an empty set, but the form is the only path that could persist one. */
export function validateWorkingDays(days: number[], fail: Fail, field = 'workingDays'): boolean {
  if (
    !Array.isArray(days) ||
    days.length === 0 ||
    new Set(days).size !== days.length ||
    days.some((day) => !Number.isInteger(day) || day < 0 || day > 6)
  ) {
    fail(field, m.validation_working_days_required())
    return false
  }
  return true
}
