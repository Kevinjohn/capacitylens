import vine from '@vinejs/vine'
import { writableFields } from '@capacitylens/shared/types/entityFields'
import { TIME_OFF_TYPES } from '@capacitylens/shared/types/entities'
import { TIME_OFF_REPEAT_RULES } from '@capacitylens/shared/lib/repeatingDates'
import {
  calendarDate,
  dateRange,
  entityId,
  nullableUserText,
  occurrenceIdsExcludeFirst,
  hasOperation,
  repeatRange,
  requireChanges,
  uniqueArrayIds,
  uuid,
} from '#validators/planning/fields'

const timeOffCreate = vine
  .object({
    id: uuid(),
    resourceId: entityId(),
    startDate: calendarDate(),
    endDate: calendarDate(),
    type: vine.enum(TIME_OFF_TYPES),
    note: nullableUserText(true).optional(),
  })
  .use(dateRange())

export const timeOffChanges = vine
  .object({
    resourceId: entityId().optional(),
    startDate: calendarDate().optional(),
    endDate: calendarDate().optional(),
    type: vine.enum(TIME_OFF_TYPES).optional(),
    note: nullableUserText(true).optional(),
  })
  .use(requireChanges(writableFields('timeOff')))
  .use(dateRange())

export const timeOffIntent = vine.union([
  vine.union.if(
    (value) => hasOperation(value, 'timeOff.create'),
    vine.object({ operation: vine.literal('timeOff.create'), timeOff: timeOffCreate })
  ),
  vine.union.if(
    (value) => hasOperation(value, 'timeOff.repeat'),
    vine
      .object({
        operation: vine.literal('timeOff.repeat'),
        timeOff: timeOffCreate,
        repeat: repeatRange(),
        occurrenceIds: vine
          .array(uuid())
          .minLength(1)
          .maxLength(TIME_OFF_REPEAT_RULES.maxOccurrences - 1),
      })
      .use(uniqueArrayIds('occurrenceIds'))
      .use(occurrenceIdsExcludeFirst('timeOff'))
  ),
  vine.union.if(
    (value) => hasOperation(value, 'timeOff.deleteGroup'),
    vine
      .object({
        operation: vine.literal('timeOff.deleteGroup'),
        ids: vine.array(entityId()).minLength(1),
      })
      .use(uniqueArrayIds('ids'))
  ),
  vine.union.if(
    (value) => hasOperation(value, 'timeOff.update'),
    vine.object({
      operation: vine.literal('timeOff.update'),
      id: entityId(),
      changes: timeOffChanges,
    })
  ),
  vine.union.else(vine.object({ operation: vine.literal('timeOff.delete'), id: entityId() })),
])
