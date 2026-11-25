import vine from '@vinejs/vine';
import { normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import {
  REQUEST_CONTEXT_FIELDS,
  accountEmail,
  allowedFields,
  displayName,
  passwordLength,
  userAgentHeaders,
} from '#validators/request_rules';

/** Retains the product's email shape, normalisation and strict authentication field rules. */
export const signInValidator = vine.create(
  vine
    .object({
      email: vine.string().use(accountEmail()).transform(normalizeAccountEmail),
      password: vine.string(),
      headers: userAgentHeaders(),
    })
    .use(allowedFields({ fields: ['email', 'password', ...REQUEST_CONTEXT_FIELDS] }))
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
      headers: userAgentHeaders(),
    })
    .use(allowedFields({ fields: ['email', 'password', 'name', ...REQUEST_CONTEXT_FIELDS] }))
);
