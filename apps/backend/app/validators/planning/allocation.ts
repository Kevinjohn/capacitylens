import vine from '@vinejs/vine';
import { ALLOCATION_STATUSES } from '@capacitylens/shared/types/entities';
import { GENERATED_ALLOCATION_LIMIT } from '@capacitylens/shared/lib/repeatingDates';
import {
  boolean,
  calendarDate,
  dateRange,
  entityId,
  hours,
  meta,
  nullableId,
  nullableUserText,
  occurrenceIdsExcludeFirst,
  hasOperation,
  repeatRange,
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
    status: vine.enum(ALLOCATION_STATUSES),
    note: nullableUserText(true).optional(),
    task: nullableUserText().optional(),
    ignoreWorkingDays: boolean().nullable().optional(),
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
    status: vine.enum(ALLOCATION_STATUSES).optional(),
    note: nullableUserText(true).optional(),
    task: nullableUserText().optional(),
    ignoreWorkingDays: boolean().nullable().optional(),
  })
  .use(dateRange());

const occurrence = vine
  .object({ id: uuid(), startDate: calendarDate(), endDate: calendarDate() })
  .use(dateRange());

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
      (value) => hasOperation(value, 'allocation.create'),
      vine.object({ operation: vine.literal('allocation.create'), allocation: allocationCreate })
    ),
    vine.union.if(
      (value) => hasOperation(value, 'allocation.update'),
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
            'ignoreWorkingDays',
          ])
        ),
      })
    ),
    vine.union.if(
      (value) => hasOperation(value, 'allocation.delete'),
      vine.object({ operation: vine.literal('allocation.delete'), id: entityId() })
    ),
    vine.union.if(
      (value) => hasOperation(value, 'allocation.deleteGroup'),
      vine
        .object({
          operation: vine.literal('allocation.deleteGroup'),
          ids: vine.array(entityId()).minLength(1),
        })
        .use(uniqueArrayIds('ids'))
    ),
    vine.union.if(
      (value) => hasOperation(value, 'allocation.createGroup'),
      vine
        .object({
          operation: vine.literal('allocation.createGroup'),
          allocation: allocationCreate,
          repeat: repeatRange(),
          occurrenceIds: vine
            .array(uuid())
            .minLength(1)
            .maxLength(GENERATED_ALLOCATION_LIMIT - 1),
        })
        .use(uniqueArrayIds('occurrenceIds'))
        .use(occurrenceIdsExcludeFirst('allocation'))
    ),
    vine.union.if(
      (value) => hasOperation(value, 'allocation.duplicate'),
      vine
        .object({
          operation: vine.literal('allocation.duplicate'),
          sourceAllocationId: entityId(),
          occurrence,
        })
        .use(duplicateIdIsDistinct())
    ),
  ])
  .otherwise((_value, field) =>
    field.report('Unsupported allocation operation.', 'unsupportedOperation', field)
  );

export const allocationMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: allocationIntent })
);
