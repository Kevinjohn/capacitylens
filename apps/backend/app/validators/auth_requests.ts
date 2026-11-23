import vine from '@vinejs/vine';
import { normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import {
  accountEmail,
  allowedFields,
  displayName,
  passwordLength,
} from '#validators/request_rules';

/** Retains the product's email shape, normalisation and strict authentication field rules. */
export const signInValidator = vine.create(
  vine
    .object({
      email: vine.string().use(accountEmail()).transform(normalizeAccountEmail),
      password: vine.string(),
    })
    .use(allowedFields({ fields: ['email', 'password'] }))
);

/** Counts password code points and display-name code points, matching the established boundaries. */
export const signUpValidator = vine.create(
  vine
    .object({
      email: vine.string().use(accountEmail()).transform(normalizeAccountEmail),
      password: vine.string().use(passwordLength()),
      name: vine
        .string()
        .use(displayName())
        .transform((value) => value.trim()),
    })
    .use(allowedFields({ fields: ['email', 'password', 'name'] }))
);
