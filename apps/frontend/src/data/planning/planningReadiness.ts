import { canWritePlanning } from './planningAccess';
import type { PlanningCacheMetadata } from './planningCacheTypes';

/** The one readiness rule: a writable, loaded context at a known revision with no unresolved write. */
export function isPlanningReadyForChange(planning: PlanningCacheMetadata): boolean {
  return (
    planning.context !== null &&
    canWritePlanning(planning.access) &&
    planning.revision !== null &&
    planning.phase.kind === 'ready'
  );
}

/** Undo or Redo is available when a change could be made and the server's last read reported a
 * step in that direction for this page's history. */
export function isPlanningHistoryReady(
  planning: PlanningCacheMetadata,
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
  basis: Pick<PlanningCacheMetadata, 'context' | 'revision'>,
  planning: PlanningCacheMetadata,
): boolean {
  return (
    basis.revision !== null &&
    planning.context === basis.context &&
    planning.revision === basis.revision + 1 &&
    'lastWrite' in planning.phase &&
    planning.phase.lastWrite?.kind === 'acknowledged' &&
    planning.phase.lastWrite.revision === planning.revision
  );
}
