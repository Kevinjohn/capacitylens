import { isWeekdaySet } from "@capacitylens/shared/lib/accountWorkingDays";
import { isPresetColor } from "@capacitylens/shared/lib/color";
import {
  hasDisallowedChars,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeUserText,
  unicodeCharacterCount,
} from "@capacitylens/shared/lib/strings";
import { m } from "@/i18n";

// Share validation copy and resolve it during the call so every form follows the current locale.

type Fail = (field: string, message: string) => void;

interface TextOptions {
  /** Field key for fail()/aria wiring. Default 'name'. */
  field?: string;
  /** Empty (after trim) fails when true. Default true. */
  required?: boolean;
  /** Message used when a required field is empty. Default `m.validation_name_required()`. */
  requiredMessage?: string;
  /** Allow newlines (notes). Default false. */
  multiline?: boolean;
  /** Max length. Defaults to MAX_NAME_LENGTH (or MAX_NOTE_LENGTH when multiline). */
  maxLength?: number;
}

/**
 * Validate a user-entered text field: required-ness, no emoji / control / zero-width
 * characters (via the shared denylist), and a length cap. Returns the trimmed value on
 * success ('' for an allowed-empty optional field), or null after calling fail().
 */
export function parseText(value: string, fail: Fail, options: TextOptions = {}): string | null {
  const {
    field = "name",
    required = true,
    requiredMessage = m.validation_name_required(),
    multiline = false,
    maxLength = multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH,
  } = options;
  const canonical = value.normalize("NFC");
  const trimmed = normalizeUserText(canonical, { multiline });
  if (hasDisallowedChars(canonical, { multiline })) {
    fail(field, m.validation_text_invalid());
    return null;
  }
  if (!trimmed) {
    if (required) {
      fail(field, requiredMessage);
      return null;
    }
    return "";
  }
  if (unicodeCharacterCount(trimmed) > maxLength) {
    fail(field, m.validation_text_too_long());
    return null;
  }
  return trimmed;
}

/** Require a non-empty, clean name. Returns the trimmed value, or null after fail(). */
export function parseName(value: string, fail: Fail, field = "name"): string | null {
  return parseText(value, fail, { field, required: true });
}

/** Require a preset colour. Returns true if valid, else calls fail() and returns false. */
export function validatePresetColor(value: string, fail: Fail, field = "color"): boolean {
  if (!isPresetColor(value)) {
    fail(field, m.validation_hex_invalid());
    return false;
  }
  return true;
}

/** Rejects empty or invalid resource working-day sets and reports the field error. Store and server write boundaries independently enforce the same non-empty policy. */
export function validateWorkingDays(days: number[], fail: Fail, field = "workingDays"): boolean {
  // The shared predicate validates weekday shape; this form additionally requires a non-empty resource working week.
  if (!isWeekdaySet(days) || days.length === 0) {
    fail(field, m.validation_working_days_required());
    return false;
  }
  return true;
}
