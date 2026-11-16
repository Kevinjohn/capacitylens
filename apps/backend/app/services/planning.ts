import { activeOnly, archiveRecovery } from '@capacitylens/shared/domain/lifecycle';
import type { HttpContext } from '@adonisjs/core/http';
import type { AppData } from '@capacitylens/shared/types/entities';
import { readStateWithClient } from '#services/state_repository';
import { transformState } from '#transformers/state_transformer';
import { withActor } from '#services/auth/current_actor';
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
  requiresRefetch,
  semanticState,
} from '#services/planning/mutation_changes';
import { writeAudit } from '#services/audit';
import {
  committedMutationRevision,
  countRestorableItems,
  discardRestorationGroups,
  isMutationCommitted,
  recordCommittedMutation,
  RestorationConfirmationError,
  unconsumedGroupId,
} from '#services/planning/restoration';
import { mutationLookupValidator } from '#validators/planning/lookup';
import type {
  PlanningMutationInput,
  PlanningMutationSuccess,
  PlanningMutationLookup,
} from '#validators/planning/contracts';

export type { PlanningAuthority };

export interface PlanningSnapshot {
  accountId: string;
  revision: number;
  authority: PlanningAuthority;
  data: AppData;
}

/** Resolves current product authority, revision and rows from the same database snapshot. */
export function readPlanning(ctx: HttpContext, accountId: string): Promise<PlanningSnapshot> {
  return withActor(ctx, async (_actor, trx) => {
    const { authority } = await resolvePlanningAuthority(ctx, trx, accountId);
    const revision = await getPlanningRevision(trx, accountId);
    const data = await readStateWithClient(trx, accountId, true);
    return {
      accountId,
      revision,
      authority,
      data: transformState(activeOnly(data), accountId, authority.role),
    };
  });
}

/** Read only recoverable identities under current transactional write authority. */
export function readArchiveRecovery(ctx: HttpContext, accountId: string) {
  return withActor(ctx, async (_actor, trx) => {
    const { authority } = await resolvePlanningAuthority(ctx, trx, accountId);
    if (!authority.canWrite) {
      throw new PlanningOperationError(403, 'AUTHORIZATION_DENIED', 'This action is not allowed.');
    }
    const data = await readStateWithClient(trx, accountId, true);
    return archiveRecovery(data, accountId, authority.role);
  });
}

/** Commits one deliberate operation, its revision, audit entry and identity as one atomic unit. */
export function mutatePlanning(
  ctx: HttpContext,
  accountId: string,
  input: PlanningMutationInput
): Promise<PlanningMutationSuccess> {
  return withActor(ctx, async (actor, trx) => {
    const { authority, capabilities } = await resolvePlanningAuthority(ctx, trx, accountId);
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
    const restoration = await executePlanningIntent(
      trx,
      accountId,
      input.intent,
      capabilities,
      structuredClone(before),
      { actorId: authority.actorId, sessionId: actor.sessionId, mutationId: input.mutationId }
    );
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
      projection: requiresRefetch(input.intent)
        ? { mode: 'refetch', history: 'clear' }
        : { mode: 'patch', history: 'retain', changed },
    };
  });
}

/** An absent marker remains unknown; lookup never returns a stored response or hidden before-image. */
export function lookupPlanningMutation(
  ctx: HttpContext,
  accountId: string,
  mutationId: string
): Promise<PlanningMutationLookup> {
  return withActor(ctx, async (actor, trx) => {
    const { authority } = await resolvePlanningAuthority(ctx, trx, accountId);
    const revision = await committedMutationRevision(trx, accountId, authority.actorId, mutationId);
    if (revision === undefined) return { status: 'unknown', mutationId };
    const restorationGroupId = await unconsumedGroupId(trx, accountId, {
      actorId: authority.actorId,
      sessionId: actor.sessionId,
      mutationId,
    });
    return {
      status: 'committed',
      mutationId,
      revision,
      ...(restorationGroupId ? { restorationGroupId } : {}),
    };
  });
}

/** Validate a URL mutation identity without adding a query parameter to the generated GET type. */
export async function validatePlanningMutationId(mutationId: unknown) {
  const input = await mutationLookupValidator.validate({ mutationId });
  return input.mutationId;
}
