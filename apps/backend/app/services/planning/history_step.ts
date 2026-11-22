import type { HttpContext } from '@adonisjs/core/http';
import { abandonPlanningHistory, stepPlanningHistory } from '#services/planning';
import type { PlanningHistoryStepInput } from '#validators/planning/contracts';
import { withActor } from '#services/auth/current_actor';
import { PlanningOperationException } from '#exceptions/planning_operation_exception';
import { EmptyHistoryException } from '#exceptions/empty_history_exception';

/** Each action passes its own validateUsing call so the route registry can type the body. */
export async function runPlanningHistoryStep(
  ctx: HttpContext,
  step: 'undo' | 'redo',
  validate: () => Promise<PlanningHistoryStepInput>
) {
  const companyId = String(ctx.params.companyId);
  let historyId: string | undefined;
  try {
    const input = await validate();
    historyId = input.historyId;
    return await withActor(ctx, (actor, trx) =>
      stepPlanningHistory({ trx, actor, companyId, input, step })
    );
  } catch (error) {
    // The refused step rolled back with its transaction, so ending its history needs its own.
    if (
      historyId !== undefined &&
      error instanceof PlanningOperationException &&
      !(error instanceof EmptyHistoryException) &&
      error.code !== 'STALE_REVISION' &&
      error.code !== 'MUTATION_ID_REUSED'
    ) {
      const refused = historyId;
      await withActor(ctx, (actor, trx) =>
        abandonPlanningHistory({ trx, actor, companyId, historyId: refused })
      );
    }
    throw error;
  }
}
