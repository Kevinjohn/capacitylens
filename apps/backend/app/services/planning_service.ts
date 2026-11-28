import { inject } from '@adonisjs/core'
import {
  buildActiveData,
  archiveImpact,
  archiveRecovery,
} from '@capacitylens/shared/domain/lifecycle'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { AppData, ISODate } from '@capacitylens/shared/types/entities'
import capacitylens from '#config/capacitylens'
import { readCompanyToday } from '#services/company_today'
import Company from '#models/company'
import { StateRepositoryService } from '#services/state_repository_service'
import { transformState } from '#transformers/state_transformer'
import type { CurrentActor } from '#services/auth/current_actor_service'
import { PlanningRevisionService } from '#services/planning_revision_service'
import { PlanningExecutionService } from '#services/planning/planning_execution_service'
import {
  PlanningAccessService,
  type PlanningAccess,
} from '#services/planning/planning_access_service'
import {
  changesNothing,
  isRestorationInvalidated,
  listAuditedEntities,
  buildProjectionChanges,
} from '#services/planning/mutation_changes'
import { AuditService } from '#services/audit_service'
import { buildSaveAdvisory } from '#services/planning/save_advisory'
import { RestorationService } from '#services/planning/restoration_service'
import {
  NO_HISTORY,
  PlanningHistoryService,
  type HistoryEntries,
  type HistoryEntry,
  type HistoryOwner,
} from '#services/planning/planning_history_service'
import { buildInverseIntent } from '#services/planning/inverse'
import type {
  PlanningHistoryState,
  PlanningHistoryStepInput,
  PlanningIntent,
  PlanningMutationInput,
  PlanningMutationSuccess,
} from '#validators/planning/contracts'
import EmptyHistoryException from '#exceptions/empty_history_exception'
import PlanningAuthorizationException from '#exceptions/planning_authorization_exception'
import MutationIdReusedException from '#exceptions/mutation_id_reused_exception'
import NoChangeException from '#exceptions/no_change_exception'
import RestorationConfirmationRequiredException from '#exceptions/restoration_confirmation_required_exception'
import RestorationConfirmationStaleException from '#exceptions/restoration_confirmation_stale_exception'

export type { PlanningAccess }

/** One planning mutation in the caller's transaction, by its verified actor. */
export interface PlanningMutationOptions {
  trx: TransactionClientContract
  actor: CurrentActor
  companyId: string
  input: PlanningMutationInput
}

/** One step back or forward through the caller's own history, in the caller's transaction. */
export interface PlanningHistoryStepOptions {
  trx: TransactionClientContract
  actor: CurrentActor
  companyId: string
  input: PlanningHistoryStepInput
  step: 'undo' | 'redo'
}

interface PlanningReadBase {
  companyId: string
  revision: number
  access: PlanningAccess
  /** The company's current calendar date in its own time zone. */
  today: ISODate
  /** Whether the reading page can undo or redo; both false when it named no history. */
  history: PlanningHistoryState
}

/** A planning read: the complete projected data, or none when the reader named the current
 * revision as the one it already holds. */
export type PlanningRead =
  | (PlanningReadBase & { content: 'full'; data: AppData })
  | (PlanningReadBase & { content: 'unchanged' })

interface CommitOptions {
  trx: TransactionClientContract
  actor: CurrentActor
  companyId: string
  meta: Pick<
    PlanningMutationInput,
    'mutationId' | 'baseRevision' | 'confirmedRestorationCount' | 'expectedUpdatedAt' | 'historyId'
  >
  step: 'new' | 'undo' | 'redo'
  /** The intent of a new change; a history step takes its intent from the stored entry. */
  supplied: PlanningIntent | null
}

/** Planning reads and committed changes in the caller's transaction. */
@inject()
export class PlanningService {
  #planningRevisions: PlanningRevisionService
  #stateRepository: StateRepositoryService
  #audit: AuditService
  #access: PlanningAccessService
  #execution: PlanningExecutionService
  #restoration: RestorationService
  #history: PlanningHistoryService

  constructor(
    planningRevisions: PlanningRevisionService,
    stateRepository: StateRepositoryService,
    audit: AuditService,
    access: PlanningAccessService,
    execution: PlanningExecutionService,
    restoration: RestorationService,
    history: PlanningHistoryService
  ) {
    this.#planningRevisions = planningRevisions
    this.#stateRepository = stateRepository
    this.#audit = audit
    this.#access = access
    this.#execution = execution
    this.#restoration = restoration
    this.#history = history
  }

  /** Resolves current planning access, revision and rows from the same database snapshot. When
   * `page.ifRevision` is exactly the current revision the rows are neither read nor sent: the reply
   * carries only the access, revision, company date and history. */
  async readPlanning(
    trx: TransactionClientContract,
    companyId: string,
    page?: { sessionId: number; historyId?: string; ifRevision?: number }
  ): Promise<PlanningRead> {
    const { planningAccess } = await this.#access.resolvePlanningAccess(trx, companyId)
    const revision = await this.#planningRevisions.getPlanningRevision(trx, companyId)
    const unchanged = page?.ifRevision === revision
    const data = unchanged
      ? null
      : await this.#stateRepository.readStateWithClient(trx, companyId, true)
    // An unchanged read needs only the company's time zone for its date.
    const company = data
      ? data.companies.find((row) => row.id === companyId)
      : await Company.query({ client: trx }).where('id', companyId).select('timezone').first()
    const base: PlanningReadBase = {
      companyId,
      revision,
      access: planningAccess,
      today: readCompanyToday(company?.timezone ?? null, capacitylens.fixedToday, Date.now()),
      history:
        page?.historyId === undefined || !planningAccess.canWrite
          ? NO_HISTORY
          : await this.#history.readHistoryState(
              trx,
              {
                companyId,
                sessionId: page.sessionId,
                actorId: planningAccess.actorId,
                historyId: page.historyId,
              },
              revision
            ),
    }
    return data
      ? {
          ...base,
          content: 'full',
          data: transformState(buildActiveData(data), companyId, planningAccess.role),
        }
      : { ...base, content: 'unchanged' }
  }

  /** Read only recoverable identities under the current transactional write permission. */
  async readArchiveRecovery(trx: TransactionClientContract, companyId: string) {
    const { planningAccess } = await this.#access.resolvePlanningAccess(trx, companyId)
    if (!planningAccess.canWrite) {
      throw new PlanningAuthorizationException()
    }
    const data = await this.#stateRepository.readStateWithClient(trx, companyId, true)
    return archiveRecovery(data, companyId, planningAccess.role)
  }

  /** Commits one deliberate operation, its revision, audit entry and identity as one atomic unit. */
  mutatePlanning({ trx, actor, companyId, input }: PlanningMutationOptions) {
    return this.#commit({
      trx,
      actor,
      companyId,
      meta: input,
      step: 'new',
      supplied: input.intent,
    })
  }

  /** Commits the caller's latest undoable or redoable change as one ordinary mutation. */
  stepPlanningHistory({ trx, actor, companyId, input, step }: PlanningHistoryStepOptions) {
    return this.#commit({ trx, actor, companyId, meta: input, step, supplied: null })
  }

  /**
   * Ends the caller's history after the server refused one of its steps. A stored change that can no
   * longer be applied would otherwise stay on top and block every change beneath it.
   */
  async abandonPlanningHistory({
    trx,
    actor,
    companyId,
    historyId,
  }: Pick<PlanningHistoryStepOptions, 'trx' | 'actor' | 'companyId'> & { historyId: string }) {
    const { planningAccess } = await this.#access.resolvePlanningAccess(trx, companyId)
    const owner = {
      companyId,
      sessionId: actor.sessionId,
      actorId: planningAccess.actorId,
      historyId,
    }
    const revision = await this.#planningRevisions.getPlanningRevision(trx, companyId)
    if (await this.#history.readHistory(trx, owner, revision)) {
      await this.#history.discardHistory(trx, companyId)
    }
  }

  async #commit({
    trx,
    actor,
    companyId,
    meta: input,
    step,
    supplied,
  }: CommitOptions): Promise<PlanningMutationSuccess> {
    const { planningAccess, accessGrant } = await this.#access.resolvePlanningAccess(trx, companyId)
    if (!planningAccess.canWrite) {
      throw new PlanningAuthorizationException()
    }
    if (await this.#restoration.isMutationCommitted(trx, companyId, input.mutationId)) {
      throw new MutationIdReusedException()
    }
    this.#planningRevisions.assertPlanningBaseRevision(
      input.baseRevision,
      await this.#planningRevisions.getPlanningRevision(trx, companyId),
      input.mutationId
    )
    const owner: HistoryOwner | null =
      input.historyId === undefined
        ? null
        : {
            companyId,
            sessionId: actor.sessionId,
            actorId: planningAccess.actorId,
            historyId: input.historyId,
          }
    const current = owner ? await this.#history.readHistory(trx, owner, input.baseRevision) : null
    const entry = step === 'undo' ? current?.past.at(-1) : current?.future.at(-1)
    const requested = supplied ?? (step === 'undo' ? entry?.inverse : entry?.forward)
    if (!requested) {
      throw new EmptyHistoryException(
        step === 'undo' ? 'There is nothing to undo.' : 'There is nothing to redo.'
      )
    }
    const before = await this.#stateRepository.readStateWithClient(trx, companyId, true)
    const working = structuredClone(before)
    const execution = await this.#execution.executePlanningIntent({
      trx,
      companyId,
      intent: requested,
      accessGrant,
      data: working,
      identity: {
        actorId: planningAccess.actorId,
        sessionId: actor.sessionId,
        mutationId: input.mutationId,
      },
      expectedUpdatedAt: input.expectedUpdatedAt,
    })
    const { restoration, written, intent } = execution
    // archiveImpact measures the active projection itself. Passing the full state keeps an active row
    // whose parent is already archived measurable: it hides nothing more, so every count is zero.
    const archived =
      intent.operation === 'catalogue.archive'
        ? archiveImpact(before, intent.entity.entity, intent.entity.id)
        : undefined
    if (changesNothing(written)) {
      throw new NoChangeException('The operation does not change planning data.')
    }
    // Private names and activity kind can change what a saved before-image may safely reveal.
    // A restoration group is valid only until one of those fields actually changes.
    const endsRecovery = isRestorationInvalidated(intent, written)
    if (endsRecovery) {
      const count = await this.#restoration.countRestorableItems(trx, companyId)
      if (
        input.confirmedRestorationCount !== undefined &&
        input.confirmedRestorationCount !== count
      ) {
        throw new RestorationConfirmationStaleException(count)
      }
      if (count > 0 && input.confirmedRestorationCount === undefined) {
        throw new RestorationConfirmationRequiredException(count)
      }
      await this.#restoration.discardRestorationGroups(trx, companyId)
    }
    const revision = await this.#planningRevisions.advancePlanningRevision(trx, companyId)
    await this.#restoration.recordCommittedMutation(trx, {
      companyId,
      mutationId: input.mutationId,
      actorId: planningAccess.actorId,
      revision,
      restorationGroupId: restoration.replacementGroupId,
      originSessionId: restoration.replacementGroupId ? actor.sessionId : null,
    })
    // The receipt carries the rows this commit changed, as the writer's own read shows them.
    const changed = buildProjectionChanges(
      transformState(buildActiveData(before), companyId, planningAccess.role),
      transformState(buildActiveData(working), companyId, planningAccess.role)
    )
    await this.#audit.writeAudit(trx, {
      companyId,
      actorId: planningAccess.actorId,
      action: intent.operation,
      entity: 'planning',
      entityId: input.mutationId,
      fields: listAuditedEntities(written, before, working),
    })
    // A restore cannot be reversed from the rows alone; the entry it came from holds its counterpart.
    const reverse =
      intent.operation === 'planning.restoreGroup'
        ? ((step === 'undo' ? entry?.forward : step === 'redo' ? entry?.inverse : null) ?? null)
        : buildInverseIntent(intent, before, companyId, restoration)
    // Earlier values must not outlive a privacy change, and a change that cannot be reversed ends
    // the history rather than leaving a gap in it.
    let history = NO_HISTORY
    if (!owner || endsRecovery || !reverse) {
      await this.#history.discardHistory(trx, companyId)
    } else {
      history = await this.#history.writeHistory(
        trx,
        owner,
        revision,
        buildNextEntries(step, current, { intent, reverse })
      )
    }
    return {
      status: 'committed',
      mutationId: input.mutationId,
      revision,
      restoration,
      changes: changed,
      history,
      ...(archived ? { archived } : {}),
      ...buildSaveAdvisory(intent, buildActiveData(working), companyId),
    }
  }
}

/** Moves the committed change onto the stack its step fills, and off the one it came from. */
function buildNextEntries(
  step: 'new' | 'undo' | 'redo',
  current: HistoryEntries | null,
  committed: { intent: PlanningIntent; reverse: PlanningIntent }
): HistoryEntries {
  const past = current?.past ?? []
  const future = current?.future ?? []
  const done: HistoryEntry = { forward: committed.intent, inverse: committed.reverse }
  if (step === 'new') return { past: [...past, done], future: [] }
  if (step === 'redo') return { past: [...past, done], future: future.slice(0, -1) }
  return {
    past: past.slice(0, -1),
    future: [...future, { forward: committed.reverse, inverse: committed.intent }],
  }
}
