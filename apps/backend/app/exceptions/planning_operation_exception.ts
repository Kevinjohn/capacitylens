import { Exception } from '@adonisjs/core/exceptions';
import type { PlanningMutationErrorCode } from '#validators/planning/contracts';

/**
 * `ACCOUNT_MEMBERSHIP_LOST` is behaviour, not wording: it tells the browser to drop its planning
 * projection, so one sentence and one code answer every lost company membership. The central
 * mapper knows no route; the code is raised here, where the membership is found to be gone.
 */
export function membershipUnavailable() {
  return new PlanningOperationException(
    403,
    'ACCOUNT_MEMBERSHIP_LOST',
    'Company membership is unavailable.'
  );
}

/** A safe refusal whose caller must roll back the enclosing planning transaction. */
export class PlanningOperationException extends Exception {
  declare readonly code?: PlanningMutationErrorCode;

  constructor(status: number, code: PlanningMutationErrorCode | null, message: string) {
    super(message, { status, code: code ?? undefined });
  }
}
