import vine from '@vinejs/vine';
import {
  boolean,
  entityId,
  entityMatches,
  meta,
  nameText,
  nullableId,
  nullableUserText,
  number,
  operationMatches,
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
      fields: vine.object({ ...nameAndColor, ...privateName, clientId: entityId() }),
    })
  ),
  vine.union.if(
    (value) => entityMatches(value, 'phases'),
    vine.object({
      entity: vine.literal('phases'),
      id: uuid(),
      fields: vine.object({ name: nameText(), projectId: entityId() }),
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
            if (Number.isSafeInteger(value)) return;
            field.report('Sort order must be a safe integer.', 'safeInteger', field);
          })()
        ),
      }),
    })
  ),
]);

const catalogueChanges = vine.union([
  vine.union.if(
    (value) => entityMatches(value, 'clients'),
    vine.object({
      entity: vine.literal('clients'),
      id: entityId(),
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
      id: entityId(),
      changes: vine
        .object({
          name: nameText().optional(),
          color: presetColor().optional(),
          clientId: entityId().optional(),
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
      id: entityId(),
      changes: vine
        .object({
          name: nameText().optional(),
          projectId: entityId().optional(),
        })
        .use(requireChanges(['name', 'projectId'])),
    })
  ),
  vine.union.if(
    (value) => entityMatches(value, 'activities'),
    vine.object({
      entity: vine.literal('activities'),
      id: entityId(),
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
      id: entityId(),
      changes: vine
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
        .use(requireChanges(['name', 'color', 'sortOrder'])),
    })
  ),
]);

const catalogueDelete = vine.union([
  vine.union.if(
    (value) => entityMatches(value, 'phases'),
    vine.object({ entity: vine.literal('phases'), id: entityId() })
  ),
  vine.union.else(vine.object({ entity: vine.literal('disciplines'), id: entityId() })),
]);

const catalogueLifecycleEntity = vine.union([
  vine.union.if(
    (value) => entityMatches(value, 'clients'),
    vine.object({ entity: vine.literal('clients'), id: entityId() })
  ),
  vine.union.if(
    (value) => entityMatches(value, 'projects'),
    vine.object({ entity: vine.literal('projects'), id: entityId() })
  ),
  vine.union.else(vine.object({ entity: vine.literal('activities'), id: entityId() })),
]);

export const catalogueIntent = vine.union([
  vine.union.if(
    (value) => operationMatches(value, 'catalogue.create'),
    vine.object({ operation: vine.literal('catalogue.create'), entity: catalogueCreate })
  ),
  vine.union.if(
    (value) => operationMatches(value, 'catalogue.update'),
    vine.object({ operation: vine.literal('catalogue.update'), entity: catalogueChanges })
  ),
  vine.union.if(
    (value) =>
      operationMatches(value, 'catalogue.archive') ||
      operationMatches(value, 'catalogue.unarchive'),
    vine.object({
      operation: vine.enum(['catalogue.archive', 'catalogue.unarchive'] as const),
      entity: catalogueLifecycleEntity,
    })
  ),
  vine.union.else(
    vine.object({ operation: vine.literal('catalogue.delete'), entity: catalogueDelete })
  ),
]);

export const catalogueMutationValidator = vine.compile(
  vine.object({ ...meta(), intent: catalogueIntent })
);
