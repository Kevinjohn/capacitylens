import vine from '@vinejs/vine';
import { USER_ID_PATTERN } from '#services/request_helpers';
import { allowedFields, fixedMessage, isSupplied } from '#validators/request_rules';

const message = 'An eligible target user is required.';

export const transferOwnershipValidator = vine.create(
  vine
    .object({
      toUserId: vine.string().regex(USER_ID_PATTERN),
      confirmationId: vine
        .string()
        .regex(/^[0-9a-f-]{36}$/)
        .optional()
        .requiredWhen(isSupplied),
    })
    .use(allowedFields({ fields: ['toUserId', 'confirmationId'], message }))
);
transferOwnershipValidator.messagesProvider = fixedMessage(message);
