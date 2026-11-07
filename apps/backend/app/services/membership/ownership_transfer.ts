import type { HttpContext } from '@adonisjs/core/http';
import type { OwnershipTransferReceipt } from '@capacitylens/shared/account/types';
import access from '#config/access_control';
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { consumeActionProof } from '#services/auth/action_proof';
import {
  claimAccountCommand,
  completeAccountCommand,
  type AccountCommandIdentity,
} from '#services/account_commands';
import { writeAudit } from '#services/audit';
import { advancePlanningRevision } from '#services/planning_revision';
import { activeOwnerIds } from '#services/membership/package_projection';

export class OwnershipTransferError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

/** Exchanges Owner and Admin inside one product transaction, with exact semantic replay. */
export async function transferOwnership(
  ctx: HttpContext,
  accountId: string,
  toUserId: string,
  proofId: string,
  command: AccountCommandIdentity
): Promise<OwnershipTransferReceipt> {
  return withActor(ctx, async (actor, trx) => {
    if (actor.masqueradeContext?.isMasquerading) {
      throw new IdentityAuthorityError('Masquerade is read-only.');
    }
    const account = await trx.from('accounts').where('id', accountId).select('id').first();
    if (!account) throw new OwnershipTransferError('Company not found.', 404, 'NOT_FOUND');
    const currentRole = await activeCompanyRole(actor.userId, accountId, trx);
    if (!currentRole) throw new IdentityAuthorityError('Forbidden.');

    const claim = await claimAccountCommand(trx, {
      actorId: actor.userId,
      operation: 'transfer-ownership',
      accountId,
      payload: { toUserId },
      command,
      kind: 'semantic',
    });
    if (claim.replayed) {
      const receipt = claim.result as OwnershipTransferReceipt;
      if (receipt.fromUserId !== actor.userId || receipt.toUserId !== toUserId) {
        throw new Error('Invalid ownership transfer receipt.');
      }
      return receipt;
    }
    if (currentRole !== 'owner') throw new IdentityAuthorityError('Forbidden.');
    if (actor.userId === toUserId) {
      throw new OwnershipTransferError('Choose another administrator.', 409, 'TARGET_INELIGIBLE');
    }

    const owners = await activeOwnerIds(trx, accountId);
    if (owners.length !== 1) throw new Error('Company Owner invariant failed.');
    if (owners[0] !== actor.userId) throw new IdentityAuthorityError('Forbidden.');
    const target = await access.memberships.find(accountId, toUserId, trx);
    if (!target) throw new OwnershipTransferError('Member not found.', 404, 'NOT_FOUND');
    if (target.status !== 'active' || target.role !== 'admin') {
      throw new OwnershipTransferError(
        'Target is no longer an active administrator.',
        409,
        'TARGET_INELIGIBLE'
      );
    }
    if ((await activeCompanyRole(toUserId, accountId, trx)) !== 'admin') {
      throw new OwnershipTransferError('Target access is restricted.', 409, 'TARGET_INELIGIBLE');
    }

    await consumeActionProof(trx, actor, proofId, 'transfer-ownership', accountId, { toUserId });

    await access.memberships.transferOwnership({
      actor: { id: actor.userId },
      scopeId: accountId,
      toUserId,
      trx,
    });
    const finalOwners = await activeOwnerIds(trx, accountId);
    if (finalOwners.length !== 1 || finalOwners[0] !== toUserId) {
      throw new Error('Company Owner invariant failed after transfer.');
    }

    await advancePlanningRevision(trx, accountId);
    await writeAudit(trx, {
      accountId,
      actorId: actor.userId,
      action: 'ownership.transferred',
      entity: 'membership',
      entityId: toUserId,
      fields: ['owner'],
    });
    const receipt = { fromUserId: actor.userId, toUserId };
    await completeAccountCommand(trx, command.commandId, receipt);
    return receipt;
  });
}
