import app from '@adonisjs/core/services/app';
import { abandonPlanningHistory, stepPlanningHistory } from '#services/planning';
import type { PlanningHistoryStepInput } from '#validators/planning/contracts';
import { CurrentActorService, type RequestAuth } from '#services/auth/current_actor_service';
import { PlanningOperationException } from '#exceptions/planning_operation_exception';
import { EmptyHistoryException } from '#exceptions/empty_history_exception';
import { ValidationRefusalException } from '#exceptions/validation_refusal_exception';

/** Undoes or redoes one planning history step; a refused step abandons its history. */
export async function runPlanningHistoryStep(
  auth: RequestAuth,
  {
    companyId,
    step,
    input,
  }: { companyId: string; step: 'undo' | 'redo'; input: PlanningHistoryStepInput }
) {
  const currentActor = await app.container.make(CurrentActorService);
  try {
    return await currentActor.withActor(auth, (actor, trx) =>
      stepPlanningHistory({ trx, actor, companyId, input, step })
    );
  } catch (error) {
    // The refused step rolled back with its transaction, so ending its history needs its own.
    if (
      error instanceof ValidationRefusalException ||
      (error instanceof PlanningOperationException &&
        !(error instanceof EmptyHistoryException) &&
        error.code !== 'STALE_REVISION' &&
        error.code !== 'MUTATION_ID_REUSED')
    ) {
      await currentActor.withActor(auth, (actor, trx) =>
        abandonPlanningHistory({ trx, actor, companyId, historyId: input.historyId })
      );
    }
    throw error;
  }
}
