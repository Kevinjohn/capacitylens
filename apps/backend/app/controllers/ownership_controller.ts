import type { HttpContext } from '@adonisjs/core/http'
import { authMode } from '#services/auth/mode'
import { AccountCommandError, readAccountCommand } from '#services/account_commands'
import { IdentityAuthorityError } from '#services/auth/authorization'
import { SessionAuthorityError } from '#services/auth/session_authority'
import { OwnershipTransferError, transferOwnership } from '#services/membership/ownership_transfer'

function validBody(value: unknown): value is { toUserId: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).length === 1 &&
    'toUserId' in value &&
    typeof value.toUserId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.toUserId)
  )
}

export default class OwnershipController {
  async transfer(ctx: HttpContext) {
    if (authMode() === 'off')
      return ctx.response.forbidden({
        error: 'Ownership transfer requires sign-in.',
        code: 'FORBIDDEN',
      })
    if (!validBody(ctx.request.body()))
      return ctx.response.badRequest({
        error: 'An eligible target user is required.',
        code: 'VALIDATION_FAILED',
      })
    try {
      const command = readAccountCommand(ctx)
      const receipt = await transferOwnership(
        ctx,
        ctx.params.accountId,
        ctx.request.body().toUserId,
        command
      )
      return ctx.response.ok(receipt)
    } catch (error) {
      if (
        error instanceof AccountCommandError ||
        error instanceof OwnershipTransferError ||
        error instanceof SessionAuthorityError
      )
        return ctx.response.status(error.status).send({ error: error.message, code: error.code })
      if (error instanceof IdentityAuthorityError)
        return ctx.response.forbidden({ error: error.message, code: error.code })
      throw error
    }
  }
}
