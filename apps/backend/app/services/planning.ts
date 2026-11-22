import {
  buildActiveData,
  archiveImpact,
  archiveRecovery,
} from '@capacitylens/shared/domain/lifecycle';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { AppData, ISODate } from '@capacitylens/shared/types/entities';
import { readCompanyToday } from '#services/company_today';
import type { CapacityRange, CapacitySection } from '@capacitylens/shared/lib/capacity';
import { buildCapacitySection } from '#services/planning/capacity_section';
import { readStateWithClient } from '#services/state_repository';
import { transformState } from '#transformers/state_transformer';
import type { CurrentActor } from '#services/auth/current_actor';
import {
  getPlanningRevision,
  advancePlanningRevision,
  assertPlanningBaseRevision,
} from '#services/planning_revision';
import { executePlanningIntent } from '#services/planning/execute';
import { resolvePlanningAccess, type PlanningAccess } from '#services/planning/access';
import {
  changesNothing,
  isRestorationInvalidated,
  listAuditedEntities,
  buildProjectionChanges,
} from '#services/planning/mutation_changes';
import { writeAudit } from '#services/audit';
import { buildSaveAdvisory } from '#services/planning/save_advisory';
import {
  countRestorableItems,
  discardRestorationGroups,
  isMutationCommitted,
  recordCommittedMutation,
} from '#services/planning/restoration';
import {
  discardHistory,
  NO_HISTORY,
  readHistory,
  readHistoryState,
  writeHistory,
  type HistoryEntries,
  type HistoryEntry,
  type HistoryOwner,
} from '#services/planning/history';
import { buildInverseIntent } from '#services/planning/inverse';
import type {
  PlanningHistoryState,
  PlanningHistoryStepInput,
  PlanningIntent,
  PlanningMutationInput,
  PlanningMutationSuccess,
} from '#validators/planning/contracts';
import { PlanningOperationException } from '#exceptions/planning_operation_exception';
import { EmptyHistoryException } from '#exceptions/empty_history_exception';
import { RestorationConfirmationException } from '#exceptions/restoration_confirmation_exception';

export type { PlanningAccess };

/** One planning mutation in the caller's transaction, by its verified actor. */
export interface PlanningMutationOptions {
  trx: TransactionClientContract;
  actor: CurrentActor;
  companyId: string;
  input: PlanningMutationInput;
}

/** One step back or forward through the caller's own history, in the caller's transaction. */
export interface PlanningHistoryStepOptions {
  trx: TransactionClientContract;
  actor: CurrentActor;
  companyId: string;
  input: PlanningHistoryStepInput;
  step: 'undo' | 'redo';
}

interface PlanningReadBase {
  companyId: string;
  revision: number;
  authority: PlanningAccess;
  /** The company's current calendar date in its own time zone. */
  today: ISODate;
  capacity: CapacitySection;
  /** Whether the reading page can undo or redo; both false when it named no history. */
  history: PlanningHistoryState;
}

/** A planning read: the complete projected data, or none when the reader named the current
 * revision as the one it already holds. */
export type PlanningRead =
  | (PlanningReadBase & { content: 'full'; data: AppData })
  | (PlanningReadBase & { content: 'unchanged' });

/** Resolves current planning access, revision, rows and their capacity from the same database
 * snapshot. Capacity covers `window`, or the scheduler's default window when it is absent. The rows
 * are left out only when `page.ifRevision` is exactly the current revision. */
export async function readPlanning(
  trx: TransactionClientContract,
  companyId: string,
  window?: CapacityRange,
  page?: { sessionId: number; historyId?: string; ifRevision?: number }
): Promise<PlanningRead> {
  const { planningAccess } = await resolvePlanningAccess(trx, companyId);
  const revision = await getPlanningRevision(trx, companyId);
  const data = await readStateWithClient(trx, companyId, true);
  const company = data.companies.find((row) => row.id === companyId);
  const today = readCompanyToday(company?.timezone ?? null);
  const visible = transformState(buildActiveData(data), companyId, planningAccess.role);
  const base: PlanningReadBase = {
    companyId,
    revision,
    authority: planningAccess,
    today,
    // Computed from the rows the reader receives, so it reveals nothing they cannot already see.
    capacity: buildCapacitySection({ data: visible, company, today, window }),
    history:
      page?.historyId === undefined || !planningAccess.canWrite
        ? NO_HISTORY
        : await readHistoryState(
            trx,
            {
              companyId,
              sessionId: page.sessionId,
              actorId: planningAccess.actorId,
              historyId: page.historyId,
            },
            revision
          ),
  };
  return page?.ifRevision === revision
    ? { ...base, content: 'unchanged' }
    : { ...base, content: 'full', data: visible };
}

/** Read only recoverable identities under the current transactional write permission. */
export async function readArchiveRecovery(trx: TransactionClientContract, companyId: string) {
  const { planningAccess } = await resolvePlanningAccess(trx, companyId);
  if (!planningAccess.canWrite) {
    throw new PlanningOperationException(
      403,
      'AUTHORIZATION_DENIED',
      'This action is not allowed.'
    );
  }
  const data = await readStateWithClient(trx, companyId, true);
  return archiveRecovery(data, companyId, planningAccess.role);
}

/** Commits one deliberate operation, its revision, audit entry and identity as one atomic unit. */
export function mutatePlanning({ trx, actor, companyId, input }: PlanningMutationOptions) {
  return commit({ trx, actor, companyId, meta: input, step: 'new', supplied: input.intent });
}

/** Commits the caller's latest undoable or redoable change as one ordinary mutation. */
export function stepPlanningHistory({
  trx,
  actor,
  companyId,
  input,
  step,
}: PlanningHistoryStepOptions) {
  return commit({ trx, actor, companyId, meta: input, step, supplied: null });
}

/**
 * Ends the caller's history after the server refused one of its steps. A stored change that can no
 * longer be applied would otherwise stay on top and block every change beneath it.
 */
export async function abandonPlanningHistory({
  trx,
  actor,
  companyId,
  historyId,
}: Pick<PlanningHistoryStepOptions, 'trx' | 'actor' | 'companyId'> & { historyId: string }) {
  const { planningAccess } = await resolvePlanningAccess(trx, companyId);
  const owner = {
    companyId,
    sessionId: actor.sessionId,
    actorId: planningAccess.actorId,
    historyId,
  };
  const revision = await getPlanningRevision(trx, companyId);
  if (await readHistory(trx, owner, revision)) await discardHistory(trx, companyId);
}

interface CommitOptions {
  trx: TransactionClientContract;
  actor: CurrentActor;
  companyId: string;
  meta: Pick<
    PlanningMutationInput,
    'mutationId' | 'baseRevision' | 'confirmedRestorationCount' | 'expectedUpdatedAt' | 'historyId'
  >;
  step: 'new' | 'undo' | 'redo';
  /** The intent of a new change; a history step takes its intent from the stored entry. */
  supplied: PlanningIntent | null;
}

async function commit({
  trx,
  actor,
  companyId,
  meta: input,
  step,
  supplied,
}: CommitOptions): Promise<PlanningMutationSuccess> {
  const { planningAccess, accessGrant } = await resolvePlanningAccess(trx, companyId);
  if (!planningAccess.canWrite) {
    throw new PlanningOperationException(
      403,
      'AUTHORIZATION_DENIED',
      'This action is not allowed.'
    );
  }
  if (await isMutationCommitted(trx, companyId, input.mutationId)) {
    throw new PlanningOperationException(
      409,
      'MUTATION_ID_REUSED',
      'This mutation identity has already committed.'
    );
  }
  assertPlanningBaseRevision(
    input.baseRevision,
    await getPlanningRevision(trx, companyId),
    input.mutationId
  );
  const owner: HistoryOwner | null =
    input.historyId === undefined
      ? null
      : {
          companyId,
          sessionId: actor.sessionId,
          actorId: planningAccess.actorId,
          historyId: input.historyId,
        };
  const current = owner ? await readHistory(trx, owner, input.baseRevision) : null;
  const entry = step === 'undo' ? current?.past.at(-1) : current?.future.at(-1);
  const requested = supplied ?? (step === 'undo' ? entry?.inverse : entry?.forward);
  if (!requested) {
    throw new EmptyHistoryException(
      step === 'undo' ? 'There is nothing to undo.' : 'There is nothing to redo.'
    );
  }
  const before = await readStateWithClient(trx, companyId, true);
  const working = structuredClone(before);
  const execution = await executePlanningIntent({
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
  });
  const { restoration, written, intent } = execution;
  // archiveImpact measures the active projection itself. Passing the full state keeps an active row
  // whose parent is already archived measurable: it hides nothing more, so every count is zero.
  const archived =
    intent.operation === 'catalogue.archive'
      ? archiveImpact(before, intent.entity.entity, intent.entity.id)
      : undefined;
  if (changesNothing(written)) {
    throw new PlanningOperationException(
      400,
      'NO_CHANGE',
      'The operation does not change planning data.'
    );
  }
  // Private names and activity kind can change what a saved before-image may safely reveal.
  // A restoration group is valid only until one of those fields actually changes.
  const endsRecovery = isRestorationInvalidated(intent, written);
  if (endsRecovery) {
    const count = await countRestorableItems(trx, companyId);
    if (
      input.confirmedRestorationCount !== undefined &&
      input.confirmedRestorationCount !== count
    ) {
      throw new RestorationConfirmationException(count, true);
    }
    if (count > 0 && input.confirmedRestorationCount === undefined) {
      throw new RestorationConfirmationException(count, false);
    }
    await discardRestorationGroups(trx, companyId);
  }
  const revision = await advancePlanningRevision(trx, companyId);
  await recordCommittedMutation(trx, {
    companyId,
    mutationId: input.mutationId,
    actorId: planningAccess.actorId,
    revision,
    restorationGroupId: restoration.replacementGroupId,
    originSessionId: restoration.replacementGroupId ? actor.sessionId : null,
  });
  // The receipt carries the rows this commit changed, as the writer's own read shows them.
  const changed = buildProjectionChanges(
    transformState(buildActiveData(before), companyId, planningAccess.role),
    transformState(buildActiveData(working), companyId, planningAccess.role)
  );
  await writeAudit(trx, {
    companyId,
    actorId: planningAccess.actorId,
    action: intent.operation,
    entity: 'planning',
    entityId: input.mutationId,
    fields: listAuditedEntities(written, before, working),
  });
  // A restore cannot be reversed from the rows alone; the entry it came from holds its counterpart.
  const reverse =
    intent.operation === 'planning.restoreGroup'
      ? ((step === 'undo' ? entry?.forward : step === 'redo' ? entry?.inverse : null) ?? null)
      : buildInverseIntent(intent, before, companyId, restoration);
  // Earlier values must not outlive a privacy change, and a change that cannot be reversed ends
  // the history rather than leaving a gap in it.
  let history = NO_HISTORY;
  if (!owner || endsRecovery || !reverse) {
    await discardHistory(trx, companyId);
  } else {
    history = await writeHistory(
      trx,
      owner,
      revision,
      buildNextEntries(step, current, { intent, reverse })
    );
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
  };
}

/** Moves the committed change onto the stack its step fills, and off the one it came from. */
function buildNextEntries(
  step: 'new' | 'undo' | 'redo',
  current: HistoryEntries | null,
  committed: { intent: PlanningIntent; reverse: PlanningIntent }
): HistoryEntries {
  const past = current?.past ?? [];
  const future = current?.future ?? [];
  const done: HistoryEntry = { forward: committed.intent, inverse: committed.reverse };
  if (step === 'new') return { past: [...past, done], future: [] };
  if (step === 'redo') return { past: [...past, done], future: future.slice(0, -1) };
  return {
    past: past.slice(0, -1),
    future: [...future, { forward: committed.reverse, inverse: committed.intent }],
  };
}
