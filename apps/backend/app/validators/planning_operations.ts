import vine from '@vinejs/vine';
import { allocationIntent } from '#validators/planning/allocation';
import { catalogueIntent } from '#validators/planning/catalogue';
import { closureIntent } from '#validators/planning/closure';
import {
  meta,
  hasOperation,
  hasOperationPrefix,
  revision,
  uuid,
} from '#validators/planning/fields';
import { resourceIntent } from '#validators/planning/resource';
import { settingsIntent } from '#validators/planning/settings';
import { timeOffIntent } from '#validators/planning/time_off';

const planningIntent = vine.union([
  vine.union.if(
    (value) => hasOperation(value, 'planning.restoreGroup'),
    vine.object({ operation: vine.literal('planning.restoreGroup'), restorationGroupId: uuid() })
  ),
  vine.union.if((value) => hasOperationPrefix(value, 'allocation.'), allocationIntent),
  vine.union.if((value) => hasOperationPrefix(value, 'catalogue.'), catalogueIntent),
  vine.union.if((value) => hasOperationPrefix(value, 'resource.'), resourceIntent),
  vine.union.if((value) => hasOperationPrefix(value, 'timeOff.'), timeOffIntent),
  vine.union.if((value) => hasOperationPrefix(value, 'closure.'), closureIntent),
  vine.union.else(settingsIntent),
]);

/**
 * Validate a planning intent. Account scope and authorization come from the authenticated server
 * context; IDs and supplied fields never confer permission. Allocation updates represent move,
 * resize and reassignment in one patch. Vine strips unknown/server-owned fields. This is input
 * validation only; the write transaction owns authorization and integrity.
 */
export const planningMutationValidator = vine.create(
  vine.object({ ...meta(), intent: planningIntent })
);

/** One undo or redo: the server holds the intent, so the body names only the page's history. */
export const planningHistoryStepValidator = vine.create(
  vine.object({ mutationId: uuid(), baseRevision: revision(), historyId: uuid() })
);
