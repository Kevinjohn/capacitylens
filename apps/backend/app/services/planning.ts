import { activeOnly, archiveImpact, archiveRecovery } from '@capacitylens/shared/domain/lifecycle';
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
import { executePlanningIntent, PlanningOperationError } from '#services/planning/execute';
import { resolvePlanningAuthority, type PlanningAuthority } from '#services/planning/authority';
import {
  changesNothing,
  invalidatesRestoration,
  listAuditedEntities,
} from '#services/planning/mutation_changes';
import { writeAudit } from '#services/audit';
import { buildSaveAdvisory } from '#services/planning/save_advisory';
import {
  countRestorableItems,
  discardRestorationGroups,
  isMutationCommitted,
  recordCommittedMutation,
  RestorationConfirmationError,
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

export type { PlanningAuthority };

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
  authority: PlanningAuthority;
  /** The company's current calendar date in its own time zone. */
  today: ISODate;
  capacity: CapacitySection;
  /** Whether the reading page can undo or redo; both false when it named no history. */
  history: PlanningHistoryState;
}

/** A planning read: the complete projected slice, or none when the reader named the current
 * revision as the one it already holds. */
export type PlanningRead =
  | (PlanningReadBase & { slice: 'full'; data: AppData })
  | (PlanningReadBase & { slice: 'unchanged' });

/** Resolves current product authority, revision, rows and their capacity from the same database
 * snapshot. Capacity covers `window`, or the scheduler's default window when it is absent. The rows
 * are left out only when `page.ifRevision` is exactly the current revision. */
export async function readPlanning(
  trx: TransactionClientContract,
  companyId: string,
  window?: CapacityRange,
  page?: { sessionId: number; historyId?: string; ifRevision?: number }
): Promise<PlanningRead> {
  const { authority } = await resolvePlanningAuthority(trx, companyId);
  const revision = await getPlanningRevision(trx, companyId);
  const data = await readStateWithClient(trx, companyId, true);
  const company = data.accounts.find((row) => row.id === companyId);
  const today = readCompanyToday(company?.timezone ?? null);
  const visible = transformState(activeOnly(data), companyId, authority.role);
  const base: PlanningReadBase = {
    companyId,
    revision,
    authority,
    today,
    // Computed from the rows the reader receives, so it reveals nothing they cannot already see.
    capacity: buildCapacitySection({ data: visible, company, today, window }),
    history:
      page?.historyId === undefined || !authority.canWrite
        ? NO_HISTORY
        : await readHistoryState(
            trx,
            {
              companyId,
              sessionId: page.sessionId,
              actorId: authority.actorId,
              historyId: page.historyId,
            },
            revision
          ),
  };
  return page?.ifRevision === revision
    ? { ...base, slice: 'unchanged' }
    : { ...base, slice: 'full', data: visible };
}

/** Read only recoverable identities under current transactional write authority. */
export async function readArchiveRecovery(trx: TransactionClientContract, companyId: string) {
  const { authority } = await resolvePlanningAuthority(trx, companyId);
  if (!authority.canWrite) {
    throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'This action is not allowed.');
  }
  const data = await readStateWithClient(trx, companyId, true);
  return archiveRecovery(data, companyId, authority.role);
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

/** The caller's history holds no step in that direction; nothing was attempted or refused. */
export class EmptyHistoryError extends PlanningOperationError {
  constructor(message: string) {
    super(409, null, message);
  }
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
  const { authority } = await resolvePlanningAuthority(trx, companyId);
  const owner = { companyId, sessionId: actor.sessionId, actorId: authority.actorId, historyId };
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
  const { authority, capabilities } = await resolvePlanningAuthority(trx, companyId);
  if (!authority.canWrite) {
    throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'This action is not allowed.');
  }
  if (await isMutationCommitted(trx, companyId, input.mutationId)) {
    throw new PlanningOperationError(
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
          actorId: authority.actorId,
          historyId: input.historyId,
        };
  const current = owner ? await readHistory(trx, owner, input.baseRevision) : null;
  const entry = step === 'undo' ? current?.past.at(-1) : current?.future.at(-1);
  const intent = supplied ?? (step === 'undo' ? entry?.inverse : entry?.forward);
  if (!intent) {
    throw new EmptyHistoryError(
      step === 'undo' ? 'There is nothing to undo.' : 'There is nothing to redo.'
    );
  }
  const before = await readStateWithClient(trx, companyId, true);
  const working = structuredClone(before);
  const { restoration, written } = await executePlanningIntent({
    trx,
    companyId,
    intent,
    capabilities,
    data: working,
    identity: {
      actorId: authority.actorId,
      sessionId: actor.sessionId,
      mutationId: input.mutationId,
    },
    expectedUpdatedAt: input.expectedUpdatedAt,
  });
  // archiveImpact measures the active projection itself. Passing the full state keeps an active row
  // whose parent is already archived measurable: it hides nothing more, so every count is zero.
  const archived =
    intent.operation === 'catalogue.archive'
      ? archiveImpact(before, intent.entity.entity, intent.entity.id)
      : undefined;
  if (changesNothing(written)) {
    throw new PlanningOperationError(
      400,
      'NO_CHANGE',
      'The operation does not change planning data.'
    );
  }
  // Private names and activity kind can change what a saved before-image may safely reveal.
  // A restoration group is valid only until one of those fields actually changes.
  const endsRecovery = invalidatesRestoration(intent, written);
  if (endsRecovery) {
    const count = await countRestorableItems(trx, companyId);
    if (
      input.confirmedRestorationCount !== undefined &&
      input.confirmedRestorationCount !== count
    ) {
      throw new RestorationConfirmationError(count, true);
    }
    if (count > 0 && input.confirmedRestorationCount === undefined) {
      throw new RestorationConfirmationError(count, false);
    }
    await discardRestorationGroups(trx, companyId);
  }
  const revision = await advancePlanningRevision(trx, companyId);
  await recordCommittedMutation(trx, {
    companyId,
    mutationId: input.mutationId,
    actorId: authority.actorId,
    revision,
    restorationGroupId: restoration.replacementGroupId,
    originSessionId: restoration.replacementGroupId ? actor.sessionId : null,
  });
  await writeAudit(trx, {
    companyId,
    actorId: authority.actorId,
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
    ...buildSaveAdvisory(intent, activeOnly(working), companyId),
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
