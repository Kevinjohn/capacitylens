import vine from '@vinejs/vine';
import { allowedFields, fixedMessage } from '#validators/request_rules';

const startMessage = 'Target member is required.';
export const startMasqueradeValidator = vine.create(
  vine
    .object({ targetUserId: vine.string().minLength(1) })
    .use(allowedFields({ fields: ['targetUserId'], message: startMessage }))
);
startMasqueradeValidator.messagesProvider = fixedMessage(startMessage);

const endMessage = 'Invalid masquerade end request.';
export const endMasqueradeValidator = vine.create(
  vine
    .object({
      token: vine.string().minLength(1),
      reason: vine.enum(['explicit', 'company_switch'] as const),
    })
    .use(allowedFields({ fields: ['token', 'reason'], message: endMessage }))
);
endMasqueradeValidator.messagesProvider = fixedMessage(endMessage);
