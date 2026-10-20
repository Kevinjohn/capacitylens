import vine from '@vinejs/vine'
import type { Infer } from '@vinejs/vine/types'
import {
  externalCapacityDefaults,
  placeholderCapacityDefaults,
} from '@capacitylens/shared/types/entities'
import type {
  Account,
  Activity,
  Allocation,
  AppDataKey,
  Client,
  Closure,
  Discipline,
  Phase,
  Project,
  Resource,
  TimeOff,
} from '@capacitylens/shared/types/entities'
import { isValidISODate } from '@capacitylens/shared/lib/integrity'
import { isWeekdaySet } from '@capacitylens/shared/lib/accountWorkingDays'
import { isPresetColor, NEUTRAL_COLOR } from '@capacitylens/shared/lib/color'
import { parseResourceAvatarUrl } from '@capacitylens/shared/domain/resourceAvatarUrl'
import {
  hasDisallowedChars,
  MAX_NAME_LENGTH,
  MAX_NOTE_LENGTH,
  normalizeUserText,
  unicodeCharacterCount,
} from '@capacitylens/shared/lib/strings'

const uuid = () => vine.string().uuid()
const number = () => vine.number({ strict: true })
const boolean = () => vine.boolean({ strict: true })
const userText = (multiline = false, required = false) =>
  vine.string().use(
    vine.createRule((value, _options, field) => {
      if (typeof value !== 'string') return
      const canonical = value.normalize('NFC')
      if (hasDisallowedChars(canonical, { multiline })) {
        field.report('Text contains unsupported characters.', 'text', field)
        return
      }
      const maximum = multiline ? MAX_NOTE_LENGTH : MAX_NAME_LENGTH
      const normalized = normalizeUserText(canonical, { multiline })
      if (required && normalized.length === 0) {
        field.report('Text is required.', 'text', field)
        return
      }
      if (unicodeCharacterCount(normalized) > maximum) {
        field.report('Text is too long.', 'text', field)
      }
    })()
  )
const nullableUserText = (multiline = false) => userText(multiline).nullable()
const nameText = () => userText(false, true)
const nullableId = () => uuid().nullable()
const calendarDate = () =>
  vine.string().use(
    vine.createRule((value, _options, field) => {
      if (typeof value === 'string' && isValidISODate(value)) return
      field.report('The {{ field }} field must be a valid calendar date.', 'date', field)
    })()
  )
const revision = () =>
  number()
    .min(0)
    .use(
      vine.createRule((value, _options, field) => {
        if (Number.isSafeInteger(value)) return
        field.report('The {{ field }} field must be a safe integer.', 'safeInteger', field)
      })()
    )
const hours = () => number().min(0).max(24)
const weekday = vine.enum([0, 1, 2, 3, 4, 5, 6] as const)
const presetColor = (allowNeutral = false) =>
  vine.string().use(
    vine.createRule((value, _options, field) => {
      if (isPresetColor(value) || (allowNeutral && value === NEUTRAL_COLOR)) return
      field.report('The color must be a preset color.', 'presetColor', field)
    })()
  )
const resourceAvatar = () =>
  vine
    .string()
    .use(
      vine.createRule((value, _options, field) => {
        const parsed = parseResourceAvatarUrl(value)
        if (value === null || (parsed !== null && parsed !== undefined)) return
        field.report('Avatar URL must be HTTPS without embedded credentials.', 'avatarUrl', field)
      })()
    )
    .nullable()
const weekdays = () =>
  vine.array(weekday).use(
    vine.createRule((value, _options, field) => {
      if (isWeekdaySet(value)) return
      field.report('Weekdays must be distinct values from 0 to 6.', 'weekdays', field)
    })()
  )

const dateRange = vine.createRule((value, _options, field) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  const { startDate, endDate } = value as { startDate?: unknown; endDate?: unknown }
  if (typeof startDate === 'string' && typeof endDate === 'string' && startDate > endDate) {
    field.report('The end date must be on or after the start date.', 'dateRange', field)
  }
})

const operationMatches = (value: unknown, operation: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { operation?: unknown }).operation === operation

const operationStartsWith = (value: unknown, prefix: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  typeof (value as { operation?: unknown }).operation === 'string' &&
  (value as { operation: string }).operation.startsWith(prefix)

const entityMatches = (value: unknown, entity: string): boolean =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (value as { entity?: unknown }).entity === entity

const meta = () => ({ mutationId: uuid(), baseRevision: revision() })

const allocationCreate = vine
  .object({
    id: uuid(),
    resourceId: uuid(),
    activityId: uuid(),
    projectId: nullableId().optional(),
    startDate: calendarDate(),
    endDate: calendarDate(),
    hoursPerDay: hours(),
    status: vine.enum(['confirmed', 'tentative', 'completed'] as const),
    note: nullableUserText(true).optional(),
    task: nullableUserText().optional(),
    ignoreWeekends: boolean().nullable().optional(),
  })
  .use(dateRange())

const allocationChanges = vine
  .object({
    resourceId: uuid().optional(),
    activityId: uuid().optional(),
    projectId: nullableId().optional(),
    startDate: calendarDate().optional(),
    endDate: calendarDate().optional(),
    hoursPerDay: hours().optional(),
    status: vine.enum(['confirmed', 'tentative', 'completed'] as const).optional(),
    note: nullableUserText(true).optional(),
    task: nullableUserText().optional(),
    ignoreWeekends: boolean().nullable().optional(),
  })
  .use(dateRange())

const requireChanges = (allowedFields: readonly string[]) =>
  vine.createRule((value, _options, field) => {
    if (
      value !== null &&
      typeof value === 'object' &&
      Object.keys(value).some((key) => allowedFields.includes(key))
    )
      return
    field.report('At least one writable field is required.', 'emptyChanges', field)
  })()

const occurrence = vine
  .object({ id: uuid(), startDate: calendarDate(), endDate: calendarDate() })
  .use(dateRange())

const distinctOccurrenceIds = vine.createRule((value, _options, field) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  const { sourceAllocationId, occurrences } = value as {
    sourceAllocationId?: unknown
    occurrences?: unknown
  }
  if (!Array.isArray(occurrences) || typeof sourceAllocationId !== 'string') return
  const ids = occurrences.map((item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? (item as { id?: unknown }).id
      : undefined
  )
  if (
    ids.some((id) => typeof id !== 'string' || id === sourceAllocationId) ||
    new Set(ids).size !== ids.length
  ) {
    field.report(
      'Occurrence IDs must be distinct from the source and each other.',
      'distinctIds',
      field
    )
  }
})

const uniqueArrayIds = (property: 'ids' | 'entries') =>
  vine.createRule((value, _options, field) => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return
    const items = (value as Record<string, unknown>)[property]
    if (!Array.isArray(items)) return
    const ids = items.map((item) =>
      property === 'ids'
        ? item
        : item !== null && typeof item === 'object' && !Array.isArray(item)
          ? (item as { id?: unknown }).id
          : undefined
    )
    if (ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      field.report('Entity IDs must be unique.', 'distinctIds', field)
    }
  })()

const duplicateIdIsDistinct = vine.createRule((value, _options, field) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return
  const { sourceAllocationId, occurrence: duplicate } = value as {
    sourceAllocationId?: unknown
    occurrence?: { id?: unknown }
  }
  if (
    typeof sourceAllocationId === 'string' &&
    typeof duplicate?.id === 'string' &&
    sourceAllocationId !== duplicate.id
  )
    return
  field.report('The duplicated allocation must have a new ID.', 'distinctIds', field)
})

const allocationIntent = vine
  .union([
    vine.union.if(
      (value) => operationMatches(value, 'allocation.create'),
      vine.object({ operation: vine.literal('allocation.create'), allocation: allocationCreate })
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.update'),
      vine.object({
        operation: vine.literal('allocation.update'),
        id: uuid(),
        changes: allocationChanges.use(
          requireChanges([
            'resourceId',
            'activityId',
            'projectId',
            'startDate',
            'endDate',
            'hoursPerDay',
            'status',
            'note',
            'task',
            'ignoreWeekends',
          ])
        ),
      })
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.delete'),
      vine.object({ operation: vine.literal('allocation.delete'), id: uuid() })
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.deleteGroup'),
      vine
        .object({
          operation: vine.literal('allocation.deleteGroup'),
          ids: vine.array(uuid()).minLength(1),
        })
        .use(uniqueArrayIds('ids'))
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.duplicate'),
      vine
        .object({
          operation: vine.literal('allocation.duplicate'),
          sourceAllocationId: uuid(),
          occurrence,
        })
        .use(duplicateIdIsDistinct())
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.repeat'),
      vine
        .object({
          operation: vine.literal('allocation.repeat'),
          sourceAllocationId: uuid(),
          occurrences: vine.array(occurrence).minLength(1),
        })
        .use(distinctOccurrenceIds())
    ),
  ])
  .otherwise((_value, field) =>
    field.report('Unsupported allocation operation.', 'unsupportedOperation', field)
  )

export const allocationMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: allocationIntent })
)

const nameAndColor = { name: nameText(), color: presetColor() }
const privateName = { isPrivate: boolean().nullable(), codeName: nullableUserText() }

const catalogueCreate = vine.union([
  vine.union.if(
    (value) => entityMatches(value, 'clients'),
    vine.object({
      entity: vine.literal('clients'),
      id: uuid(),
      fields: vine.object({ ...nameAndColor, ...privateName }),
    })
  ),
  vine.union.if(
    (value) => entityMatches(value, 'projects'),
    vine.object({
      entity: vine.literal('projects'),
      id: uuid(),
      fields: vine.object({ ...nameAndColor, ...privateName, clientId: uuid() }),
    })
  ),
  vine.union.if(
    (value) => entityMatches(value, 'phases'),
    vine.object({
      entity: vine.literal('phases'),
      id: uuid(),
      fields: vine.object({ name: nameText(), projectId: uuid() }),
    })
  ),
  vine.union.if(
    (value) => entityMatches(value, 'activities'),
    vine.object({
      entity: vine.literal('activities'),
      id: uuid(),
      fields: vine.object({
        name: nameText(),
        kind: vine.enum(['project', 'internal', 'repeatable'] as const),
        projectId: nullableId(),
        phaseId: nullableId(),
      }),
    })
  ),
  vine.union.else(
    vine.object({
      entity: vine.literal('disciplines'),
      id: uuid(),
      fields: vine.object({
        name: nameText(),
        color: presetColor().nullable(),
        sortOrder: number().use(
          vine.createRule((value, _options, field) => {
            if (Number.isSafeInteger(value)) return
            field.report('Sort order must be a safe integer.', 'safeInteger', field)
          })()
        ),
      }),
    })
  ),
])

const catalogueChanges = vine.union([
  vine.union.if(
    (value) => entityMatches(value, 'clients'),
    vine.object({
      entity: vine.literal('clients'),
      id: uuid(),
      changes: vine
        .object({
          name: nameText().optional(),
          color: presetColor().optional(),
          isPrivate: boolean().nullable().optional(),
          codeName: nullableUserText().optional(),
        })
        .use(requireChanges(['name', 'color', 'isPrivate', 'codeName'])),
    })
  ),
  vine.union.if(
    (value) => entityMatches(value, 'projects'),
    vine.object({
      entity: vine.literal('projects'),
      id: uuid(),
      changes: vine
        .object({
          name: nameText().optional(),
          color: presetColor().optional(),
          clientId: uuid().optional(),
          isPrivate: boolean().nullable().optional(),
          codeName: nullableUserText().optional(),
        })
        .use(requireChanges(['name', 'color', 'clientId', 'isPrivate', 'codeName'])),
    })
  ),
  vine.union.if(
    (value) => entityMatches(value, 'phases'),
    vine.object({
      entity: vine.literal('phases'),
      id: uuid(),
      changes: vine
        .object({
          name: nameText().optional(),
          projectId: uuid().optional(),
        })
        .use(requireChanges(['name', 'projectId'])),
    })
  ),
  vine.union.if(
    (value) => entityMatches(value, 'activities'),
    vine.object({
      entity: vine.literal('activities'),
      id: uuid(),
      changes: vine
        .object({
          name: nameText().optional(),
          kind: vine.enum(['project', 'internal', 'repeatable'] as const).optional(),
          projectId: nullableId().optional(),
          phaseId: nullableId().optional(),
        })
        .use(requireChanges(['name', 'kind', 'projectId', 'phaseId'])),
    })
  ),
  vine.union.else(
    vine.object({
      entity: vine.literal('disciplines'),
      id: uuid(),
      changes: vine
        .object({
          name: nameText().optional(),
          color: presetColor().nullable().optional(),
          sortOrder: number()
            .use(
              vine.createRule((value, _options, field) => {
                if (Number.isSafeInteger(value)) return
                field.report('Sort order must be a safe integer.', 'safeInteger', field)
              })()
            )
            .optional(),
        })
        .use(requireChanges(['name', 'color', 'sortOrder'])),
    })
  ),
])

const catalogueDelete = vine.union([
  vine.union.if(
    (value) => entityMatches(value, 'phases'),
    vine.object({ entity: vine.literal('phases'), id: uuid() })
  ),
  vine.union.else(vine.object({ entity: vine.literal('disciplines'), id: uuid() })),
])

const catalogueIntent = vine.union([
  vine.union.if(
    (value) => operationMatches(value, 'catalogue.create'),
    vine.object({ operation: vine.literal('catalogue.create'), entity: catalogueCreate })
  ),
  vine.union.if(
    (value) => operationMatches(value, 'catalogue.update'),
    vine.object({ operation: vine.literal('catalogue.update'), entity: catalogueChanges })
  ),
  vine.union.else(
    vine.object({ operation: vine.literal('catalogue.delete'), entity: catalogueDelete })
  ),
])

export const catalogueMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: catalogueIntent })
)

const resourceFields = {
  kind: vine.enum(['person', 'placeholder', 'external'] as const),
  name: nullableUserText(),
  role: userText(),
  avatarUrl: resourceAvatar(),
  disciplineId: nullableId(),
  employmentType: vine.enum(['permanent', 'freelancer', 'contractor'] as const),
  engagement: vine.enum(['studio', 'supplementary'] as const),
  workingHoursPerDay: number()
    .max(24)
    .use(
      vine.createRule((value, _options, field) => {
        if (typeof value === 'number' && value > 0) return
        field.report('Working hours must be greater than zero.', 'positiveHours', field)
      })()
    ),
  workingDays: weekdays(),
  halfDays: weekdays(),
  projectId: nullableId(),
  color: presetColor(true),
  isFavourite: boolean().nullable(),
  firstAvailableDate: calendarDate().nullable(),
  lastAvailableDate: calendarDate().nullable(),
}
const resourceChanges = {
  name: resourceFields.name.optional(),
  role: resourceFields.role.optional(),
  avatarUrl: resourceFields.avatarUrl.optional(),
  disciplineId: resourceFields.disciplineId.optional(),
  employmentType: resourceFields.employmentType.optional(),
  engagement: resourceFields.engagement.optional(),
  workingHoursPerDay: resourceFields.workingHoursPerDay.optional(),
  workingDays: resourceFields.workingDays.optional(),
  halfDays: resourceFields.halfDays.optional(),
  projectId: resourceFields.projectId.optional(),
  color: resourceFields.color.optional(),
  isFavourite: resourceFields.isFavourite.optional(),
  firstAvailableDate: resourceFields.firstAvailableDate.optional(),
  lastAvailableDate: resourceFields.lastAvailableDate.optional(),
}

const resourceIntent = vine.union([
  vine.union.if(
    (value) => operationMatches(value, 'resource.create'),
    vine.object({
      operation: vine.literal('resource.create'),
      id: uuid(),
      fields: vine.object(resourceFields).use(
        vine.createRule((value, _options, field) => {
          if (value === null || typeof value !== 'object' || Array.isArray(value)) return
          const fields = value as Record<string, unknown>
          if (
            fields.kind === 'person' &&
            Array.isArray(fields.workingDays) &&
            fields.workingDays.length === 0
          ) {
            field.report('A person must have at least one working day.', 'workingDays', field)
          }
          if (
            fields.kind !== 'placeholder' &&
            (typeof fields.name !== 'string' || normalizeUserText(fields.name).length === 0)
          ) {
            field.report('A person or external resource name is required.', 'name', field)
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
            )
          }
          if (fields.kind === 'external' && fields.color !== NEUTRAL_COLOR) {
            field.report('External resources must use the neutral color.', 'resourceColor', field)
          }
          const defaults =
            fields.kind === 'external'
              ? externalCapacityDefaults()
              : fields.kind === 'placeholder'
                ? placeholderCapacityDefaults()
                : undefined
          if (defaults) {
            const defaultValues = defaults as unknown as Record<string, unknown>
            for (const key of ['workingDays', 'halfDays'] as const) {
              if (JSON.stringify(fields[key]) !== JSON.stringify(defaultValues[key])) {
                field.report(`${key} must match the resource kind defaults.`, key, field)
              }
            }
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
              )
            }
            if (fields.kind === 'placeholder' && fields.engagement !== 'studio') {
              field.report('Placeholder engagement must match defaults.', 'engagement', field)
            }
          }
          const halfDays = fields.halfDays
          const workingDays = fields.workingDays
          if (
            Array.isArray(halfDays) &&
            Array.isArray(workingDays) &&
            !halfDays.every((day) => workingDays.includes(day))
          ) {
            field.report('Half days must be included in working days.', 'halfDays', field)
          }
        })()
      ),
    })
  ),
  vine.union.else(
    vine.object({
      operation: vine.literal('resource.update'),
      id: uuid(),
      changes: vine
        .object(resourceChanges)
        .use(requireChanges(Object.keys(resourceChanges)))
        .use(
          vine.createRule((value, _options, field) => {
            if (value === null || typeof value !== 'object' || Array.isArray(value)) return
            const changes = value as Record<string, unknown>
            const halfDays = changes.halfDays
            const workingDays = changes.workingDays
            if (
              Array.isArray(halfDays) &&
              Array.isArray(workingDays) &&
              !halfDays.every((day) => workingDays.includes(day))
            ) {
              field.report('Half days must be included in working days.', 'halfDays', field)
            }
          })()
        ),
    })
  ),
])

export const resourceMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: resourceIntent })
)

const timeOffCreate = vine
  .object({
    id: uuid(),
    resourceId: uuid(),
    startDate: calendarDate(),
    endDate: calendarDate(),
    type: vine.enum(['holiday', 'sick', 'unpaid', 'other'] as const),
    note: nullableUserText(true).optional(),
  })
  .use(dateRange())
const timeOffOccurrence = vine
  .object({
    id: uuid(),
    resourceId: uuid(),
    startDate: calendarDate(),
    endDate: calendarDate(),
    type: vine.enum(['holiday', 'sick', 'unpaid', 'other'] as const),
    note: nullableUserText(true).optional(),
  })
  .use(dateRange())

const timeOffIntent = vine.union([
  vine.union.if(
    (value) => operationMatches(value, 'timeOff.create'),
    vine.object({ operation: vine.literal('timeOff.create'), timeOff: timeOffCreate })
  ),
  vine.union.if(
    (value) => operationMatches(value, 'timeOff.repeat'),
    vine
      .object({
        operation: vine.literal('timeOff.repeat'),
        entries: vine.array(timeOffOccurrence).minLength(1),
      })
      .use(uniqueArrayIds('entries'))
  ),
  vine.union.if(
    (value) => operationMatches(value, 'timeOff.deleteGroup'),
    vine
      .object({
        operation: vine.literal('timeOff.deleteGroup'),
        ids: vine.array(uuid()).minLength(1),
      })
      .use(uniqueArrayIds('ids'))
  ),
  vine.union.if(
    (value) => operationMatches(value, 'timeOff.update'),
    vine.object({
      operation: vine.literal('timeOff.update'),
      id: uuid(),
      changes: vine
        .object({
          resourceId: uuid().optional(),
          startDate: calendarDate().optional(),
          endDate: calendarDate().optional(),
          type: vine.enum(['holiday', 'sick', 'unpaid', 'other'] as const).optional(),
          note: nullableUserText(true).optional(),
        })
        .use(requireChanges(['resourceId', 'startDate', 'endDate', 'type', 'note']))
        .use(dateRange()),
    })
  ),
  vine.union.else(vine.object({ operation: vine.literal('timeOff.delete'), id: uuid() })),
])

export const timeOffMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: timeOffIntent })
)

const closureFields = {
  name: nameText(),
  startDate: calendarDate(),
  endDate: calendarDate(),
}
const closureChanges = {
  name: closureFields.name.optional(),
  startDate: closureFields.startDate.optional(),
  endDate: closureFields.endDate.optional(),
}
const closureIntent = vine.union([
  vine.union.if(
    (value) => operationMatches(value, 'closure.create'),
    vine.object({
      operation: vine.literal('closure.create'),
      id: uuid(),
      fields: vine.object(closureFields).use(dateRange()),
    })
  ),
  vine.union.if(
    (value) => operationMatches(value, 'closure.update'),
    vine.object({
      operation: vine.literal('closure.update'),
      id: uuid(),
      changes: vine
        .object(closureChanges)
        .use(requireChanges(Object.keys(closureChanges)))
        .use(dateRange()),
    })
  ),
  vine.union.else(vine.object({ operation: vine.literal('closure.delete'), id: uuid() })),
])

export const closureMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: closureIntent })
)

const settingsChanges = {
  name: nameText().optional(),
  color: presetColor().optional(),
  weekStartsOn: vine
    .enum([0, 1] as const)
    .nullable()
    .optional(),
  timezone: vine
    .string()
    .use(
      vine.createRule((value, _options, field) => {
        if (typeof value === 'string' && value.length <= 128) {
          try {
            new Intl.DateTimeFormat(undefined, { timeZone: value })
            return
          } catch {
            // Report unsupported timezone values below.
          }
        }
        field.report('The timezone must be supported.', 'timezone', field)
      })()
    )
    .nullable()
    .optional(),
  schedulingMode: vine
    .enum(['hourly', 'days', 'blocks'] as const)
    .nullable()
    .optional(),
  workingDays: weekdays()
    .use(
      vine.createRule((value, _options, field) => {
        if (value === null || (Array.isArray(value) && value.length > 0)) return
        field.report('Working days must contain a working day.', 'workingDays', field)
      })()
    )
    .nullable()
    .optional(),
  disciplinesEnabled: boolean().nullable().optional(),
  placeholdersEnabled: boolean().nullable().optional(),
  externalEnabled: boolean().nullable().optional(),
  inlineActivityCreateEnabled: boolean().nullable().optional(),
  showTaskFieldInSchedule: boolean().nullable().optional(),
  capacityOverviewAccess: vine
    .enum(['owner_admin', 'owner_admin_editor', 'everyone'] as const)
    .nullable()
    .optional(),
  dateStyle: vine
    .enum(['day-month', 'day-ordinal-month', 'month-day', 'month-day-ordinal'] as const)
    .nullable()
    .optional(),
}

const settingsIntent = vine.object({
  operation: vine.literal('settings.update'),
  changes: vine.object(settingsChanges).use(requireChanges(Object.keys(settingsChanges))),
})

export const settingsMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: settingsIntent })
)

const planningIntent = vine.union([
  vine.union.if(
    (value) => operationMatches(value, 'planning.restoreGroup'),
    vine.object({ operation: vine.literal('planning.restoreGroup'), restorationGroupId: uuid() })
  ),
  vine.union.if((value) => operationStartsWith(value, 'allocation.'), allocationIntent),
  vine.union.if((value) => operationStartsWith(value, 'catalogue.'), catalogueIntent),
  vine.union.if((value) => operationStartsWith(value, 'resource.'), resourceIntent),
  vine.union.if((value) => operationStartsWith(value, 'timeOff.'), timeOffIntent),
  vine.union.if((value) => operationStartsWith(value, 'closure.'), closureIntent),
  vine.union.else(settingsIntent),
])

/**
 * Validate a planning intent. Account scope and authorization come from the authenticated server
 * context; IDs and supplied fields never confer permission. Allocation updates represent move,
 * resize and reassignment in one patch. Vine strips unknown/server-owned fields. This is input
 * validation only; the write transaction owns authorization and integrity.
 */
export const planningMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: planningIntent })
)

export type PlanningMutationInput = Infer<typeof planningMutationValidator>
export type PlanningIntent = PlanningMutationInput['intent']
export type AllocationIntent = Extract<PlanningIntent, { operation: `allocation.${string}` }>

/** Metadata is added when an intent is executed, never stored in the forward/inverse intent. */
export interface PlanningExecution<TIntent = PlanningIntent> {
  mutationId: string
  baseRevision: number
  intent: TIntent
}

/** A history entry stores ordinary inputs; every Undo and Redo gets new execution metadata. */
export interface PlanningHistoryEntry<TIntent = PlanningIntent> {
  forward: TIntent
  inverse: TIntent
}

type PlanningRowByEntity = {
  accounts: Account
  disciplines: Discipline
  resources: Resource
  clients: Client
  projects: Project
  phases: Phase
  activities: Activity
  allocations: Allocation
  timeOff: TimeOff
  closures: Closure
}

export type ProjectedPlanningRow = {
  [Entity in AppDataKey]: { entity: Entity; row: PlanningRowByEntity[Entity] }
}[AppDataKey]

export interface PlanningMutationSuccess {
  status: 'committed'
  mutationId: string
  /** The account revision advances exactly once for a committed mutation. */
  revision: number
  /** Deletes create the next restore handle; restore consumes its handle and has a typed delete inverse. */
  restoration:
    | { consumedGroupId: null; replacementGroupId: string }
    | { consumedGroupId: string; replacementGroupId: null }
    | { consumedGroupId: null; replacementGroupId: null }
  projection:
    | {
        mode: 'patch'
        history: 'retain'
        changed: {
          upserts: ProjectedPlanningRow[]
          removed: Array<{ entity: AppDataKey; id: string }>
        }
      }
    | { mode: 'refetch'; history: 'clear' }
}

/** A commitment lookup never returns a prior response or a before-image. */
export type PlanningMutationLookup =
  | { status: 'committed'; mutationId: string; revision: number; restorationGroupId?: string }
  | { status: 'unknown'; mutationId: string }

export const mutationLookupValidator = vine.compile(vine.object({ mutationId: uuid() }))
export const mutationLookupReplyValidator = vine.compile(
  vine.union([
    vine.union.if(
      (value) =>
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value) &&
        (value as { status?: unknown }).status === 'committed',
      vine.object({
        status: vine.literal('committed'),
        mutationId: uuid(),
        revision: revision(),
        restorationGroupId: uuid().optional(),
      })
    ),
    vine.union.else(vine.object({ status: vine.literal('unknown'), mutationId: uuid() })),
  ])
)
export type MutationLookupInput = Infer<typeof mutationLookupValidator>

/** These codes distinguish admission loss (clear account state) from a refused action. */
export const planningMutationErrorCodes = [
  'validation_error',
  'unauthenticated',
  'account_membership_lost',
  'authorization_denied',
  'stale_revision',
  'mutation_id_reused',
  'no_change',
] as const

/** Flat command failure body; transport maps stale_revision to HTTP 409. */
export interface PlanningMutationFailure {
  error: string
  code?: (typeof planningMutationErrorCodes)[number]
}

export const planningMutationFailureValidator = vine.compile(
  vine.object({ error: vine.string(), code: vine.enum(planningMutationErrorCodes).optional() })
)
export type PlanningMutationFailureInput = Infer<typeof planningMutationFailureValidator>

/** A pre-transaction check only; callers must read and compare under the write transaction. */
export class StalePlanningRevisionError extends Error {
  readonly statusCode = 409
  readonly code = 'stale_revision' as const

  constructor(
    readonly mutationId: string,
    readonly baseRevision: number,
    readonly currentRevision: number
  ) {
    super('The planning revision changed before this mutation was applied.')
    this.name = 'StalePlanningRevisionError'
  }
}

/** Throw the conflict contract when the caller's captured revision is no longer current. */
export function assertPlanningBaseRevision(
  baseRevision: number,
  currentRevision: number,
  mutationId: string
): void {
  if (baseRevision !== currentRevision) {
    throw new StalePlanningRevisionError(mutationId, baseRevision, currentRevision)
  }
}
