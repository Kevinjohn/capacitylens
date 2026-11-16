import type { PlanningMutationErrorCode } from '#validators/planning/contracts';

/** A refused entity write with a safe message; each caller maps `status` to its response. */
export class EntityWriteError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly current?: Record<string, unknown>,
    readonly code?: string
  ) {
    super(message);
  }
}

/** A safe refusal whose caller must roll back the enclosing planning transaction. */
export class PlanningOperationError extends Error {
  constructor(
    readonly status: number,
    readonly code: PlanningMutationErrorCode | null,
    message: string
  ) {
    super(message);
  }
}
