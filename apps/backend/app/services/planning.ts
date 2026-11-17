import { activeOnly, archiveImpact, archiveRecovery } from '@capacitylens/shared/domain/lifecycle';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import type { AppData, ISODate } from '@capacitylens/shared/types/entities';
import { readCompanyToday } from '#services/company_today';
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
  invalidatesRestoration,
  projectionChanges,
  semanticState,
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
import type {
  PlanningMutationInput,
  PlanningMutationSuccess,
} from '#validators/planning/contracts';

export type { PlanningAuthority };

/** One planning mutation in the caller's transaction, by its verified actor. */
export interface PlanningMutationOptions {
  trx: TransactionClientContract;
  actor: CurrentActor;
  accountId: string;
  input: PlanningMutationInput;
}

export interface PlanningSnapshot {
  accountId: string;
  revision: number;
  authority: PlanningAuthority;
  data: AppData;
  /** The company's current calendar date in its own time zone. */
  today: ISODate;
}

/** Resolves current product authority, revision and rows from the same database snapshot. */
export async function readPlanning(
  trx: TransactionClientContract,
  accountId: string
): Promise<PlanningSnapshot> {
  const { authority } = await resolvePlanningAuthority(trx, accountId);
  const revision = await getPlanningRevision(trx, accountId);
  const data = await readStateWithClient(trx, accountId, true);
  return {
    accountId,
    revision,
    authority,
    data: transformState(activeOnly(data), accountId, authority.role),
    today: readCompanyToday(data.accounts.find((row) => row.id === accountId)?.timezone ?? null),
  };
}

/** Read only recoverable identities under current transactional write authority. */
export async function readArchiveRecovery(trx: TransactionClientContract, accountId: string) {
  const { authority } = await resolvePlanningAuthority(trx, accountId);
  if (!authority.canWrite) {
    throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'This action is not allowed.');
  }
  const data = await readStateWithClient(trx, accountId, true);
  return archiveRecovery(data, accountId, authority.role);
}

/** Commits one deliberate operation, its revision, audit entry and identity as one atomic unit. */
export async function mutatePlanning({
  trx,
  actor,
  accountId,
  input,
}: PlanningMutationOptions): Promise<PlanningMutationSuccess> {
  const { authority, capabilities } = await resolvePlanningAuthority(trx, accountId);
  if (!authority.canWrite) {
    throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'This action is not allowed.');
  }
  if (await isMutationCommitted(trx, accountId, input.mutationId)) {
    throw new PlanningOperationError(
      409,
      'MUTATION_ID_REUSED',
      'This mutation identity has already committed.'
    );
  }
  assertPlanningBaseRevision(
    input.baseRevision,
    await getPlanningRevision(trx, accountId),
    input.mutationId
  );
  const before = await readStateWithClient(trx, accountId, true);
  const restoration = await executePlanningIntent({
    trx,
    accountId,
    intent: input.intent,
    capabilities,
    data: structuredClone(before),
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
    input.intent.operation === 'catalogue.archive'
      ? archiveImpact(before, input.intent.entity.entity, input.intent.entity.id)
      : undefined;
  const after = await readStateWithClient(trx, accountId, true);
  if (semanticState(before) === semanticState(after)) {
    throw new PlanningOperationError(
      400,
      'NO_CHANGE',
      'The operation does not change planning data.'
    );
  }
  // Private names and activity kind can change what a saved before-image may safely reveal.
  // A restoration group is valid only until one of those fields actually changes.
  if (invalidatesRestoration(input.intent, before, after)) {
    const count = await countRestorableItems(trx, accountId);
    if (
      input.confirmedRestorationCount !== undefined &&
      input.confirmedRestorationCount !== count
    ) {
      throw new RestorationConfirmationError(count, true);
    }
    if (count > 0 && input.confirmedRestorationCount === undefined) {
      throw new RestorationConfirmationError(count, false);
    }
    await discardRestorationGroups(trx, accountId);
  }
  const revision = await advancePlanningRevision(trx, accountId);
  await recordCommittedMutation(trx, {
    accountId,
    mutationId: input.mutationId,
    actorId: authority.actorId,
    revision,
    restorationGroupId: restoration.replacementGroupId,
    originSessionId: restoration.replacementGroupId ? actor.sessionId : null,
  });
  const changed = projectionChanges(
    transformState(activeOnly(before), accountId, authority.role),
    transformState(activeOnly(after), accountId, authority.role)
  );
  await writeAudit(trx, {
    accountId,
    actorId: authority.actorId,
    action: input.intent.operation,
    entity: 'planning',
    entityId: input.mutationId,
    fields: [
      ...new Set([
        ...changed.upserts.map((row) => row.entity),
        ...changed.removed.map((row) => row.entity),
      ]),
    ],
  });
  return {
    status: 'committed',
    mutationId: input.mutationId,
    revision,
    restoration,
    ...(archived ? { archived } : {}),
    ...buildSaveAdvisory(input.intent, activeOnly(after), accountId),
  };
}
