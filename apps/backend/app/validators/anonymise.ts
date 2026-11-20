import vine from '@vinejs/vine';
import { allowedFields, fixedMessage } from '#validators/request_rules';

const message = 'Invalid anonymisation request.';

export const resourceValidator = vine.create(
  vine.object({}).use(allowedFields({ fields: [], message }))
);
resourceValidator.messagesProvider = fixedMessage(message);

export const companyValidator = vine.create(
  vine
    .object({ confirmationId: vine.string() })
    .use(allowedFields({ fields: ['confirmationId'], message }))
);
companyValidator.messagesProvider = fixedMessage(message);
