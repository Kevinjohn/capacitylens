import vine from '@vinejs/vine';
import { TIME_OFF_REPEAT_POLICY } from '@capacitylens/shared/lib/repeatingDates';
import {
  calendarDate,
  dateRange,
  entityId,
  meta,
  nullableUserText,
  occurrenceIdsExcludeFirst,
  operationMatches,
  repeatRange,
  requireChanges,
  uniqueArrayIds,
  uuid,
} from '#validators/planning/fields';

const timeOffCreate = vine
  .object({
    id: uuid(),
    resourceId: entityId(),
    startDate: calendarDate(),
    endDate: calendarDate(),
    type: vine.enum(['holiday', 'sick', 'unpaid', 'other'] as const),
    note: nullableUserText(true).optional(),
  })
  .use(dateRange());

export const timeOffIntent = vine.union([
  vine.union.if(
    (value) => operationMatches(value, 'timeOff.create'),
    vine.object({ operation: vine.literal('timeOff.create'), timeOff: timeOffCreate })
  ),
  vine.union.if(
    (value) => operationMatches(value, 'timeOff.repeat'),
    vine
      .object({
        operation: vine.literal('timeOff.repeat'),
        timeOff: timeOffCreate,
        repeat: repeatRange(),
        occurrenceIds: vine
          .array(uuid())
          .minLength(1)
          .maxLength(TIME_OFF_REPEAT_POLICY.maxOccurrences - 1),
      })
      .use(uniqueArrayIds('occurrenceIds'))
      .use(occurrenceIdsExcludeFirst('timeOff'))
  ),
  vine.union.if(
    (value) => operationMatches(value, 'timeOff.deleteGroup'),
    vine
      .object({
        operation: vine.literal('timeOff.deleteGroup'),
        ids: vine.array(entityId()).minLength(1),
      })
      .use(uniqueArrayIds('ids'))
  ),
  vine.union.if(
    (value) => operationMatches(value, 'timeOff.update'),
    vine.object({
      operation: vine.literal('timeOff.update'),
      id: entityId(),
      changes: vine
        .object({
          resourceId: entityId().optional(),
          startDate: calendarDate().optional(),
          endDate: calendarDate().optional(),
          type: vine.enum(['holiday', 'sick', 'unpaid', 'other'] as const).optional(),
          note: nullableUserText(true).optional(),
        })
        .use(requireChanges(['resourceId', 'startDate', 'endDate', 'type', 'note']))
        .use(dateRange()),
    })
  ),
  vine.union.else(vine.object({ operation: vine.literal('timeOff.delete'), id: entityId() })),
]);

export const timeOffMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: timeOffIntent })
);
