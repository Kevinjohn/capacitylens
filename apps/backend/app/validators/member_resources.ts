import vine from '@vinejs/vine';
import { allowedFields } from '#validators/request_rules';

export const setLinkValidator = vine.create(
  vine
    .object({
      resourceId: vine.string().minLength(1),
      expectedRevision: vine.string().nullable(),
    })
    .use(allowedFields({ fields: ['resourceId', 'expectedRevision'] }))
);

export const clearLinkValidator = vine.create(
  vine
    .object({ expectedRevision: vine.string().minLength(1) })
    .use(allowedFields({ fields: ['expectedRevision'] }))
);
