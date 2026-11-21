import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access';
import access from '#config/access_control';
import { getActiveMembership, requireStoredRole } from '#services/auth/authorization';
import { resolveEffectiveReadPrincipal } from '#services/auth/masquerade';
import type { PlanningAccessGrant } from '#services/planning/access_grant';
import { PlanningOperationError } from '#services/planning/errors';

/** The verified actor behind one planning operation and what that member may do and see. */
export interface PlanningAccess extends PlanningAccessGrant {
  actorId: string;
  effectiveActorId: string;
}

/** Resolves the caller's planning access and access grant inside the transaction. */
export async function resolvePlanningAccess(trx: TransactionClientContract, companyId: string) {
  const principal = await resolveEffectiveReadPrincipal(trx, companyId);
  const membership = await getActiveMembership(principal.effectiveId, companyId, trx);
  if (!membership || (principal.companyId !== null && principal.companyId !== companyId)) {
    throw new PlanningOperationError(
      403,
      'ACCOUNT_MEMBERSHIP_LOST',
      'Company membership is unavailable.'
    );
  }
  // Abilities belong to the effective member, whose membership this is.
  const role = requireStoredRole(membership);
  if (!access.can(role, 'planning:read')) {
    throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'This action is not allowed.');
  }
  const masquerading = principal.isMasquerading;
  const planningAccess: PlanningAccess = {
    actorId: principal.actorId,
    effectiveActorId: principal.effectiveId,
    role,
    canWrite: !masquerading && access.can(role, 'planning:write'),
    canSeePrivateNames: canSeePrivateNames(role),
    canSeeTimeOffNote: canSeeTimeOffNote(role),
  };
  const accessGrant: PlanningAccessGrant = planningAccess;
  return { planningAccess, accessGrant };
}
