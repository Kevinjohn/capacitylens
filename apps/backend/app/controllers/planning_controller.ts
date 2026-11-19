import type { HttpContext } from '@adonisjs/core/http';
import {
  abandonPlanningHistory,
  EmptyHistoryError,
  readPlanning,
  readArchiveRecovery,
  mutatePlanning,
  stepPlanningHistory,
} from '#services/planning';
import { PlanningOperationError } from '#services/planning/execute';
import {
  planningHistoryStepValidator,
  planningMutationValidator,
} from '#validators/planning_operations';
import { planningReadValidator } from '#validators/planning/read';
import type { PlanningHistoryStepInput } from '#validators/planning/contracts';
import { withActor } from '#services/auth/current_actor';

/** Planning reads, one mutation route, and the page's undo and redo. */
export default class PlanningController {
  async show(ctx: HttpContext) {
    const companyId = String(ctx.params.companyId);
    const { from, to, historyId } = await ctx.request.validateUsing(planningReadValidator, {
      data: ctx.request.qs(),
    });
    const window = from !== undefined && to !== undefined ? { from, to } : undefined;
    return withActor(ctx, (actor, trx) =>
      readPlanning(trx, companyId, window, { sessionId: actor.sessionId, historyId })
    );
  }

  async archive(ctx: HttpContext) {
    const companyId = String(ctx.params.companyId);
    return withActor(ctx, (_actor, trx) => readArchiveRecovery(trx, companyId));
  }

  async undo(ctx: HttpContext) {
    return this.step(ctx, 'undo', () => ctx.request.validateUsing(planningHistoryStepValidator));
  }

  async redo(ctx: HttpContext) {
    return this.step(ctx, 'redo', () => ctx.request.validateUsing(planningHistoryStepValidator));
  }

  /** Each action passes its own validateUsing call so the route registry can type the body. */
  private async step(
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
        error instanceof PlanningOperationError &&
        !(error instanceof EmptyHistoryError) &&
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

  /** Runs one planning operation; the validated intent, not the URL, names it. */
  async mutate(ctx: HttpContext) {
    const input = await ctx.request.validateUsing(planningMutationValidator);
    ctx.planningOperation = input.intent.operation;
    const companyId = String(ctx.params.companyId);
    return withActor(ctx, (actor, trx) => mutatePlanning({ trx, actor, companyId, input }));
  }
}
