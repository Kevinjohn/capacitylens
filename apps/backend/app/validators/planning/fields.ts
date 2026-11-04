import vine from '@vinejs/vine';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
import { isWeekdaySet } from '@capacitylens/shared/lib/accountWorkingDays';
import { isPresetColor, NEUTRAL_COLOR } from '@capacitylens/shared/lib/color';
import { parseResourceAvatarUrl } from '@capacitylens/shared/domain/resourceAvatarUrl';
import {
  hasDisallowedChars,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeUserText,
  unicodeCharacterCount,
} from '@capacitylens/shared/lib/strings';

// Vine field builders and intent-matching helpers shared by every planning validator.

export const uuid = () => vine.string().uuid();
// Existing rows retain their stable identifiers during the transport transition.
export const entityId = () => vine.string().regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]{0,127}$/);
export const number = () => vine.number({ strict: true });
export const boolean = () => vine.boolean({ strict: true });
export const userText = (multiline = false, required = false) =>
  vine.string().use(
    vine.createRule((value, _options, field) => {
      if (typeof value !== 'string') return;
      const canonical = value.normalize('NFC');
      if (hasDisallowedChars(canonical, { multiline })) {
        field.report('Text contains unsupported characters.', 'text', field);
        return;
      }
      const maximum = multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH;
      const normalized = normalizeUserText(canonical, { multiline });
      if (required && normalized.length === 0) {
        field.report('Text is required.', 'text', field);
        return;
      }
      if (unicodeCharacterCount(normalized) > maximum) {
        field.report('Text is too long.', 'text', field);
      }
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
export const hours = () => number().min(0).max(24);
const weekday = vine.enum([0, 1, 2, 3, 4, 5, 6] as const);
export const presetColor = (allowNeutral = false) =>
  vine.string().use(
    vine.createRule((value, _options, field) => {
      if (isPresetColor(value) || (allowNeutral && value === NEUTRAL_COLOR)) return;
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

export const operationMatches = (value: unknown, operation: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { operation?: unknown }).operation === operation;

export const operationStartsWith = (value: unknown, prefix: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as { operation?: unknown }).operation === 'string' &&
  (value as { operation: string }).operation.startsWith(prefix);

export const entityMatches = (value: unknown, entity: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { entity?: unknown }).entity === entity;

export const meta = () => ({
  mutationId: uuid(),
  baseRevision: revision(),
  confirmedRestorationCount: revision().optional(),
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

export const uniqueArrayIds = (property: 'ids' | 'entries' | 'allocations') =>
  vine.createRule((value, _options, field) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    const items = (value as Record<string, unknown>)[property];
    if (!Array.isArray(items)) return;
    const ids = items.map((item) =>
      property === 'ids'
        ? item
        : item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as { id?: unknown }).id
          : undefined
    );
    if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      field.report('Entity IDs must be unique.', 'distinctIds', field);
    }
  })();
