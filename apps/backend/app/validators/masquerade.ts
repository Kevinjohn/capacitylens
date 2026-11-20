import vine from '@vinejs/vine';
import { allowedFields, fixedMessage } from '#validators/request_rules';

const startMessage = 'Target member is required.';
export const startValidator = vine.create(
  vine
    .object({ targetUserId: vine.string().minLength(1) })
    .use(allowedFields({ fields: ['targetUserId'], message: startMessage }))
);
startValidator.messagesProvider = fixedMessage(startMessage);

const endMessage = 'Invalid masquerade end request.';
export const endValidator = vine.create(
  vine
    .object({
      token: vine.string().minLength(1),
      reason: vine.enum(['explicit', 'account_switch'] as const),
    })
    .use(allowedFields({ fields: ['token', 'reason'], message: endMessage }))
);
endValidator.messagesProvider = fixedMessage(endMessage);
