import vine from '@vinejs/vine'
import { normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import {
  REQUEST_CONTEXT_FIELDS,
  accountEmail,
  allowedFields,
  userAgentHeaders,
} from '#validators/request_rules'

/** Retains the product's email shape, normalisation and strict authentication field rules. */
export const signInValidator = vine.create(
  vine
    .object({
      email: vine.string().use(accountEmail()).transform(normalizeAccountEmail),
      password: vine.string(),
      headers: userAgentHeaders(),
    })
    .use(allowedFields({ fields: ['email', 'password', ...REQUEST_CONTEXT_FIELDS] }))
)
