import type { PlanningControllerMetadata } from './planningCacheTypes';

/** The one readiness rule: a writable, loaded context at a known revision with no unresolved write. */
export function isPlanningReadyForChange(planning: PlanningControllerMetadata): boolean {
  return (
    planning.context !== null &&
    planning.canWrite &&
    planning.revision !== null &&
    planning.pending === null &&
    (planning.status === 'ready' || planning.status === 'refused')
  );
}

/** History controls use only the current acknowledged revision, with no unresolved write. */
export function isPlanningHistoryReady(planning: PlanningControllerMetadata): boolean {
  return isPlanningReadyForChange(planning) && planning.history.tipRevision === planning.revision;
}
