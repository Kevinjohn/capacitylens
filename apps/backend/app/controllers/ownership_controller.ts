import type { HttpContext } from '@adonisjs/core/http'
import { AccountCommandError, readAccountCommand } from '#services/account_commands'
import { IdentityAuthorityError } from '#services/auth/authorization'
import { resolveCurrentActor, SessionAuthorityError } from '#services/auth/session_authority'
import { ActionProofError } from '#services/auth/action_proof'
import { OwnershipTransferError, transferOwnership } from '#services/membership/ownership_transfer'

function validBody(value: unknown): value is { toUserId: string; proofId?: string } {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => key === 'toUserId' || key === 'proofId') &&
    'toUserId' in value &&
    typeof value.toUserId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.toUserId) &&
    (!('proofId' in value) ||
      (typeof value.proofId === 'string' && /^[0-9a-f-]{36}$/.test(value.proofId)))
  )
}

export default class OwnershipController {
  async transfer(ctx: HttpContext) {
    if (!validBody(ctx.request.body()))
      return ctx.response.badRequest({
        error: 'An eligible target user is required.',
        code: 'VALIDATION_FAILED',
      })
    try {
      await resolveCurrentActor(ctx)
      const command = readAccountCommand(ctx)
      const receipt = await transferOwnership(
        ctx,
        ctx.params.accountId,
        ctx.request.body().toUserId,
        ctx.request.body().proofId ?? '',
        command
      )
      return ctx.response.ok(receipt)
    } catch (error) {
      if (
        error instanceof AccountCommandError ||
        error instanceof OwnershipTransferError ||
        error instanceof SessionAuthorityError ||
        error instanceof ActionProofError
      )
        return ctx.response.status(error.status).send({ error: error.message, code: error.code })
      if (error instanceof IdentityAuthorityError)
        return ctx.response.forbidden({ error: error.message, code: error.code })
      throw error
    }
  }
}
