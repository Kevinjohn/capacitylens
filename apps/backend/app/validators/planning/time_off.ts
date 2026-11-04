import vine from '@vinejs/vine';
import {
  calendarDate,
  dateRange,
  entityId,
  meta,
  nullableUserText,
  operationMatches,
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
const timeOffOccurrence = vine
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
        entries: vine.array(timeOffOccurrence).minLength(1),
      })
      .use(uniqueArrayIds('entries'))
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
