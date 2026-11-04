import vine from '@vinejs/vine';
import {
  boolean,
  calendarDate,
  dateRange,
  entityId,
  hours,
  meta,
  nullableId,
  nullableUserText,
  operationMatches,
  requireChanges,
  uniqueArrayIds,
  uuid,
} from '#validators/planning/fields';

const allocationCreate = vine
  .object({
    id: uuid(),
    resourceId: entityId(),
    activityId: entityId(),
    projectId: nullableId().optional(),
    startDate: calendarDate(),
    endDate: calendarDate(),
    hoursPerDay: hours(),
    status: vine.enum(['confirmed', 'tentative', 'completed'] as const),
    note: nullableUserText(true).optional(),
    task: nullableUserText().optional(),
    ignoreWeekends: boolean().nullable().optional(),
  })
  .use(dateRange());

const allocationChanges = vine
  .object({
    resourceId: entityId().optional(),
    activityId: entityId().optional(),
    projectId: nullableId().optional(),
    startDate: calendarDate().optional(),
    endDate: calendarDate().optional(),
    hoursPerDay: hours().optional(),
    status: vine.enum(['confirmed', 'tentative', 'completed'] as const).optional(),
    note: nullableUserText(true).optional(),
    task: nullableUserText().optional(),
    ignoreWeekends: boolean().nullable().optional(),
  })
  .use(dateRange());

const occurrence = vine
  .object({ id: uuid(), startDate: calendarDate(), endDate: calendarDate() })
  .use(dateRange());

const distinctOccurrenceIds = vine.createRule((value, _options, field) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const { sourceAllocationId, occurrences } = value as {
    sourceAllocationId?: unknown;
    occurrences?: unknown;
  };
  if (!Array.isArray(occurrences) || typeof sourceAllocationId !== 'string') return;
  const ids = occurrences.map((item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? (item as { id?: unknown }).id
      : undefined
  );
  if (
    ids.some((id) => typeof id !== 'string' || id === sourceAllocationId) ||
    new Set(ids).size !== ids.length
  ) {
    field.report(
      'Occurrence IDs must be distinct from the source and each other.',
      'distinctIds',
      field
    );
  }
});

const duplicateIdIsDistinct = vine.createRule((value, _options, field) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
  const { sourceAllocationId, occurrence: duplicate } = value as {
    sourceAllocationId?: unknown;
    occurrence?: { id?: unknown };
  };
  if (
    typeof sourceAllocationId === 'string' &&
    typeof duplicate?.id === 'string' &&
    sourceAllocationId !== duplicate.id
  ) {
    return;
  }
  field.report('The duplicated allocation must have a new ID.', 'distinctIds', field);
});

export const allocationIntent = vine
  .union([
    vine.union.if(
      (value) => operationMatches(value, 'allocation.create'),
      vine.object({ operation: vine.literal('allocation.create'), allocation: allocationCreate })
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.update'),
      vine.object({
        operation: vine.literal('allocation.update'),
        id: entityId(),
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
      vine.object({ operation: vine.literal('allocation.delete'), id: entityId() })
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.deleteGroup'),
      vine
        .object({
          operation: vine.literal('allocation.deleteGroup'),
          ids: vine.array(entityId()).minLength(1),
        })
        .use(uniqueArrayIds('ids'))
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.createGroup'),
      vine
        .object({
          operation: vine.literal('allocation.createGroup'),
          allocations: vine.array(allocationCreate).minLength(1),
        })
        .use(uniqueArrayIds('allocations'))
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.duplicate'),
      vine
        .object({
          operation: vine.literal('allocation.duplicate'),
          sourceAllocationId: entityId(),
          occurrence,
        })
        .use(duplicateIdIsDistinct())
    ),
    vine.union.if(
      (value) => operationMatches(value, 'allocation.repeat'),
      vine
        .object({
          operation: vine.literal('allocation.repeat'),
          sourceAllocationId: entityId(),
          occurrences: vine.array(occurrence).minLength(1),
        })
        .use(distinctOccurrenceIds())
    ),
  ])
  .otherwise((_value, field) =>
    field.report('Unsupported allocation operation.', 'unsupportedOperation', field)
  );

export const allocationMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: allocationIntent })
);
