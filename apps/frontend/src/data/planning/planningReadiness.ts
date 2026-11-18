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

/** Undo or Redo is available when a change could be made and the server's last read reported a
 * step in that direction for this page's history. */
export function isPlanningHistoryReady(
  planning: PlanningControllerMetadata,
  step: 'undo' | 'redo',
): boolean {
  return (
    isPlanningReadyForChange(planning) &&
    (step === 'undo' ? planning.history.canUndo : planning.history.canRedo)
  );
}

/**
 * Returns whether `planning` is `basis` advanced by exactly one acknowledged change in the same
 * context. Every committed change advances the company revision by one, so nothing else was
 * committed in between and rows read at `basis` are current apart from that change.
 */
export function isSoleAcknowledgedAdvance(
  basis: Pick<PlanningControllerMetadata, 'context' | 'revision'>,
  planning: PlanningControllerMetadata,
): boolean {
  return (
    basis.revision !== null &&
    planning.context === basis.context &&
    planning.revision === basis.revision + 1 &&
    planning.outcome?.kind === 'acknowledged' &&
    planning.outcome.revision === planning.revision
  );
}
