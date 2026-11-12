import { RefusalError } from '#exceptions/refusal_error';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types';
import access from '#config/access_control';
import { writeAudit } from '#services/audit';
import { requireStoredRole } from '#services/auth/authorization';
import { resetMemberSignIn } from '#services/membership/sign_in_tracking';
import { advancePlanningRevision } from '#services/planning_revision';

export class MembershipError extends RefusalError {}

async function targetMember(trx: TransactionClientContract, accountId: string, userId: string) {
  const member = await access.memberships.find(accountId, userId, trx);
  if (!member) throw new MembershipError('Not a member of this company.', 404, 'NOT_FOUND');
  requireStoredRole(member);
  return member;
}

/** Changes an active non-Owner role; the package refuses self, Owner and higher-rank targets. */
export async function changeMemberRole(
  trx: TransactionClientContract,
  input: { accountId: string; actorId: string; userId: string; role: Role }
) {
  const member = await targetMember(trx, input.accountId, input.userId);
  // The package would change a suspended member's role; CapacityLens changes active members only.
  if (member.status !== 'active') throw new MembershipError('Forbidden.', 403, 'FORBIDDEN');
  if (input.role === 'owner') {
    throw new MembershipError(
      'Transfer ownership to assign the Owner role.',
      400,
      'OWNER_TRANSFER_REQUIRED'
    );
  }
  await access.memberships.changeRole({
    actor: { id: input.actorId },
    scopeId: input.accountId,
    userId: input.userId,
    role: input.role,
    trx,
  });
  if (member.role !== input.role) {
    await advancePlanningRevision(trx, input.accountId);
    await writeAudit(trx, {
      accountId: input.accountId,
      actorId: input.actorId,
      action: 'member.role_changed',
      entity: 'membership',
      entityId: input.userId,
      fields: ['role'],
    });
  }
  return { userId: input.userId, role: input.role };
}

/** Suspends or restores a member; the package refuses self, Owner and higher-rank targets. */
export async function changeMemberStatus(
  trx: TransactionClientContract,
  input: { accountId: string; actorId: string; userId: string; status: MembershipStatus }
) {
  const member = await targetMember(trx, input.accountId, input.userId);
  await access.memberships.setStatus({
    actor: { id: input.actorId },
    scopeId: input.accountId,
    userId: input.userId,
    status: input.status,
    trx,
  });
  if (member.status !== input.status) {
    await resetMemberSignIn(input.accountId, input.userId, trx);
    await advancePlanningRevision(trx, input.accountId);
    await writeAudit(trx, {
      accountId: input.accountId,
      actorId: input.actorId,
      action: 'member.status_changed',
      entity: 'membership',
      entityId: input.userId,
      fields: ['status'],
    });
  }
  return { userId: input.userId, status: input.status };
}
