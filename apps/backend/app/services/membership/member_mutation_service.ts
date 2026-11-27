import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { MembershipStatus, Role } from '@capacitylens/shared/account/types'
import access from '#config/access_control'
import { AuthorizationService } from '#services/auth/authorization_service'
import { MemberSignInTrackingService } from '#services/membership/member_sign_in_tracking_service'
import { AuditService } from '#services/audit_service'
import { PlanningRevisionService } from '#services/planning_revision_service'
import OwnerTransferRequiredException from '#exceptions/owner_transfer_required_exception'
import ForbiddenException from '#exceptions/forbidden_exception'
import NotFoundException from '#exceptions/not_found_exception'

/** Role and status changes to a company member. */
@inject()
export class MemberMutationService {
  #authorization: AuthorizationService
  #signInTracking: MemberSignInTrackingService
  #audit: AuditService
  #planningRevisions: PlanningRevisionService

  constructor(
    signInTracking: MemberSignInTrackingService,
    authorization: AuthorizationService,
    audit: AuditService,
    planningRevisions: PlanningRevisionService
  ) {
    this.#signInTracking = signInTracking
    this.#authorization = authorization
    this.#audit = audit
    this.#planningRevisions = planningRevisions
  }

  async #requireTargetMember(trx: TransactionClientContract, companyId: string, userId: string) {
    const member = await access.memberships.find(companyId, userId, trx)
    if (!member) throw new NotFoundException('Not a member of this company.')
    this.#authorization.requireStoredRole(member)
    return member
  }

  /** Changes an active non-Owner role; the package refuses self, Owner and higher-rank targets. */
  async changeRole(
    trx: TransactionClientContract,
    input: { companyId: string; actorId: string; userId: string; role: Role }
  ) {
    const member = await this.#requireTargetMember(trx, input.companyId, input.userId)
    // The package would change a suspended member's role; CapacityLens changes active members only.
    if (member.status !== 'active') throw new ForbiddenException()
    if (input.role === 'owner') {
      throw new OwnerTransferRequiredException()
    }
    await access.memberships.changeRole({
      actor: { id: input.actorId },
      scopeId: input.companyId,
      userId: input.userId,
      role: input.role,
      trx,
    })
    if (member.role !== input.role) {
      await this.#planningRevisions.advancePlanningRevision(trx, input.companyId)
      await this.#audit.writeAudit(trx, {
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'member.role_changed',
        entity: 'membership',
        entityId: input.userId,
        fields: ['role'],
      })
    }
    return { userId: input.userId, role: input.role }
  }

  /** Suspends or restores a member; the package refuses self, Owner and higher-rank targets. */
  async changeStatus(
    trx: TransactionClientContract,
    input: { companyId: string; actorId: string; userId: string; status: MembershipStatus }
  ) {
    const member = await this.#requireTargetMember(trx, input.companyId, input.userId)
    await access.memberships.setStatus({
      actor: { id: input.actorId },
      scopeId: input.companyId,
      userId: input.userId,
      status: input.status,
      trx,
    })
    if (member.status !== input.status) {
      await this.#signInTracking.resetSignIn(input.companyId, input.userId, trx)
      await this.#planningRevisions.advancePlanningRevision(trx, input.companyId)
      await this.#audit.writeAudit(trx, {
        companyId: input.companyId,
        actorId: input.actorId,
        action: 'member.status_changed',
        entity: 'membership',
        entityId: input.userId,
        fields: ['status'],
      })
    }
    return { userId: input.userId, status: input.status }
  }
}
