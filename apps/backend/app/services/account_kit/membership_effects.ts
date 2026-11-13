import type { AccountKitConfig } from '@kevinjohn/adonisjs-account-kit';
import type { AccountUser, Invitation, Trx } from '@kevinjohn/adonisjs-account-kit/types';
import access from '#config/access_control';
import { advancePlanningRevision } from '#services/planning_revision';
import { writeAudit } from '#services/audit';

type AccountDeleting = NonNullable<AccountKitConfig['onAccountDeletingTransaction']>;

/**
 * Records an accepted company invitation after Access Control created its membership, in the same
 * transaction. An invitation without a company, such as the operator's bootstrap invitation,
 * creates no membership and records nothing.
 */
export async function recordInvitationAccepted(
  user: AccountUser,
  invitation: Invitation,
  trx: Trx
) {
  if (invitation.scope === null) return;
  await writeAudit(trx, {
    accountId: invitation.scope,
    actorId: String(user.id),
    action: 'invitation.accepted',
    entity: 'membership',
    entityId: String(user.id),
    fields: ['role'],
  });
  await advancePlanningRevision(trx, invitation.scope);
}

/**
 * Wraps Access Control's account-deletion callback, which removes the memberships and refuses an
 * active Owner. For each company the person belonged to, the member/person link goes with the
 * membership; the person resource and audit rows stay.
 */
export function withDeletionRecords(removeMemberships: AccountDeleting): AccountDeleting {
  return async (user, trx) => {
    const userId = String(user.id);
    const memberships = await access.memberships.listForUser(userId, trx);
    await removeMemberships(user, trx);
    for (const membership of memberships) {
      const accountId = String(membership.scopeId);
      await trx
        .from('account_member_resources')
        .where({ account_id: accountId, user_id: userId })
        .delete();
      await writeAudit(trx, {
        accountId,
        actorId: userId,
        action: 'identity.deleted',
        entity: 'user',
        entityId: userId,
        fields: [],
      });
      await advancePlanningRevision(trx, accountId);
    }
  };
}
