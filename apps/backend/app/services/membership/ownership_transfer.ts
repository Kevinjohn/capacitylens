import { RefusalError } from '#exceptions/refusal_error';
import type { HttpContext } from '@adonisjs/core/http';
import type { OwnershipTransferReceipt } from '@capacitylens/shared/account/types';
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { withActor, kitContextIn } from '#services/auth/current_actor';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { runAccountCommand, type AccountCommandIdentity } from '#services/account_commands';
import access from '#config/access_control';
import { writeAudit } from '#services/audit';
import { advancePlanningRevision } from '#services/planning_revision';

export class OwnershipTransferError extends RefusalError {}

/** Exchanges Owner and Admin inside one product transaction, with exact semantic replay. */
export async function transferOwnership(
  ctx: HttpContext,
  accountId: string,
  toUserId: string,
  confirmationId: string,
  command: AccountCommandIdentity
): Promise<OwnershipTransferReceipt> {
  return withActor(ctx, async (actor, trx) => {
    let currentRole: Awaited<ReturnType<typeof activeCompanyRole>>;
    return runAccountCommand(trx, {
      name: 'transfer-ownership',
      authorizeAccess: async () => {
        if (actor.masqueradeContext?.isMasquerading) {
          throw new IdentityAuthorityError('Masquerade is read-only.');
        }
        const account = await trx.from('accounts').where('id', accountId).select('id').first();
        if (!account) throw new OwnershipTransferError('Company not found.', 404, 'NOT_FOUND');
        currentRole = await activeCompanyRole(actor.userId, accountId, trx);
        if (!currentRole) throw new IdentityAuthorityError('Forbidden.');
      },
      authorizeReplay: (_context, receipt) => {
        if (receipt.fromUserId !== actor.userId || receipt.toUserId !== toUserId) {
          throw new Error('Invalid ownership transfer receipt.');
        }
      },
      // The controller supplies a string; eligibility checks must precede empty-confirmation rejection.
      parseAuthorization: (raw) => raw as string,
      authorizeExecute: async (_context, authorization) => {
        if (currentRole !== 'owner') throw new IdentityAuthorityError('Forbidden.');
        if (actor.userId === toUserId) {
          throw new OwnershipTransferError(
            'Choose another administrator.',
            409,
            'TARGET_INELIGIBLE'
          );
        }
        const target = await access.memberships.find(accountId, toUserId, trx);
        if (!target) throw new OwnershipTransferError('Member not found.', 404, 'NOT_FOUND');
        // The package accepts any active member; CapacityLens hands ownership to an Admin only.
        if (target.status !== 'active' || target.role !== 'admin') {
          throw new OwnershipTransferError(
            'Target is no longer an active administrator.',
            409,
            'TARGET_INELIGIBLE'
          );
        }
        // The package checks only the actor and nominee, so a second stored Owner would survive it.
        const owners = await trx
          .from(access.config.membershipsTable)
          .where({ scope_id: accountId, role: 'owner', status: 'active' })
          .count('* as count')
          .first();
        if (Number(owners?.count) !== 1) throw new Error('Company Owner invariant failed.');
        await passwordConfirmations.consume(kitContextIn(trx), {
          confirmationId: authorization,
          action: 'transfer-ownership',
          scope: accountId,
          intent: { toUserId },
        });
      },
      work: async () => {
        await access.memberships.transferOwnership({
          actor: { id: actor.userId },
          scopeId: accountId,
          toUserId,
          trx,
        });
        await advancePlanningRevision(trx, accountId);
        await writeAudit(trx, {
          accountId,
          actorId: actor.userId,
          action: 'ownership.transferred',
          entity: 'membership',
          entityId: toUserId,
          fields: ['owner'],
        });
        return { fromUserId: actor.userId, toUserId };
      },
      actorId: actor.userId,
      scopeId: accountId,
      payload: { toUserId },
      command,
      authorization: confirmationId,
    });
  });
}
