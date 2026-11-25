import { inject } from '@adonisjs/core';
import { PlanningService } from '#services/planning_service';
import type { PlanningHistoryStepInput } from '#validators/planning/contracts';
import { CurrentActorService, type RequestAuth } from '#services/auth/current_actor_service';
import {
  MutationIdReusedException,
  PlanningOperationException,
  RecordChangedException,
} from '#exceptions/planning_operation_exception';
import { EmptyHistoryException } from '#exceptions/empty_history_exception';
import { ValidationRefusalException } from '#exceptions/validation_refusal_exception';

/** Undo and redo requests, each in its own transaction. */
@inject()
export class PlanningHistoryStepService {
  #currentActor: CurrentActorService;
  #planning: PlanningService;

  constructor(currentActor: CurrentActorService, planning: PlanningService) {
    this.#currentActor = currentActor;
    this.#planning = planning;
  }

  /** Undoes or redoes one planning history step; a refused step abandons its history. */
  async runPlanningHistoryStep(
    auth: RequestAuth,
    {
      companyId,
      step,
      input,
    }: { companyId: string; step: 'undo' | 'redo'; input: PlanningHistoryStepInput }
  ) {
    try {
      return await this.#currentActor.withActor(auth, (actor, trx) =>
        this.#planning.stepPlanningHistory({ trx, actor, companyId, input, step })
      );
    } catch (error) {
      // The refused step rolled back with its transaction, so ending its history needs its own.
      if (
        error instanceof ValidationRefusalException ||
        (error instanceof PlanningOperationException &&
          !(error instanceof EmptyHistoryException) &&
          !(error instanceof RecordChangedException) &&
          !(error instanceof MutationIdReusedException))
      ) {
        await this.#currentActor.withActor(auth, (actor, trx) =>
          this.#planning.abandonPlanningHistory({
            trx,
            actor,
            companyId,
            historyId: input.historyId,
          })
        );
      }
      throw error;
    }
  }
}
