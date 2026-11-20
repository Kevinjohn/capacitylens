import vine from '@vinejs/vine';
import { normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import {
  accountEmail,
  allowedFields,
  bearerToken,
  fixedMessage,
  passwordLength,
} from '#validators/request_rules';

const recoveryMessage = 'Invalid recovery request.';
const credentialMessage = 'Invalid credential request.';

export const requestResetValidator = vine.create(
  vine
    .object({ email: vine.string().use(accountEmail()).transform(normalizeAccountEmail) })
    .use(allowedFields({ fields: ['email'], message: recoveryMessage }))
);
requestResetValidator.messagesProvider = fixedMessage(recoveryMessage);

export const inspectResetValidator = vine.create(
  vine
    .object({ token: vine.string().use(bearerToken()) })
    .use(allowedFields({ fields: ['token'], message: recoveryMessage }))
);
inspectResetValidator.messagesProvider = fixedMessage(recoveryMessage);

export const resetPasswordValidator = vine.create(
  vine
    .object({
      token: vine.string().use(bearerToken()),
      newPassword: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['token', 'newPassword'], message: recoveryMessage }))
);
resetPasswordValidator.messagesProvider = fixedMessage(recoveryMessage);

export const changePasswordValidator = vine.create(
  vine
    .object({
      currentPassword: vine.string(),
      newPassword: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['currentPassword', 'newPassword'], message: credentialMessage }))
);
changePasswordValidator.messagesProvider = fixedMessage(credentialMessage);

export const deleteAccountValidator = vine.create(
  vine
    .object({ currentPassword: vine.string() })
    .use(allowedFields({ fields: ['currentPassword'], message: credentialMessage }))
);
deleteAccountValidator.messagesProvider = fixedMessage(credentialMessage);
