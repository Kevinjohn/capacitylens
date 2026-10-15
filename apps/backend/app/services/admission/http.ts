import type { HttpContext } from '@adonisjs/core/http'
import { AccountCommandError } from '#services/account_commands'
import { IdentityAuthorityError } from '#services/auth/authorization'
import { SessionAuthorityError } from '#services/auth/session_authority'
import { AdmissionError } from './errors.js'

/** Renders only safe admission failures; unexpected failures reach the central handler. */
export function renderAdmissionFailure(ctx: HttpContext, error: unknown) {
  if (error instanceof AdmissionError || error instanceof AccountCommandError)
    return ctx.response.status(error.status).send({ error: error.message, code: error.code })
  if (error instanceof SessionAuthorityError)
    return ctx.response.status(error.status).send({ error: error.message, code: error.code })
  if (error instanceof IdentityAuthorityError)
    return ctx.response.forbidden({ error: 'Forbidden.', code: error.code })
  throw error
}
