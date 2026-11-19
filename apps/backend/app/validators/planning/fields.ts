import vine from '@vinejs/vine';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import { isIsoTimestamp } from '@kevinjohn/adonisjs-lucid-checked-columns';
import { isWeekdaySet } from '@capacitylens/shared/lib/companyWorkingDays';
import { isPresetColor, NEUTRAL_COLOR } from '@capacitylens/shared/lib/color';
import { INTERNAL_CLIENT_COLOR } from '@capacitylens/shared/data/internalClient';
import { MAX_HOURS_PER_DAY } from '@capacitylens/shared/types/entities';
import type { FieldSpec } from '@capacitylens/shared/types/entityFields';
import { parseResourceAvatarUrl } from '@capacitylens/shared/domain/resourceAvatarUrl';
import {
  hasDisallowedChars,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeUserText,
  unicodeCharacterCount,
} from '@capacitylens/shared/lib/strings';

// Field rules, Vine field builders and intent-matching helpers shared by every planning validator
// and by the merged-row check in `row.ts`. Each bound is written once here; the request schemas and
// the merged-row check keep the sentences they report.

/** Why both layers refuse a text value, or nothing when it is acceptable. */
export function findTextProblem(value: string, multiline: boolean) {
  const canonical = value.normalize('NFC');
  if (hasDisallowedChars(canonical, { multiline })) return 'unsupported';
  const maximum = multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH;
  const length = unicodeCharacterCount(normalizeUserText(canonical, { multiline }));
  return length > maximum ? 'tooLong' : undefined;
}

/** A preset swatch, or the neutral or Internal client colour where the row allows it. */
export function isAcceptedColor(
  value: unknown,
  allow: { neutral?: boolean; internalClient?: boolean } = {}
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

/** The row facts that change a field rule: external resources and the built-in client. */
export interface RowRuleContext {
  externalResource: boolean;
  builtinClient: boolean;
}

/**
 * The merged-row check for one stored field: the refusal it reports, or nothing when the value is
 * acceptable. A missing value is not checked here; required fields are checked before.
 */
export function findFieldProblem(
  field: string,
  spec: FieldSpec,
  value: unknown,
  context: RowRuleContext
): { message: string; rule: string } | undefined {
  const fail = (reason: string) => ({ message: `${field} ${reason}.`, rule: 'entityField' });
  if (value === undefined) return undefined;
  if (value === null) return spec.nullable ? undefined : fail('cannot be null');
  switch (spec.kind) {
    case 'text':
    case 'note': {
      if (typeof value !== 'string') return fail('must be text');
      const problem = findTextProblem(value, spec.kind === 'note');
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
            rule: 'resource_avatar_url_invalid',
          }
        : undefined;
    }
    case 'timezone':
      return isSupportedTimeZone(value) ? undefined : fail('must be a supported time zone');
    case 'identifier':
      return typeof value === 'string' &&
        value.length > 0 &&
        value.length <= 256 &&
        !/[\p{C}\s]/u.test(value)
        ? undefined
        : fail('must be a bounded identifier');
  }
}

export const uuid = () => vine.string().uuid();
// Existing rows retain their stable identifiers during the transport transition.
/** The one entity id rule; the Internal client's generated id (`internal:<company id>`) needs the colon. */
export const ENTITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/;
export const entityId = () => vine.string().regex(ENTITY_ID_PATTERN);
export const number = () => vine.number({ strict: true });
export const boolean = () => vine.boolean({ strict: true });
export const userText = (multiline = false, required = false) =>
  vine.string().use(
    vine.createRule((value, _options, field) => {
      if (typeof value !== 'string') return;
      const problem = findTextProblem(value, multiline);
      if (problem === 'unsupported') {
        field.report('Text contains unsupported characters.', 'text', field);
        return;
      }
      if (required && normalizeUserText(value.normalize('NFC'), { multiline }).length === 0) {
        field.report('Text is required.', 'text', field);
        return;
      }
      if (problem === 'tooLong') field.report('Text is too long.', 'text', field);
    })()
  );
export const nullableUserText = (multiline = false) => userText(multiline).nullable();
export const nameText = () => userText(false, true);
export const nullableId = () => entityId().nullable();
export const calendarDate = () =>
  vine.string().use(
    vine.createRule((value, _options, field) => {
      if (typeof value === 'string' && isValidISODate(value)) return;
      field.report('The {{ field }} field must be a valid calendar date.', 'date', field);
    })()
  );
export const revision = () =>
  number()
    .min(0)
    .use(
      vine.createRule((value, _options, field) => {
        if (Number.isSafeInteger(value)) return;
        field.report('The {{ field }} field must be a safe integer.', 'safeInteger', field);
      })()
    );
export const hours = () => number().min(0).max(MAX_HOURS_PER_DAY);
const weekday = vine.enum([0, 1, 2, 3, 4, 5, 6] as const);
export const presetColor = (allowNeutral = false) =>
  vine.string().use(
    vine.createRule((value, _options, field) => {
      if (isAcceptedColor(value, { neutral: allowNeutral })) return;
      field.report('The color must be a preset color.', 'presetColor', field);
    })()
  );
export const resourceAvatar = () =>
  vine
    .string()
    .use(
      vine.createRule((value, _options, field) => {
        const parsed = parseResourceAvatarUrl(value);
        if (value === null || (parsed !== null && parsed !== undefined)) return;
        field.report('Avatar URL must be HTTPS without embedded credentials.', 'avatarUrl', field);
      })()
    )
    .nullable();
export const weekdays = () =>
  vine.array(weekday).use(
    vine.createRule((value, _options, field) => {
      if (isWeekdaySet(value)) return;
      field.report('Weekdays must be distinct values from 0 to 6.', 'weekdays', field);
    })()
  );

export const dateRange = vine.createRule((value, _options, field) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const { startDate, endDate } = value as { startDate?: unknown; endDate?: unknown };
  if (typeof startDate === 'string' && typeof endDate === 'string' && startDate > endDate) {
    field.report('The end date must be on or after the start date.', 'dateRange', field);
  }
});

export const hasOperation = (value: unknown, operation: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { operation?: unknown }).operation === operation;

export const hasOperationPrefix = (value: unknown, prefix: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as { operation?: unknown }).operation === 'string' &&
  (value as { operation: string }).operation.startsWith(prefix);

export const hasEntity = (value: unknown, entity: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { entity?: unknown }).entity === entity;

export const meta = () => ({
  mutationId: uuid(),
  baseRevision: revision(),
  confirmedRestorationCount: revision().optional(),
  /** The sending page's undo history; a page mints one when it loads and never stores it. */
  historyId: uuid().optional(),
  /**
   * The edited row's `updatedAt` when its form opened; an update refuses a row that has moved on.
   * Only the canonical `toISOString()` form passes, because the server compares it as a string.
   */
  expectedUpdatedAt: vine
    .string()
    .use(
      vine.createRule((value, _options, field) => {
        if (isIsoTimestamp(value)) return;
        field.report(
          'The {{ field }} field must be a UTC timestamp with milliseconds.',
          'timestamp',
          field
        );
      })()
    )
    .optional(),
});

export const requireChanges = (allowedFields: readonly string[]) =>
  vine.createRule((value, _options, field) => {
    if (
      value !== null &&
      typeof value === 'object' &&
      Object.keys(value).some((key) => allowedFields.includes(key))
    ) {
      return;
    }
    field.report('At least one writable field is required.', 'emptyChanges', field);
  })();

const hasKind = (value: unknown, kind: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { kind?: unknown }).kind === kind;

/** A repeat cadence, the wire form of the shared `RepeatPattern`. */
export const repeatPattern = () =>
  vine
    .union([
      vine.union.if(
        (value) => hasKind(value, 'weeks'),
        vine.object({ kind: vine.literal('weeks'), interval: vine.enum([1, 2, 3, 4] as const) })
      ),
      vine.union.if(
        (value) => hasKind(value, 'monthly-date'),
        vine.object({ kind: vine.literal('monthly-date') })
      ),
      vine.union.if(
        (value) => hasKind(value, 'monthly-last-weekday'),
        vine.object({ kind: vine.literal('monthly-last-weekday') })
      ),
    ])
    .otherwise((_value, field) =>
      field.report('Unsupported repeat pattern.', 'unsupportedPattern', field)
    );

/** A repeat's pattern and its inclusive last start date; the server generates the occurrences. */
export const repeatRange = () => vine.object({ pattern: repeatPattern(), until: calendarDate() });

/** Later occurrence ids must differ from the id of the first occurrence, held in `property`. */
export const occurrenceIdsExcludeFirst = (property: 'allocation' | 'timeOff') =>
  vine.createRule((value, _options, field) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    const { occurrenceIds } = value as { occurrenceIds?: unknown };
    const first = (value as Record<string, unknown>)[property] as { id?: unknown } | undefined;
    if (!Array.isArray(occurrenceIds) || !occurrenceIds.includes(first?.id)) return;
    field.report('Entity IDs must be unique.', 'distinctIds', field);
  })();

export const uniqueArrayIds = (property: 'ids' | 'occurrenceIds') =>
  vine.createRule((value, _options, field) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    const ids = (value as Record<string, unknown>)[property];
    if (!Array.isArray(ids)) return;
    if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      field.report('Entity IDs must be unique.', 'distinctIds', field);
    }
  })();
