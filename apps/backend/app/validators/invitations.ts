import vine from '@vinejs/vine'
import { normalizeAccountEmail } from '@capacitylens/shared/account/validation'
import { INVITABLE_ROLES } from '#services/account_kit/admission_rule_service'
import {
  REQUEST_CONTEXT_FIELDS,
  accountEmail,
  allowedFields,
  companyIdParam,
  displayName,
  passwordLength,
  positiveIdParam,
  tokenParam,
  userAgentHeaders,
} from '#validators/request_rules'

const invitationParams = () =>
  vine.object({ params: vine.object({ companyId: companyIdParam(), id: positiveIdParam() }) })

export const createInvitationValidator = vine.create(
  vine
    .object({
      role: vine.enum(INVITABLE_ROLES),
      email: vine.string().use(accountEmail()).transform(normalizeAccountEmail),
      companyId: vine.string().minLength(1),
    })
    .use(allowedFields({ fields: ['companyId', 'role', 'email'] }))
)

export const acceptInvitationSignUpValidator = vine.create(
  vine
    .object({
      name: vine
        .string()
        .use(displayName())
        .transform((value) => value.trim()),
      password: vine.string().use(passwordLength()),
      params: vine.object({ token: tokenParam() }),
      headers: userAgentHeaders(),
    })
    .use(allowedFields({ fields: ['name', 'password', ...REQUEST_CONTEXT_FIELDS] }))
)

/** What an invitation link offers; the token is the route's. */
export const showInvitationLinkValidator = vine.create(
  vine.object({ params: vine.object({ token: tokenParam() }) })
)

export const listInvitationsValidator = vine.create(
  vine.object({ params: vine.object({ companyId: companyIdParam() }) })
)

export const resendInvitationValidator = vine.create(invitationParams())

export const revokeInvitationValidator = vine.create(invitationParams())
