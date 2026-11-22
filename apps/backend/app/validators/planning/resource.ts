import vine from '@vinejs/vine';
import {
  EMPLOYMENT_TYPES,
  MAX_HOURS_PER_DAY,
  RESOURCE_ENGAGEMENTS,
  RESOURCE_KINDS,
} from '@capacitylens/shared/types/entities';
import {
  buildExternalCapacityDefaults,
  buildPlaceholderCapacityDefaults,
} from '@capacitylens/shared/types/entities';
import {
  parseFixedWorkingPattern,
  areHalfDaysWithinWorkingDays,
  isSameWeekdays,
} from '@capacitylens/shared/domain/resourceWorkingPattern';
import { NEUTRAL_COLOR } from '@capacitylens/shared/lib/color';
import { normalizeUserText } from '@capacitylens/shared/lib/strings';
import {
  boolean,
  calendarDate,
  entityId,
  nullableId,
  nullableUserText,
  number,
  hasOperation,
  presetColor,
  requireChanges,
  resourceAvatar,
  userText,
  uuid,
  weekdays,
} from '#validators/planning/fields';

const resourceFields = {
  kind: vine.enum(RESOURCE_KINDS),
  name: nullableUserText(),
  jobTitle: userText(),
  avatarUrl: resourceAvatar(),
  disciplineId: nullableId(),
  employmentType: vine.enum(EMPLOYMENT_TYPES),
  engagement: vine.enum(RESOURCE_ENGAGEMENTS),
  workingHoursPerDay: number()
    .max(MAX_HOURS_PER_DAY)
    .use(
      vine.createRule((value, _options, field) => {
        if (typeof value === 'number' && value > 0) return;
        field.report('Working hours must be greater than zero.', 'positiveHours', field);
      })()
    ),
  workingDays: weekdays(),
  halfDays: weekdays(),
  projectId: nullableId(),
  color: presetColor(true),
  isFavourite: boolean().nullable(),
  firstAvailableDate: calendarDate().nullable(),
  lastAvailableDate: calendarDate().nullable(),
};
export const resourceChanges = {
  name: resourceFields.name.optional(),
  jobTitle: resourceFields.jobTitle.optional(),
  avatarUrl: resourceFields.avatarUrl.optional(),
  disciplineId: resourceFields.disciplineId.optional(),
  employmentType: resourceFields.employmentType.optional(),
  engagement: resourceFields.engagement.optional(),
  workingHoursPerDay: resourceFields.workingHoursPerDay.optional(),
  workingDays: weekdays().minLength(1).optional(),
  halfDays: resourceFields.halfDays.optional(),
  projectId: resourceFields.projectId.optional(),
  color: resourceFields.color.optional(),
  isFavourite: resourceFields.isFavourite.optional(),
  firstAvailableDate: resourceFields.firstAvailableDate.optional(),
  lastAvailableDate: resourceFields.lastAvailableDate.optional(),
};

export const resourceIntent = vine.union([
  vine.union.if(
    (value) => hasOperation(value, 'resource.create'),
    vine.object({
      operation: vine.literal('resource.create'),
      id: uuid(),
      fields: vine.object(resourceFields).use(
        vine.createRule((value, _options, field) => {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
          const fields = value as Record<string, unknown>;
          if (
            fields.kind === 'person' &&
            Array.isArray(fields.workingDays) &&
            fields.workingDays.length === 0
          ) {
            field.report('A person must have at least one working day.', 'workingDays', field);
          }
          if (
            fields.kind !== 'placeholder' &&
            (typeof fields.name !== 'string' || normalizeUserText(fields.name).length === 0)
          ) {
            field.report('A person or external resource name is required.', 'name', field);
          }
          if (
            typeof fields.firstAvailableDate === 'string' &&
            typeof fields.lastAvailableDate === 'string' &&
            fields.firstAvailableDate > fields.lastAvailableDate
          ) {
            field.report(
              'First available date cannot follow last available date.',
              'dateRange',
              field
            );
          }
          if (fields.kind === 'external' && fields.color !== NEUTRAL_COLOR) {
            field.report('External resources must use the neutral color.', 'resourceColor', field);
          }
          const defaults =
            fields.kind === 'external'
              ? buildExternalCapacityDefaults()
              : fields.kind === 'placeholder'
                ? buildPlaceholderCapacityDefaults()
                : undefined;
          const pattern = parseFixedWorkingPattern(fields.kind);
          for (const key of ['workingDays', 'halfDays'] as const) {
            if (pattern && !isSameWeekdays(fields[key], pattern[key])) {
              field.report(`${key} must match the resource kind defaults.`, key, field);
            }
          }
          if (defaults) {
            const defaultValues = defaults as unknown as Record<string, unknown>;
            if (
              fields.kind === 'external' &&
              (fields.employmentType !== defaultValues.employmentType ||
                fields.engagement !== defaultValues.engagement ||
                fields.workingHoursPerDay !== defaultValues.workingHoursPerDay)
            ) {
              field.report(
                'External capacity fields must match defaults.',
                'externalDefaults',
                field
              );
            }
            if (fields.kind === 'placeholder' && fields.engagement !== 'studio') {
              field.report('Placeholder engagement must match defaults.', 'engagement', field);
            }
          }
          const halfDays = fields.halfDays;
          const workingDays = fields.workingDays;
          if (
            Array.isArray(halfDays) &&
            Array.isArray(workingDays) &&
            !areHalfDaysWithinWorkingDays(workingDays, halfDays)
          ) {
            field.report('Half days must be included in working days.', 'halfDays', field);
          }
        })()
      ),
    })
  ),
  vine.union.if(
    (value) => hasOperation(value, 'resource.update'),
    vine.object({
      operation: vine.literal('resource.update'),
      id: entityId(),
      changes: vine
        .object(resourceChanges)
        // `kind` cannot change after create, so the writable list here leaves it out.
        .use(requireChanges(Object.keys(resourceChanges)))
        .use(
          vine.createRule((value, _options, field) => {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
            const changes = value as Record<string, unknown>;
            const halfDays = changes.halfDays;
            const workingDays = changes.workingDays;
            if (
              Array.isArray(halfDays) &&
              Array.isArray(workingDays) &&
              !areHalfDaysWithinWorkingDays(workingDays, halfDays)
            ) {
              field.report('Half days must be included in working days.', 'halfDays', field);
            }
          })()
        ),
    })
  ),
  vine.union.else(
    vine.object({
      operation: vine.enum(['resource.archive', 'resource.restore'] as const),
      id: entityId(),
    })
  ),
]);
