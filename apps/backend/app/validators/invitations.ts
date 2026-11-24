import vine from '@vinejs/vine';
import { normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import { INVITABLE_ROLES } from '#services/account_kit/admission_rule_service';
import {
  accountEmail,
  allowedFields,
  displayName,
  passwordLength,
} from '#validators/request_rules';

export const createInvitationValidator = vine.create(
  vine
    .object({
      role: vine.enum(INVITABLE_ROLES),
      email: vine.string().use(accountEmail()).transform(normalizeAccountEmail),
      companyId: vine.string().minLength(1),
    })
    .use(allowedFields({ fields: ['companyId', 'role', 'email'] }))
);

export const acceptInvitationSignUpValidator = vine.create(
  vine
    .object({
      name: vine
        .string()
        .use(displayName())
        .transform((value) => value.trim()),
      password: vine.string().use(passwordLength()),
    })
    .use(allowedFields({ fields: ['name', 'password'] }))
);
