import { inject } from '@adonisjs/core';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { canSeePrivateNames, canSeeTimeOffNote } from '@capacitylens/shared/domain/access';
import access from '#config/access_control';
import { AuthorizationService } from '#services/auth/authorization_service';
import { MasqueradeModeService } from '#services/auth/masquerade_mode_service';
import type { PlanningAccessGrant } from '#services/planning/access_grant';
import MembershipLostException from '#exceptions/membership_lost_exception';
import PlanningAuthorizationException from '#exceptions/planning_authorization_exception';

/** The verified actor behind one planning operation and what that member may do and see. */
export interface PlanningAccess extends PlanningAccessGrant {
  actorId: string;
  effectiveActorId: string;
}

/** The caller's planning access, resolved inside the caller's transaction. */
@inject()
export class PlanningAccessService {
  #masqueradeModes: MasqueradeModeService;
  #authorization: AuthorizationService;

  constructor(masqueradeModes: MasqueradeModeService, authorization: AuthorizationService) {
    this.#masqueradeModes = masqueradeModes;
    this.#authorization = authorization;
  }

  /** Resolves the caller's planning access and access grant inside the transaction. */
  async resolvePlanningAccess(trx: TransactionClientContract, companyId: string) {
    const user = await this.#masqueradeModes.resolveEffectiveReadUser(
      trx,
      companyId,
      () => new MembershipLostException()
    );
    const membership = await this.#authorization.getActiveMembership(
      user.effectiveId,
      companyId,
      trx
    );
    if (!membership || (user.companyId !== null && user.companyId !== companyId)) {
      throw new MembershipLostException();
    }
    // Abilities belong to the effective member, whose membership this is.
    const role = this.#authorization.requireStoredRole(membership);
    if (!access.can(role, 'planning:read')) {
      throw new PlanningAuthorizationException();
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
}
