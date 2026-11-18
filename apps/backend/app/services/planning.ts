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
  companyId: string;
  input: PlanningMutationInput;
}

export interface PlanningSnapshot {
  companyId: string;
  revision: number;
  authority: PlanningAuthority;
  data: AppData;
  /** The company's current calendar date in its own time zone. */
  today: ISODate;
  capacity: CapacitySection;
}

/** Resolves current product authority, revision, rows and their capacity from the same database
 * snapshot. Capacity covers `window`, or the scheduler's default window when it is absent. */
export async function readPlanning(
  trx: TransactionClientContract,
  companyId: string,
  window?: CapacityRange
): Promise<PlanningSnapshot> {
  const { authority } = await resolvePlanningAuthority(trx, companyId);
  const revision = await getPlanningRevision(trx, companyId);
  const data = await readStateWithClient(trx, companyId, true);
  const account = data.accounts.find((row) => row.id === companyId);
  const today = readCompanyToday(account?.timezone ?? null);
  const visible = transformState(activeOnly(data), companyId, authority.role);
  return {
    companyId,
    revision,
    authority,
    data: visible,
    today,
    // Computed from the rows the reader receives, so it reveals nothing they cannot already see.
    capacity: buildCapacitySection({ data: visible, account, today, window }),
  };
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
export async function mutatePlanning({
  trx,
  actor,
  companyId,
  input,
}: PlanningMutationOptions): Promise<PlanningMutationSuccess> {
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
  const before = await readStateWithClient(trx, companyId, true);
  const restoration = await executePlanningIntent({
    trx,
    companyId,
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
  const after = await readStateWithClient(trx, companyId, true);
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
  const changed = projectionChanges(
    transformState(activeOnly(before), companyId, authority.role),
    transformState(activeOnly(after), companyId, authority.role)
  );
  await writeAudit(trx, {
    companyId,
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
    ...buildSaveAdvisory(input.intent, activeOnly(after), companyId),
  };
}
