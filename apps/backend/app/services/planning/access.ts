import app from '@adonisjs/core/services/app';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access';
import access from '#config/access_control';
import { AuthorizationService } from '#services/auth/authorization_service';
import { MasqueradeModeService } from '#services/auth/masquerade_mode_service';
import type { PlanningAccessGrant } from '#services/planning/access_grant';
import {
  PlanningOperationException,
  membershipUnavailable,
} from '#exceptions/planning_operation_exception';

/** The verified actor behind one planning operation and what that member may do and see. */
export interface PlanningAccess extends PlanningAccessGrant {
  actorId: string;
  effectiveActorId: string;
}

/** Resolves the caller's planning access and access grant inside the transaction. */
export async function resolvePlanningAccess(trx: TransactionClientContract, companyId: string) {
  const masqueradeModes = await app.container.make(MasqueradeModeService);
  const authorization = await app.container.make(AuthorizationService);
  const user = await masqueradeModes.resolveEffectiveReadUser(
    trx,
    companyId,
    membershipUnavailable
  );
  const membership = await authorization.getActiveMembership(user.effectiveId, companyId, trx);
  if (!membership || (user.companyId !== null && user.companyId !== companyId)) {
    throw new PlanningOperationException(
      403,
      'ACCOUNT_MEMBERSHIP_LOST',
      'Company membership is unavailable.'
    );
  }
  // Abilities belong to the effective member, whose membership this is.
  const role = authorization.requireStoredRole(membership);
  if (!access.can(role, 'planning:read')) {
    throw new PlanningOperationException(
      403,
      'AUTHORIZATION_DENIED',
      'This action is not allowed.'
    );
  }
  const masquerading = user.isMasquerading;
  const planningAccess: PlanningAccess = {
    actorId: user.actorId,
    effectiveActorId: user.effectiveId,
    role,
    canWrite: !masquerading && access.can(role, 'planning:write'),
    canSeePrivateNames: canSeePrivateNames(role),
    canSeeTimeOffNote: canSeeTimeOffNote(role),
  };
  const accessGrant: PlanningAccessGrant = planningAccess;
  return { planningAccess, accessGrant };
}
