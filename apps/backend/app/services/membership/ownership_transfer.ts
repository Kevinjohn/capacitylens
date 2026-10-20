import type { HttpContext } from '@adonisjs/core/http'
import type { OwnershipTransferReceipt } from '@capacitylens/shared/account/types'
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization'
import { activeMasquerade } from '#services/auth/masquerade'
import { assertFreshSession, resolveCurrentActor } from '#services/auth/session_authority'
import {
  claimAccountCommand,
  completeAccountCommand,
  type AccountCommandIdentity,
} from '#services/account_commands'
import { affectedRows } from '#services/admission/affected_rows'
import { writeAudit } from '#services/audit'
import { withTransaction } from '#services/with_transaction'
import { advancePlanningRevision } from '#services/planning_revision'

export class OwnershipTransferError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message)
  }
}

/** Exchanges Owner and Admin inside one product transaction, with exact semantic replay. */
export async function transferOwnership(
  ctx: HttpContext,
  accountId: string,
  toUserId: string,
  command: AccountCommandIdentity
): Promise<OwnershipTransferReceipt> {
  return withTransaction(async (trx) => {
    const actor = await resolveCurrentActor(ctx, trx)
    if (await activeMasquerade(actor.sessionId, trx))
      throw new IdentityAuthorityError('Masquerade is read-only.')
    const account = await trx.from('accounts').where('id', accountId).select('id').first()
    if (!account) throw new OwnershipTransferError('Company not found.', 404, 'NOT_FOUND')
    const currentRole = await activeCompanyRole(actor.userId, accountId, trx)
    if (!currentRole) throw new IdentityAuthorityError('Forbidden.')
    assertFreshSession(actor)

    const claim = await claimAccountCommand(trx, {
      actorId: actor.userId,
      operation: 'transfer-ownership',
      accountId,
      payload: { toUserId },
      command,
      kind: 'semantic',
    })
    if (claim.replayed) {
      const receipt = claim.result as OwnershipTransferReceipt
      if (receipt.fromUserId !== actor.userId || receipt.toUserId !== toUserId)
        throw new Error('Invalid ownership transfer receipt.')
      return receipt
    }
    if (currentRole !== 'owner') throw new IdentityAuthorityError('Forbidden.')
    if (actor.userId === toUserId)
      throw new OwnershipTransferError('Choose another administrator.', 409, 'TARGET_INELIGIBLE')

    const memberships = await trx
      .from('memberships')
      .where('account_id', accountId)
      .select('user_id', 'role', 'status')
    const owners = memberships.filter((row) => row.status === 'active' && row.role === 'owner')
    if (owners.length !== 1) throw new Error('Company Owner invariant failed.')
    if (owners[0].user_id !== actor.userId) throw new IdentityAuthorityError('Forbidden.')
    const target = memberships.find((row) => row.user_id === toUserId)
    if (!target) throw new OwnershipTransferError('Member not found.', 404, 'NOT_FOUND')
    if (target.status !== 'active' || target.role !== 'admin')
      throw new OwnershipTransferError(
        'Target is no longer an active administrator.',
        409,
        'TARGET_INELIGIBLE'
      )
    if ((await activeCompanyRole(toUserId, accountId, trx)) !== 'admin')
      throw new OwnershipTransferError('Target access is restricted.', 409, 'TARGET_INELIGIBLE')

    const now = new Date().toISOString()
    const demoted = await trx
      .from('memberships')
      .where({ account_id: accountId, user_id: actor.userId, role: 'owner', status: 'active' })
      .update({ role: 'admin', updated_at: now })
    if (affectedRows(demoted) !== 1) throw new Error('Owner changed during transfer.')
    const promoted = await trx
      .from('memberships')
      .where({ account_id: accountId, user_id: toUserId, role: 'admin', status: 'active' })
      .update({ role: 'owner', updated_at: now })
    if (affectedRows(promoted) !== 1) throw new Error('Target changed during transfer.')
    const finalOwners = await trx
      .from('memberships')
      .where({ account_id: accountId, role: 'owner', status: 'active' })
      .select('user_id')
    if (finalOwners.length !== 1 || finalOwners[0].user_id !== toUserId)
      throw new Error('Company Owner invariant failed after transfer.')

    await advancePlanningRevision(trx, accountId)
    await trx
      .from('password_reset_tokens')
      .whereIn('tokenable_id', [actor.userId, toUserId])
      .delete()
    await writeAudit(trx, {
      accountId,
      actorId: actor.userId,
      action: 'ownership.transferred',
      entity: 'membership',
      entityId: toUserId,
      fields: ['owner'],
    })
    const receipt = { fromUserId: actor.userId, toUserId }
    await completeAccountCommand(trx, command.commandId, receipt)
    return receipt
  })
}
