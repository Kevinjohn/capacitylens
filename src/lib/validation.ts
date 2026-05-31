import { isHexColor } from '@floaty/shared/lib/color'

// Shared form-validation copy + helpers. Centralised so the same message isn't
// re-typed in every form (it was duplicated ~15 times across the CRUD forms).

export const VALIDATION = {
  nameRequired: 'Name is required.',
  hexInvalid: 'Enter a valid 6-digit hex colour, e.g. #3b82f6.',
} as const

type Fail = (field: string, message: string) => void

/** Require a non-empty name. Returns the trimmed value, or null after calling fail(). */
export function validateName(value: string, fail: Fail, field = 'name'): string | null {
  const trimmed = value.trim()
  if (!trimmed) {
    fail(field, VALIDATION.nameRequired)
    return null
  }
  return trimmed
}

/** Require a 6-digit hex colour. Returns true if valid, else calls fail() and returns false. */
export function validateHex(value: string, fail: Fail, field = 'color'): boolean {
  if (!isHexColor(value)) {
    fail(field, VALIDATION.hexInvalid)
    return false
  }
  return true
}
