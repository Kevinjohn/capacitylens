import vine from '@vinejs/vine';
import {
  allowedFields,
  bearerToken,
  fixedMessage,
  passwordLength,
} from '#validators/request_rules';

const message = 'Invalid confirmation request.';

export const inspectValidator = vine.create(
  vine
    .object({ token: vine.string().use(bearerToken()) })
    .use(allowedFields({ fields: ['token'], message }))
);
inspectValidator.messagesProvider = fixedMessage(message);

export const completeValidator = vine.create(
  vine
    .object({
      token: vine.string().use(bearerToken()),
      password: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['token', 'password'], message }))
);
completeValidator.messagesProvider = fixedMessage(message);
