import { describe, expect, it } from 'vitest';
import type { PlanningControllerMetadata } from './planningCacheTypes';
import { isPlanningHistoryReady, isPlanningReadyForChange } from './planningReadiness';

const ready: PlanningControllerMetadata = {
  context: { identity: 'bruce-login', companyId: 'wayne' },
  accessKey: null,
  canWrite: true,
  revision: 4,
  today: '2026-06-03',
  status: 'ready',
  history: { past: [], future: [], tipRevision: 4 },
  pending: null,
  outcome: null,
  error: null,
};

describe('planning readiness', () => {
  it('admits a new change only for a writable, loaded context with no unresolved write', () => {
    expect(isPlanningReadyForChange(ready)).toBe(true);
    expect(isPlanningReadyForChange({ ...ready, status: 'refused' })).toBe(true);
    expect(isPlanningReadyForChange({ ...ready, context: null })).toBe(false);
    expect(isPlanningReadyForChange({ ...ready, canWrite: false })).toBe(false);
    expect(isPlanningReadyForChange({ ...ready, revision: null })).toBe(false);
    expect(isPlanningReadyForChange({ ...ready, status: 'loading' })).toBe(false);
    expect(
      isPlanningReadyForChange({
        ...ready,
        pending: {
          execution: {
            mutationId: 'm1',
            baseRevision: 4,
            intent: { operation: 'allocation.delete', id: 'a1' },
          },
          inverse: null,
          historyEntry: null,
          kind: 'new',
        },
      }),
    ).toBe(false);
  });

  it('admits undo and redo only at the acknowledged history tip', () => {
    expect(isPlanningHistoryReady(ready)).toBe(true);
    expect(
      isPlanningHistoryReady({ ...ready, history: { ...ready.history, tipRevision: 3 } }),
    ).toBe(false);
    expect(isPlanningHistoryReady({ ...ready, canWrite: false })).toBe(false);
  });
});
