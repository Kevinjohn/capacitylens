import vine from '@vinejs/vine';
import {
  allowedFields,
  bearerToken,
  fixedMessage,
  passwordLength,
} from '#validators/request_rules';

const message = 'Invalid confirmation request.';

export const inspectVerificationValidator = vine.create(
  vine
    .object({ token: vine.string().use(bearerToken()) })
    .use(allowedFields({ fields: ['token'], message }))
);
inspectVerificationValidator.messagesProvider = fixedMessage(message);

export const completeVerificationValidator = vine.create(
  vine
    .object({
      token: vine.string().use(bearerToken()),
      password: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['token', 'password'], message }))
);
completeVerificationValidator.messagesProvider = fixedMessage(message);
