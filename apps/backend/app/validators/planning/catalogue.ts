import vine from '@vinejs/vine';
import { writableFields } from '@capacitylens/shared/types/entityFields';
import { ACTIVITY_KINDS } from '@capacitylens/shared/types/entities';
import {
  boolean,
  entityId,
  hasEntity,
  nameText,
  nullableId,
  nullableUserText,
  number,
  hasOperation,
  presetColor,
  requireChanges,
  uuid,
} from '#validators/planning/fields';

const nameAndColor = { name: nameText(), color: presetColor() };
const privateName = {
  isPrivate: boolean().nullable().optional(),
  codeName: nullableUserText().optional(),
};

const catalogueCreate = vine.union([
  vine.union.if(
    (value) => hasEntity(value, 'clients'),
    vine.object({
      entity: vine.literal('clients'),
      id: uuid(),
      fields: vine.object({ ...nameAndColor, ...privateName }),
    })
  ),
  vine.union.if(
    (value) => hasEntity(value, 'projects'),
    vine.object({
      entity: vine.literal('projects'),
      id: uuid(),
      fields: vine.object({ ...nameAndColor, ...privateName, clientId: entityId() }),
    })
  ),
  vine.union.if(
    (value) => hasEntity(value, 'phases'),
    vine.object({
      entity: vine.literal('phases'),
      id: uuid(),
      fields: vine.object({ name: nameText(), projectId: entityId() }),
    })
  ),
  vine.union.if(
    (value) => hasEntity(value, 'activities'),
    vine.object({
      entity: vine.literal('activities'),
      id: uuid(),
      fields: vine.object({
        name: nameText(),
        kind: vine.enum(ACTIVITY_KINDS),
        projectId: nullableId(),
        phaseId: nullableId(),
      }),
    })
  ),
  vine.union.else(
    vine.object({
      entity: vine.literal('disciplines'),
      id: uuid(),
      // The server appends a new discipline after the company's highest sort order.
      fields: vine.object({ name: nameText(), color: presetColor().nullable() }),
    })
  ),
]);

export const clientChanges = vine
  .object({
    name: nameText().optional(),
    color: presetColor().optional(),
    isPrivate: boolean().nullable().optional(),
    codeName: nullableUserText().optional(),
  })
  // `builtin` is set only by the server, so a client change cannot name it.
  .use(requireChanges(['name', 'color', 'isPrivate', 'codeName']));

export const projectChanges = vine
  .object({
    name: nameText().optional(),
    color: presetColor().optional(),
    clientId: entityId().optional(),
    isPrivate: boolean().nullable().optional(),
    codeName: nullableUserText().optional(),
  })
  .use(requireChanges(writableFields('projects')));

export const phaseChanges = vine
  .object({
    name: nameText().optional(),
    projectId: entityId().optional(),
  })
  .use(requireChanges(writableFields('phases')));

export const activityChanges = vine
  .object({
    name: nameText().optional(),
    kind: vine.enum(ACTIVITY_KINDS).optional(),
    projectId: nullableId().optional(),
    phaseId: nullableId().optional(),
  })
  .use(requireChanges(writableFields('activities')));

export const disciplineChanges = vine
  .object({
    name: nameText().optional(),
    color: presetColor().nullable().optional(),
    sortOrder: number()
      .use(
        vine.createRule((value, _options, field) => {
          if (Number.isSafeInteger(value)) return;
          field.report('Sort order must be a safe integer.', 'safeInteger', field);
        })()
      )
      .optional(),
  })
  .use(requireChanges(writableFields('disciplines')));

const catalogueChanges = vine.union([
  vine.union.if(
    (value) => hasEntity(value, 'clients'),
    vine.object({
      entity: vine.literal('clients'),
      id: entityId(),
      changes: clientChanges,
    })
  ),
  vine.union.if(
    (value) => hasEntity(value, 'projects'),
    vine.object({
      entity: vine.literal('projects'),
      id: entityId(),
      changes: projectChanges,
    })
  ),
  vine.union.if(
    (value) => hasEntity(value, 'phases'),
    vine.object({
      entity: vine.literal('phases'),
      id: entityId(),
      changes: phaseChanges,
    })
  ),
  vine.union.if(
    (value) => hasEntity(value, 'activities'),
    vine.object({
      entity: vine.literal('activities'),
      id: entityId(),
      changes: activityChanges,
    })
  ),
  vine.union.else(
    vine.object({
      entity: vine.literal('disciplines'),
      id: entityId(),
      changes: disciplineChanges,
    })
  ),
]);

const catalogueDelete = vine.union([
  vine.union.if(
    (value) => hasEntity(value, 'phases'),
    vine.object({ entity: vine.literal('phases'), id: entityId() })
  ),
  vine.union.else(vine.object({ entity: vine.literal('disciplines'), id: entityId() })),
]);

const catalogueLifecycleEntity = vine.union([
  vine.union.if(
    (value) => hasEntity(value, 'clients'),
    vine.object({ entity: vine.literal('clients'), id: entityId() })
  ),
  vine.union.if(
    (value) => hasEntity(value, 'projects'),
    vine.object({ entity: vine.literal('projects'), id: entityId() })
  ),
  vine.union.else(vine.object({ entity: vine.literal('activities'), id: entityId() })),
]);

export const catalogueIntent = vine.union([
  vine.union.if(
    (value) => hasOperation(value, 'catalogue.create'),
    vine.object({ operation: vine.literal('catalogue.create'), entity: catalogueCreate })
  ),
  vine.union.if(
    (value) => hasOperation(value, 'catalogue.update'),
    vine.object({ operation: vine.literal('catalogue.update'), entity: catalogueChanges })
  ),
  vine.union.if(
    (value) => hasOperation(value, 'catalogue.archive') || hasOperation(value, 'catalogue.restore'),
    vine.object({
      operation: vine.enum(['catalogue.archive', 'catalogue.restore'] as const),
      entity: catalogueLifecycleEntity,
    })
  ),
  vine.union.else(
    vine.object({ operation: vine.literal('catalogue.delete'), entity: catalogueDelete })
  ),
]);
