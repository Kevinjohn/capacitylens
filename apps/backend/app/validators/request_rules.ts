import vine from '@vinejs/vine';
import type { FieldContext, MessagesProviderContact } from '@vinejs/vine/types';
import { isAccountEmail, normalizeAccountEmail } from '@capacitylens/shared/account/validation';
import { getPasswordLengthFailure } from '@capacitylens/shared/domain/password';
import { MAX_NAME_LENGTH, countUnicodeCharacters } from '@capacitylens/shared/lib/strings';

/** Refuses a body that carries a key outside `fields`, reporting the route's own sentence. */
export const allowedFields = vine.createRule(
  (value, options: { fields: string[]; message: string }, field) => {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).some((key) => !options.fields.includes(key))
    ) {
      field.report(options.message, 'unknownField', field);
    }
  }
);

/** Answers every failure of a validator with one sentence, the one its route has always sent. */
export function fixedMessage(sentence: string): MessagesProviderContact {
  return { getMessage: () => sentence };
}

/**
 * Pass to `requiredWhen` on an optional field: the key may be left out, but a supplied `null`
 * is refused rather than read as missing.
 */
export function isSupplied(field: FieldContext) {
  return Object.hasOwn(field.parent as object, field.name);
}

/** Reset and confirmation links are opaque bearers of bounded length. */
export function isBearerToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

export const bearerToken = vine.createRule((value, _options, field) => {
  if (!isBearerToken(value)) field.report('Invalid token.', 'bearerToken', field);
});

export const accountEmail = vine.createRule((value, _options, field) => {
  if (typeof value === 'string' && !isAccountEmail(normalizeAccountEmail(value))) {
    field.report('Invalid email.', 'accountEmail', field);
  }
});

export const passwordLength = vine.createRule((value, _options, field) => {
  if (typeof value === 'string' && getPasswordLengthFailure(value)) {
    field.report('Invalid password.', 'passwordLength', field);
  }
});

export const displayName = vine.createRule((value, _options, field) => {
  if (
    typeof value === 'string' &&
    (!value.trim() || countUnicodeCharacters(value.trim()) > MAX_NAME_LENGTH)
  ) {
    field.report('Invalid name.', 'displayName', field);
  }
});
