import vine from '@vinejs/vine';
import { normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import {
  accountEmail,
  allowedFields,
  bearerToken,
  passwordLength,
} from '#validators/request_rules';

export const requestResetValidator = vine.create(
  vine
    .object({ email: vine.string().use(accountEmail()).transform(normalizeAccountEmail) })
    .use(allowedFields({ fields: ['email'] }))
);

export const inspectResetValidator = vine.create(
  vine.object({ token: vine.string().use(bearerToken()) }).use(allowedFields({ fields: ['token'] }))
);

export const resetPasswordValidator = vine.create(
  vine
    .object({
      token: vine.string().use(bearerToken()),
      newPassword: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['token', 'newPassword'] }))
);

export const changePasswordValidator = vine.create(
  vine
    .object({
      currentPassword: vine.string(),
      newPassword: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['currentPassword', 'newPassword'] }))
);

export const deleteAccountValidator = vine.create(
  vine
    .object({ currentPassword: vine.string() })
    .use(allowedFields({ fields: ['currentPassword'] }))
);
