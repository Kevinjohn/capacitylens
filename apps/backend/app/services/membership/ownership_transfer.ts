import { RefusalError } from '#exceptions/refusal_error';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { OwnershipTransferReceipt } from '@capacitylens/shared/account/types';
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { refuseWhileViewing } from '#services/auth/password_confirmation';
import { kitContextIn, type CurrentActor } from '#services/auth/current_actor';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { runAccountCommand, type AccountCommandIdentity } from '#services/account_commands';
import access from '#config/access_control';
import { writeAudit } from '#services/audit';
import { advancePlanningRevision } from '#services/planning_revision';

export class OwnershipTransferError extends RefusalError {}

/** One ownership transfer in the caller's transaction, by its verified actor. */
export interface OwnershipTransferInput {
  trx: TransactionClientContract;
  actor: CurrentActor;
  companyId: string;
  toUserId: string;
  confirmationId: string;
  command: AccountCommandIdentity;
}

/** Exchanges Owner and Admin inside one product transaction, with exact semantic replay. */
export async function transferOwnership({
  trx,
  actor,
  companyId,
  toUserId,
  confirmationId,
  command,
}: OwnershipTransferInput): Promise<OwnershipTransferReceipt> {
  let currentRole: Awaited<ReturnType<typeof activeCompanyRole>>;
  return runAccountCommand(trx, {
    name: 'transfer-ownership',
    authorizeAccess: async () => {
      refuseWhileViewing(actor);
      // A membership proves its company exists, so an unknown company is refused like any other
      // company the caller does not belong to.
      currentRole = await activeCompanyRole(actor.userId, companyId, trx);
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
      if (!currentRole || !access.can(currentRole, 'ownership:transfer')) {
        throw new IdentityAuthorityError('Forbidden.');
      }
      if (actor.userId === toUserId) {
        throw new OwnershipTransferError('Choose another administrator.', 409, 'TARGET_INELIGIBLE');
      }
      const target = await access.memberships.find(companyId, toUserId, trx);
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
        .where({ scope_id: companyId, role: 'owner', status: 'active' })
        .count('* as count')
        .first();
      if (Number(owners?.count) !== 1) throw new Error('Company Owner invariant failed.');
      await passwordConfirmations.consume(kitContextIn(trx), {
        confirmationId: authorization,
        action: 'transfer-ownership',
        scope: companyId,
        intent: { toUserId },
      });
    },
    work: async () => {
      await access.memberships.transferOwnership({
        actor: { id: actor.userId },
        scopeId: companyId,
        toUserId,
        trx,
      });
      await advancePlanningRevision(trx, companyId);
      await writeAudit(trx, {
        companyId,
        actorId: actor.userId,
        action: 'ownership.transferred',
        entity: 'membership',
        entityId: toUserId,
        fields: ['owner'],
      });
      return { fromUserId: actor.userId, toUserId };
    },
    actorId: actor.userId,
    scopeId: companyId,
    payload: { toUserId },
    command,
    authorization: confirmationId,
  });
}
