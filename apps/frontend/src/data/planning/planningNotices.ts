import { errorDetails } from './planningErrors';
import type { PlanningControllerMetadata } from './planningCacheTypes';

/** True when the planning state already shows the outcome: the follow-up canonical read resolves a
 * stale revision, and a 403 refusal stays visible as refused. Callers add no notice for either. */
export function isShownByPlanningState(error: unknown): boolean {
  const { code, status } = errorDetails(error);
  return code === 'STALE_REVISION' || status === 409 || status === 403;
}

/** The planning notice to show: a 403 refusal keeps the rows (K2), and a failed read leaves them stale. */
export function readPlanningProblem(
  planning: PlanningControllerMetadata,
): 'refused' | 'unavailable' | null {
  if (planning.error === null) return null;
  if (errorDetails(planning.error).status === 403) return 'refused';
  return planning.status === 'error' ? 'unavailable' : null;
}
