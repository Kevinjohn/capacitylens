import { describe, expect, it } from 'vitest';
import type { PlanningControllerMetadata } from './planningCacheTypes';
import { isPlanningHistoryReady, isPlanningReadyForChange } from './planningReadiness';
import { makePlanningAuthority } from '@/test/planning/planningAuthorityFixtures';

const ready: PlanningControllerMetadata = {
  context: { identity: 'bruce-login', companyId: 'wayne' },
  authority: makePlanningAuthority(),
  revision: 4,
  today: '2026-06-03',
  capacity: null,
  status: 'ready',
  history: { canUndo: true, canRedo: false },
  pending: null,
  outcome: null,
  error: null,
};

describe('planning readiness', () => {
  it('admits a new change only for a writable, loaded context with no unresolved write', () => {
    expect(isPlanningReadyForChange(ready)).toBe(true);
    expect(isPlanningReadyForChange({ ...ready, status: 'refused' })).toBe(true);
    expect(isPlanningReadyForChange({ ...ready, context: null })).toBe(false);
    expect(
      isPlanningReadyForChange({ ...ready, authority: makePlanningAuthority({ canWrite: false }) }),
    ).toBe(false);
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
          kind: 'new',
        },
      }),
    ).toBe(false);
  });

  it('admits undo and redo only in the direction the server reported, when a change could start', () => {
    expect(isPlanningHistoryReady(ready, 'undo')).toBe(true);
    expect(isPlanningHistoryReady(ready, 'redo')).toBe(false);
    expect(
      isPlanningHistoryReady({ ...ready, history: { canUndo: false, canRedo: true } }, 'redo'),
    ).toBe(true);
    expect(
      isPlanningHistoryReady(
        { ...ready, authority: makePlanningAuthority({ canWrite: false }) },
        'undo',
      ),
    ).toBe(false);
    expect(isPlanningHistoryReady({ ...ready, status: 'loading' }, 'undo')).toBe(false);
  });
});
