import vine from '@vinejs/vine';
import {
  calendarDate,
  dateRange,
  entityId,
  meta,
  nameText,
  operationMatches,
  requireChanges,
  uuid,
} from '#validators/planning/fields';

const closureFields = {
  name: nameText(),
  startDate: calendarDate(),
  endDate: calendarDate(),
};
const closureChanges = {
  name: closureFields.name.optional(),
  startDate: closureFields.startDate.optional(),
  endDate: closureFields.endDate.optional(),
};
export const closureIntent = vine.union([
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
      id: entityId(),
      changes: vine
        .object(closureChanges)
        .use(requireChanges(Object.keys(closureChanges)))
        .use(dateRange()),
    })
  ),
  vine.union.else(vine.object({ operation: vine.literal('closure.delete'), id: entityId() })),
]);

export const closureMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: closureIntent })
);
