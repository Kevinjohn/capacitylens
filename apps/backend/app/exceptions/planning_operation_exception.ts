import { Exception } from '@adonisjs/core/exceptions';
import type { PlanningMutationErrorCode } from '#validators/planning/contracts';

/** A safe refusal whose caller must roll back the enclosing planning transaction. */
export class PlanningOperationException extends Exception {
  declare readonly code?: PlanningMutationErrorCode;

  constructor(status: number, code: PlanningMutationErrorCode | null, message: string) {
    super(message, { status, code: code ?? undefined });
  }
}
