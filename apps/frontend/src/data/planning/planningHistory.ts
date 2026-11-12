import type { PlanningHistoryEntry, PlanningIntent } from '@/api/planningContracts';
import type { PlanningHistory } from './planningCacheController';

// Page-local undo and redo history: moving entries after a commit and deciding eligibility.

export const HISTORY_LIMIT = 50;

export const emptyHistory = (): PlanningHistory => ({ past: [], future: [], tipRevision: null });

export function cloneImmutable<T>(value: T): T {
  const cloned = structuredClone(value);
  const freeze = (item: unknown): void => {
    if (item === null || typeof item !== 'object' || Object.isFrozen(item)) return;
    Object.freeze(item);
    for (const child of Object.values(item)) freeze(child);
  };
  freeze(cloned);
  return cloned;
}

function replaceRestoreHandle(intent: PlanningIntent, handle: string | undefined): PlanningIntent {
  if (intent.operation !== 'planning.restoreGroup' || !handle) return intent;
  return { ...intent, restorationGroupId: handle };
}

function restoreIntent(handle: string): PlanningIntent {
  return { operation: 'planning.restoreGroup', restorationGroupId: handle };
}

export function isDeleteIntent(intent: PlanningIntent): boolean {
  return intent.operation.endsWith('.delete') || intent.operation.endsWith('deleteGroup');
}

export function isLookupHistoryEligible(
  intent: PlanningIntent,
  inverse: PlanningIntent | null,
): boolean {
  if (!inverse) return false;
  return !(
    intent.operation === 'catalogue.update' &&
    ('isPrivate' in intent.entity.changes ||
      'codeName' in intent.entity.changes ||
      (intent.entity.entity === 'activities' && 'kind' in intent.entity.changes))
  );
}

export function movedHistory(
  history: PlanningHistory,
  kind: 'new' | 'undo' | 'redo',
  entry: PlanningHistoryEntry | null,
  action: PlanningIntent,
  nextInverse: PlanningIntent | null,
  replacementHandle: string | undefined,
  revision: number,
): PlanningHistory {
  if (kind === 'new') {
    if (!entry || !nextInverse) return emptyHistory();
    const inverse = replaceRestoreHandle(nextInverse, replacementHandle);
    if (inverse.operation === 'planning.restoreGroup' && inverse.restorationGroupId === '') {
      return emptyHistory();
    }
    return {
      past: [...history.past, { forward: cloneImmutable(entry.forward), inverse }].slice(
        -HISTORY_LIMIT,
      ),
      future: [],
      tipRevision: revision,
    };
  }
  if (!entry) return emptyHistory();
  if (kind === 'undo') {
    const remaining = history.past.slice(0, -1);
    let redo: PlanningHistoryEntry;
    if (action.operation === 'planning.restoreGroup') {
      redo = cloneImmutable(entry);
    } else if (replacementHandle) {
      redo = { forward: restoreIntent(replacementHandle), inverse: cloneImmutable(action) };
    } else if (
      entry.forward.operation === 'resource.create' &&
      action.operation === 'resource.archive'
    ) {
      redo = {
        forward: { operation: 'resource.unarchive', id: action.id },
        inverse: cloneImmutable(action),
      };
    } else if (
      entry.forward.operation === 'catalogue.create' &&
      action.operation === 'catalogue.archive'
    ) {
      redo = {
        forward: { operation: 'catalogue.unarchive', entity: action.entity },
        inverse: cloneImmutable(action),
      };
    } else if (isDeleteIntent(action) || entry.forward.operation === 'planning.restoreGroup') {
      return emptyHistory();
    } else {
      redo = { forward: cloneImmutable(entry.forward), inverse: cloneImmutable(action) };
    }
    return {
      past: remaining,
      future: [...history.future, redo].slice(-HISTORY_LIMIT),
      tipRevision: revision,
    };
  }
  const remaining = history.future.slice(0, -1);
  let past: PlanningHistoryEntry;
  if (action.operation === 'planning.restoreGroup') {
    past = { forward: cloneImmutable(action), inverse: cloneImmutable(entry.inverse) };
  } else {
    const inverse = replaceRestoreHandle(entry.inverse, replacementHandle);
    if (inverse.operation === 'planning.restoreGroup' && inverse.restorationGroupId === '') {
      return emptyHistory();
    }
    past = { forward: cloneImmutable(action), inverse };
  }
  return {
    past: [...history.past, past].slice(-HISTORY_LIMIT),
    future: remaining,
    tipRevision: revision,
  };
}
