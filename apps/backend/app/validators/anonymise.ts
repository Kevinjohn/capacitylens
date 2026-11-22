import vine from '@vinejs/vine';
import { allowedFields, fixedMessage } from '#validators/request_rules';

const message = 'Invalid anonymisation request.';

export const anonymiseResourceValidator = vine.create(
  vine.object({}).use(allowedFields({ fields: [], message }))
);
anonymiseResourceValidator.messagesProvider = fixedMessage(message);

export const anonymiseCompanyValidator = vine.create(
  vine
    .object({ confirmationId: vine.string() })
    .use(allowedFields({ fields: ['confirmationId'], message }))
);
anonymiseCompanyValidator.messagesProvider = fixedMessage(message);
