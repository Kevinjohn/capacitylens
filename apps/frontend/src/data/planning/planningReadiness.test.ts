import { describe, expect, it } from 'vitest';
import type { PlanningCacheMetadata } from './planningCacheTypes';
import { isPlanningHistoryReady, isPlanningReadyForChange } from './planningReadiness';
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures';

const ready: PlanningCacheMetadata = {
  context: { identity: 'bruce-login', companyId: 'wayne' },
  authority: makePlanningAccess(),
  revision: 4,
  today: '2026-06-03',
  capacity: null,
  phase: { kind: 'ready', lastWrite: null },
  history: { canUndo: true, canRedo: false },
};

describe('planning readiness', () => {
  it('admits a new change only for a writable, loaded context with no unresolved write', () => {
    expect(isPlanningReadyForChange(ready)).toBe(true);
    expect(
      isPlanningReadyForChange({
        ...ready,
        phase: {
          kind: 'ready',
          lastWrite: { kind: 'refused', mutationId: 'm0', error: new Error('Refused') },
        },
      }),
    ).toBe(true);
    expect(isPlanningReadyForChange({ ...ready, context: null })).toBe(false);
    expect(
      isPlanningReadyForChange({ ...ready, authority: makePlanningAccess({ canWrite: false }) }),
    ).toBe(false);
    expect(isPlanningReadyForChange({ ...ready, revision: null })).toBe(false);
    expect(
      isPlanningReadyForChange({ ...ready, phase: { kind: 'loading', lastWrite: null } }),
    ).toBe(false);
    expect(
      isPlanningReadyForChange({
        ...ready,
        phase: {
          kind: 'writing',
          write: {
            execution: {
              mutationId: 'm1',
              baseRevision: 4,
              intent: { operation: 'allocation.delete', id: 'a1' },
            },
            kind: 'new',
          },
          readError: null,
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
        { ...ready, authority: makePlanningAccess({ canWrite: false }) },
        'undo',
      ),
    ).toBe(false);
    expect(
      isPlanningHistoryReady({ ...ready, phase: { kind: 'loading', lastWrite: null } }, 'undo'),
    ).toBe(false);
  });
});
