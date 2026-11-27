import vine, { errors } from '@vinejs/vine'
import type { FieldContext } from '@vinejs/vine/types'
import type { HttpContext } from '@adonisjs/core/http'
import {
  isAccountCommandId,
  isAccountEmail,
  isAccountIdempotencyKey,
  normalizeAccountEmail,
} from '@capacitylens/shared/account/validation'
import { getPasswordLengthFailure } from '@capacitylens/shared/domain/password'
import { MAX_NAME_LENGTH, countUnicodeCharacters } from '@capacitylens/shared/lib/strings'

/** The keys AdonisJS `request.validateUsing` places beside request data at the root. */
export const REQUEST_CONTEXT_FIELDS = ['params', 'headers', 'cookies']

/** Refuses a body that carries a key outside `fields`. */
export const allowedFields = vine.createRule((value, options: { fields: string[] }, field) => {
  const allowed =
    field.wildCardPath === '' ? [...options.fields, ...REQUEST_CONTEXT_FIELDS] : options.fields
  if (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).some((key) => !allowed.includes(key))
  ) {
    field.report('Unsupported field.', 'unknownField', field)
  }
})

/**
 * Pass to `requiredWhen` on an optional field: the key may be left out, but a supplied `null`
 * is refused rather than read as missing.
 */
export function isSupplied(field: FieldContext) {
  return Object.hasOwn(field.parent as object, field.name)
}

/** Reset and confirmation links are opaque bearers of bounded length. */
export function isBearerToken(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 512
}

export const bearerToken = vine.createRule((value, _options, field) => {
  if (!isBearerToken(value)) field.report('Invalid token.', 'bearerToken', field)
})

export const accountEmail = vine.createRule((value, _options, field) => {
  if (typeof value === 'string' && !isAccountEmail(normalizeAccountEmail(value))) {
    field.report('Invalid email.', 'accountEmail', field)
  }
})

export const passwordLength = vine.createRule((value, _options, field) => {
  if (typeof value === 'string' && getPasswordLengthFailure(value)) {
    field.report('Invalid password.', 'passwordLength', field)
  }
})

export const displayName = vine.createRule((value, _options, field) => {
  if (
    typeof value === 'string' &&
    (!value.trim() || countUnicodeCharacters(value.trim()) > MAX_NAME_LENGTH)
  ) {
    field.report('Invalid name.', 'displayName', field)
  }
})

/** Account identity ids accepted in admission, member and ownership requests. */
export const USER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

/**
 * The data a credential or bearer-token validator reads: the request body alone (departure 22),
 * with route parameters and headers beside it under `params` and `headers`, so credentials are
 * never accepted from a URL query string. A body that carries one of those keys itself is refused
 * rather than overwritten.
 */
export function requestData(request: HttpContext['request'], source: unknown = {}) {
  const fields = source !== null && typeof source === 'object' ? source : {}
  const clash = REQUEST_CONTEXT_FIELDS.find((key) => Object.hasOwn(fields, key))
  if (clash) {
    throw new errors.E_VALIDATION_ERROR([
      { message: 'Unsupported field.', rule: 'unknownField', field: clash },
    ])
  }
  return { ...fields, params: request.params(), headers: request.headers() }
}

/** A route's company id; the route already bounds it to 1 to 254 characters. */
export const companyIdParam = () => vine.string().minLength(1).maxLength(254)

/** A route's account identity id. */
export const userIdParam = () => vine.string().regex(USER_ID_PATTERN)

/** A route's numeric id: a positive safe integer. */
export const positiveIdParam = () =>
  vine.number().withoutDecimals().positive().max(Number.MAX_SAFE_INTEGER)

/** A route's bearer link token. */
export const tokenParam = () => vine.string().use(bearerToken())

const accountCommandId = vine.createRule((value, _options, field) => {
  if (!isAccountCommandId(value)) field.report('Invalid operation id.', 'accountCommandId', field)
})

const accountIdempotencyKey = vine.createRule((value, _options, field) => {
  if (!isAccountIdempotencyKey(value)) {
    field.report('Invalid idempotency key.', 'accountIdempotencyKey', field)
  }
})

/**
 * The paired account-operation headers, `X-Account-Operation-Id` and `Idempotency-Key`: both or
 * neither. The action mints both for a caller that sends neither, as the browser does.
 */
export const accountOperationHeaders = () =>
  vine.object({
    'x-account-operation-id': vine
      .string()
      .use(accountCommandId())
      .optional()
      .requiredIfExists('idempotency-key'),
    'idempotency-key': vine
      .string()
      .use(accountIdempotencyKey())
      .optional()
      .requiredIfExists('x-account-operation-id'),
  })

/** The client's `User-Agent`, recorded with a new sign-in. */
export const userAgentHeaders = () => vine.object({ 'user-agent': vine.string().optional() })
