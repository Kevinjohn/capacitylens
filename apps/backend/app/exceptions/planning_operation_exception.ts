import type { PlanningMutationErrorCode } from '#validators/planning/contracts';

/** A safe refusal whose caller must roll back the enclosing planning transaction. */
export class PlanningOperationException extends Error {
  constructor(
    readonly status: number,
    readonly code: PlanningMutationErrorCode | null,
    message: string
  ) {
    super(message);
  }
}
