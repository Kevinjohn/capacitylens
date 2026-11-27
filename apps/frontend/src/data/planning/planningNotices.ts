import { getErrorDetails } from './planningErrors';
import type { PlanningCacheMetadata, PlanningPhase } from './planningCacheTypes';

/** True when the planning state already shows the outcome: the follow-up canonical read resolves a
 * stale revision, and a 403 refusal stays visible as refused. Callers add no notice for either. */
export function isShownByPlanningState(error: unknown): boolean {
  const { code, status } = getErrorDetails(error);
  return code === 'E_STALE_REVISION' || status === 409 || status === 403;
}

/** The failure the planning state shows: a failed read, a read that failed while a write waits
 * for it, or a refused write until the next read. Null when there is none. */
export function readPlanningError(phase: PlanningPhase): unknown {
  switch (phase.kind) {
    case 'idle':
      return null;
    case 'failed':
      return phase.error;
    case 'writing':
      return phase.readError;
    case 'loading':
    case 'ready':
      return phase.lastWrite?.kind === 'refused' ? phase.lastWrite.error : null;
  }
}

/** The planning notice to show: a 403 refusal keeps the rows (K2), a failed read leaves them stale,
 * and a write whose reply was lost asks the person to check the change. */
export function readPlanningProblem(
  planning: PlanningCacheMetadata,
): 'refused' | 'unavailable' | 'unconfirmed' | null {
  const { phase } = planning;
  const error = readPlanningError(phase);
  if (error === null) {
    return 'lastWrite' in phase && phase.lastWrite?.kind === 'unconfirmed' ? 'unconfirmed' : null;
  }
  if (getErrorDetails(error).status === 403) return 'refused';
  return phase.kind === 'failed' || phase.kind === 'writing' ? 'unavailable' : null;
}
