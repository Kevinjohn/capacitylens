import { isIsoInstant } from '../account/types.js';
import { isValidISODate, parseISOTimestamp } from '../lib/isoDates.js';
import { isWeekdaySet } from '../lib/companyWorkingDays.js';
import { isPresetColor, NEUTRAL_COLOR } from '../lib/color.js';
import { INTERNAL_CLIENT_COLOR } from '../data/internalClient.js';
import { parseResourceAvatarUrl } from '../domain/resourceAvatarUrl.js';
import {
  hasDisallowedChars,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeUserText,
  countUnicodeCharacters,
} from '../lib/strings.js';
import { MAX_HOURS_PER_DAY } from './entityKeys.js';
import type { FieldSpec } from './entityFields.js';

// The value rule of each field kind in `ENTITY_FIELDS`, shared by the backend's stored-row check
// and the company import, so a field follows one rule wherever its value arrives.

/** The one entity id rule; the Internal client's generated id (`internal:<company id>`) needs the colon. */
export const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;

/** Return whether a value is an entity id the typed planning routes accept. */
export const isEntityId = (value: unknown): value is string =>
  typeof value === 'string' && ENTITY_ID_PATTERN.test(value);

/** Why a text value is refused, or nothing when it is acceptable. */
export function findTextProblem(
  value: string,
  multiline: boolean,
  maximum = multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH,
) {
  const canonical = value.normalize('NFC');
  if (hasDisallowedChars(canonical, { multiline })) return 'unsupported';
  const length = countUnicodeCharacters(normalizeUserText(canonical, { multiline }));
  return length > maximum ? 'tooLong' : undefined;
}

/** A preset swatch, or the neutral or Internal client colour where the row allows it. */
export function isAcceptedColor(
  value: unknown,
  allow: { neutral?: boolean; internalClient?: boolean } = {},
) {
  return (
    isPresetColor(value) ||
    (allow.neutral === true && value === NEUTRAL_COLOR) ||
    (allow.internalClient === true && value === INTERNAL_CLIENT_COLOR)
  );
}

/** A time zone name of at most 128 characters that the runtime accepts. */
export function isSupportedTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 128) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The row facts that change a field rule. */
export interface RowRuleContext {
  externalResource: boolean;
  builtinClient: boolean;
  /** A redacted export's private client or project name: its code name in quotation marks. */
  quotedCodeName?: boolean;
}

/**
 * The rule for one stored field: the refusal it reports, or nothing when the value is acceptable.
 * A missing value is not checked here; required fields are checked before.
 */
export function findFieldProblem(
  field: string,
  spec: FieldSpec,
  value: unknown,
  context: RowRuleContext,
): { message: string; rule: string } | undefined {
  const fail = (reason: string) => ({ message: `${field} ${reason}.`, rule: 'entityField' });
  if (value === undefined) return undefined;
  if (value === null) return spec.nullable ? undefined : fail('cannot be null');
  switch (spec.kind) {
    case 'text':
    case 'note': {
      if (typeof value !== 'string') return fail('must be text');
      const multiline = spec.kind === 'note';
      // The redacted projection adds two quotation marks to the stored code name.
      const problem =
        field === 'name' && context.quotedCodeName === true
          ? findTextProblem(value, multiline, MAX_NAME_LENGTH + 2)
          : findTextProblem(value, multiline);
      if (problem === 'unsupported') return fail('contains unsupported characters');
      if (problem === 'tooLong') return fail('is too long');
      if (field === 'name' && normalizeUserText(value.normalize('NFC')).length === 0) {
        return fail('is required');
      }
      return undefined;
    }
    case 'boolean':
      return typeof value === 'boolean' ? undefined : fail('must be a boolean');
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail('must be a finite number');
      }
      if (field === 'sortOrder' && !Number.isSafeInteger(value)) {
        return fail('must be a safe integer');
      }
      if (field === 'hoursPerDay' && (value < 0 || value > MAX_HOURS_PER_DAY)) {
        return fail(`must be between 0 and ${MAX_HOURS_PER_DAY}`);
      }
      if (field === 'workingHoursPerDay' && (value <= 0 || value > MAX_HOURS_PER_DAY)) {
        return fail(`must be greater than 0 and at most ${MAX_HOURS_PER_DAY}`);
      }
      return undefined;
    case 'date':
      return isValidISODate(value) ? undefined : fail('must be a valid calendar date (YYYY-MM-DD)');
    case 'timestamp':
      // The canonical form the models store; any other spelling of the instant is refused here,
      // so a document the write would refuse never passes its check. The parser also has to read
      // it, because the lifecycle reads a tombstone through it and refuses years outside 0001-9999.
      return isIsoInstant(value) && parseISOTimestamp(value) !== null
        ? undefined
        : fail('must be a UTC timestamp with milliseconds');
    case 'weekdays':
      if (!isWeekdaySet(value)) return fail('must contain distinct weekdays from 0 to 6');
      if (field === 'workingDays' && value.length === 0) return fail('must contain a working day');
      return undefined;
    case 'weekStart':
      return value === 0 || value === 1 ? undefined : fail('must be Sunday or Monday');
    case 'choice':
      return spec.choices?.includes(value as string | number)
        ? undefined
        : fail('is not supported');
    case 'color':
      return isAcceptedColor(value, {
        neutral: context.externalResource,
        internalClient: context.builtinClient,
      })
        ? undefined
        : fail('must be a preset colour');
    case 'avatar': {
      const parsed = parseResourceAvatarUrl(value);
      return parsed === null || parsed === undefined
        ? {
            message: 'Avatar URL must be an HTTPS URL without embedded credentials.',
            rule: 'E_RESOURCE_AVATAR_URL_INVALID',
          }
        : undefined;
    }
    case 'timezone':
      return isSupportedTimeZone(value) ? undefined : fail('must be a supported time zone');
    case 'identifier':
      return isEntityId(value) ? undefined : fail('must be a bounded identifier');
  }
}
