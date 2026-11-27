import { inject } from '@adonisjs/core'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { OwnershipTransferReceipt } from '@capacitylens/shared/account/types'
import { AuthorizationService } from '#services/auth/authorization_service'
import IdentityAuthorizationException from '#exceptions/identity_authorization_exception'
import { PasswordConfirmationService } from '#services/auth/password_confirmation_service'
import { CurrentActorService, type CurrentActor } from '#services/auth/current_actor_service'
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main'
import access from '#config/access_control'
import { AuditService } from '#services/audit_service'
import { PlanningRevisionService } from '#services/planning_revision_service'
import {
  AccountOperationService,
  type AccountOperationIdentity,
} from '#services/account_operation_service'
import TargetIneligibleException from '#exceptions/target_ineligible_exception'
import NotFoundException from '#exceptions/not_found_exception'
import IdempotencyConflictException from '#exceptions/idempotency_conflict_exception'

/** One ownership transfer in the caller's transaction, by its verified actor. */
export interface OwnershipTransferInput {
  trx: TransactionClientContract
  actor: CurrentActor
  companyId: string
  toUserId: string
  confirmationId: string
  command: AccountOperationIdentity
}

/** Ownership transfer between a company's Owner and one of its Admins. */
@inject()
export class OwnershipTransferService {
  #authorization: AuthorizationService
  #passwordConfirmationRules: PasswordConfirmationService
  #currentActor: CurrentActorService
  #audit: AuditService
  #planningRevisions: PlanningRevisionService
  #accountOperations: AccountOperationService

  constructor(
    authorization: AuthorizationService,
    passwordConfirmationRules: PasswordConfirmationService,
    currentActor: CurrentActorService,
    audit: AuditService,
    planningRevisions: PlanningRevisionService,
    accountOperations: AccountOperationService
  ) {
    this.#authorization = authorization
    this.#passwordConfirmationRules = passwordConfirmationRules
    this.#currentActor = currentActor
    this.#audit = audit
    this.#planningRevisions = planningRevisions
    this.#accountOperations = accountOperations
  }

  /** Exchanges Owner and Admin inside one product transaction, with exact semantic replay. */
  async transfer({
    trx,
    actor,
    companyId,
    toUserId,
    confirmationId,
    command,
  }: OwnershipTransferInput): Promise<OwnershipTransferReceipt> {
    let currentRole: Awaited<ReturnType<AuthorizationService['getActiveCompanyRole']>>
    return this.#accountOperations.runAccountOperation(trx, {
      name: 'transfer-ownership',
      authorizeAccess: async () => {
        this.#passwordConfirmationRules.refuseWhileViewing(actor)
        // A membership proves its company exists, so an unknown company is refused like any other
        // company the caller does not belong to.
        currentRole = await this.#authorization.getActiveCompanyRole(actor.userId, companyId, trx)
        if (!currentRole) throw new IdentityAuthorizationException()
      },
      authorizeReplay: (_context, receipt) => {
        // A receipt for another actor or target reuses this operation id for a different transfer.
        if (receipt.fromUserId !== actor.userId || receipt.toUserId !== toUserId) {
          throw new IdempotencyConflictException()
        }
      },
      // The controller supplies a string; eligibility checks must precede the empty-confirmation refusal.
      parseAuthorization: (raw) => raw as string,
      authorizeExecute: async (_context, authorization) => {
        if (!currentRole || !access.can(currentRole, 'ownership:transfer')) {
          throw new IdentityAuthorizationException()
        }
        if (actor.userId === toUserId) {
          throw new TargetIneligibleException('Choose another Admin.')
        }
        const target = await access.memberships.find(companyId, toUserId, trx)
        if (!target) throw new NotFoundException('Member not found.')
        // The package accepts any active member; CapacityLens hands ownership to an Admin only.
        if (target.status !== 'active' || target.role !== 'admin') {
          throw new TargetIneligibleException('Target is no longer an active Admin.')
        }
        // The package checks only the actor and nominee, so a second stored Owner would survive it.
        const owners = await trx
          .from(access.config.membershipsTable)
          .where({ scope_id: companyId, role: 'owner', status: 'active' })
          .count('* as count')
          .first()
        if (Number(owners?.count) !== 1) throw new Error('Company Owner invariant failed.')
        await passwordConfirmations.consume(this.#currentActor.requireKitContext(trx), {
          confirmationId: authorization,
          action: 'transfer-ownership',
          scope: companyId,
          intent: { toUserId },
        })
      },
      work: async () => {
        await access.memberships.transferOwnership({
          actor: { id: actor.userId },
          scopeId: companyId,
          toUserId,
          trx,
        })
        await this.#planningRevisions.advancePlanningRevision(trx, companyId)
        await this.#audit.writeAudit(trx, {
          companyId,
          actorId: actor.userId,
          action: 'ownership.transferred',
          entity: 'membership',
          entityId: toUserId,
          fields: ['owner'],
        })
        return { fromUserId: actor.userId, toUserId }
      },
      actorId: actor.userId,
      scopeId: companyId,
      payload: { toUserId },
      command,
      authorization: confirmationId,
    })
  }
}
