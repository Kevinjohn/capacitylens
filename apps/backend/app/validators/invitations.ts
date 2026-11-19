import vine from '@vinejs/vine';
import { normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import { INVITABLE_ROLES } from '#services/account_kit/policy';
import {
  accountEmail,
  allowedFields,
  displayName,
  passwordLength,
} from '#validators/request_rules';

const admissionMessage = 'Invalid admission request.';
const emailMessage = 'Invalid invitation email.';
const signUpMessage = 'Invalid sign-up details.';

/**
 * Fields are checked in the order the controller reports them: a role or body-shape failure
 * answers the generic sentence before an email failure does.
 */
export const createValidator = vine.compile(
  vine
    .object({
      role: vine.enum(INVITABLE_ROLES),
      email: vine.string().use(accountEmail()).transform(normalizeAccountEmail),
      companyId: vine.string().minLength(1),
    })
    .use(allowedFields({ fields: ['companyId', 'role', 'email'], message: admissionMessage }))
);
createValidator.messagesProvider = {
  getMessage: (_message, _rule, field) =>
    field.name === 'email' ? emailMessage : admissionMessage,
};

/** The body shape answers the generic sentence; a bad name or password names the sign-up details. */
export const signUpValidator = vine.compile(
  vine
    .object({
      name: vine
        .string()
        .use(displayName())
        .transform((value) => value.trim()),
      password: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['name', 'password'], message: admissionMessage }))
);
signUpValidator.messagesProvider = {
  getMessage: (_message, _rule, field) => (field.name === '' ? admissionMessage : signUpMessage),
};
