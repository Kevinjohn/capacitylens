import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access';
import type { Role } from '@capacitylens/shared/account/types';
import access from '#config/access_control';
import { getActiveMembership, requireStoredRole } from '#services/auth/authorization';
import { effectiveReadPrincipal } from '#services/auth/masquerade';
import type { PlanningCapabilities } from '#services/planning/data_policy';
import { PlanningOperationError } from '#services/planning/errors';

export interface PlanningAuthority {
  actorId: string;
  effectiveActorId: string;
  role: Role;
  canWrite: boolean;
  canSeePrivateNames: boolean;
  canSeeTimeOffNote: boolean;
}

/** Resolves the caller's planning authority and write capabilities inside the transaction. */
export async function resolvePlanningAuthority(trx: TransactionClientContract, accountId: string) {
  const principal = await effectiveReadPrincipal(trx, accountId);
  const membership = await getActiveMembership(principal.effectiveId, accountId, trx);
  if (!membership || (principal.accountId !== null && principal.accountId !== accountId)) {
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
  const authority: PlanningAuthority = {
    actorId: principal.actorId,
    effectiveActorId: principal.effectiveId,
    role,
    canWrite: !masquerading && access.can(role, 'planning:write'),
    canSeePrivateNames: canSeePrivateNames(role),
    canSeeTimeOffNote: canSeeTimeOffNote(role),
  };
  const capabilities: PlanningCapabilities = {
    ...authority,
    canAnonymise: !masquerading && access.can(role, 'resources:anonymise'),
  };
  return { authority, capabilities };
}
