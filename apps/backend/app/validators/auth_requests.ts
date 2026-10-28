import vine from '@vinejs/vine';
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import { passwordLengthFailure } from '@capacitylens/shared/domain/password';
import { MAX_NAME_LENGTH } from '@capacitylens/shared/lib/strings';

const accountEmail = vine.createRule((value, _options, field) => {
  if (typeof value === 'string' && !isAccountEmail(normalizeAccountEmail(value))) {
    field.report('Invalid email.', 'accountEmail', field);
  }
});
const passwordLength = vine.createRule((value, _options, field) => {
  if (typeof value === 'string' && passwordLengthFailure(value)) {
    field.report('Invalid password.', 'passwordLength', field);
  }
});
const displayName = vine.createRule((value, _options, field) => {
  if (typeof value === 'string' && (!value.trim() || value.trim().length > MAX_NAME_LENGTH)) {
    field.report('Invalid name.', 'displayName', field);
  }
});
const allowedFields = vine.createRule((value, fields: string[], field) => {
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => !fields.includes(key))
  ) {
    field.report('Unsupported authentication field.', 'unknownField', field);
  }
});

/** Retains the product's email shape, normalization and strict authentication field policy. */
export const signInValidator = vine.compile(
  vine
    .object({
      email: vine.string().use(accountEmail()).transform(normalizeAccountEmail),
      password: vine.string(),
    })
    .use(allowedFields(['email', 'password']))
);

/** Counts password code points and display-name code units, matching the established boundaries. */
export const signUpValidator = vine.compile(
  vine
    .object({
      email: vine.string().use(accountEmail()).transform(normalizeAccountEmail),
      password: vine.string().use(passwordLength()),
      name: vine
        .string()
        .use(displayName())
        .transform((value) => value.trim()),
    })
    .use(allowedFields(['email', 'password', 'name']))
);
