import vine from '@vinejs/vine';
import { allowedFields, fixedMessage } from '#validators/request_rules';

const message = 'Invalid admission request.';

export const setLinkValidator = vine.create(
  vine
    .object({
      resourceId: vine.string().minLength(1),
      expectedRevision: vine.string().nullable(),
    })
    .use(allowedFields({ fields: ['resourceId', 'expectedRevision'], message }))
);
setLinkValidator.messagesProvider = fixedMessage(message);

export const clearLinkValidator = vine.create(
  vine
    .object({ expectedRevision: vine.string().minLength(1) })
    .use(allowedFields({ fields: ['expectedRevision'], message }))
);
clearLinkValidator.messagesProvider = fixedMessage(message);
