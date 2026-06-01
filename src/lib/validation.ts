import { isHexColor } from '@floaty/shared/lib/color'
import { hasDisallowedChars, MAX_NAME_LENGTH, MAX_NOTE_LENGTH } from '@floaty/shared/lib/strings'

// Shared form-validation copy + helpers. Centralised so the same message isn't
// re-typed in every form (it was duplicated ~15 times across the CRUD forms).

export const VALIDATION = {
  nameRequired: 'Name is required.',
  hexInvalid: 'Enter a valid 6-digit hex colour, e.g. #3b82f6.',
  textInvalid: 'Remove emoji or special characters.',
  textTooLong: 'This is too long.',
} as const

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
    requiredMessage = VALIDATION.nameRequired,
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
  if (hasDisallowedChars(trimmed, { multiline })) {
    fail(field, VALIDATION.textInvalid)
    return null
  }
  if (trimmed.length > maxLength) {
    fail(field, VALIDATION.textTooLong)
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
  if (!isHexColor(value)) {
    fail(field, VALIDATION.hexInvalid)
    return false
  }
  return true
}
