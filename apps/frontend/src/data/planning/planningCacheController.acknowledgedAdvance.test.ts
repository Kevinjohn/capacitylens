import { describe, expect, it } from 'vitest';
import { createPlanningCacheState, isSoleAcknowledgedAdvance } from './planningCacheController';
import type { PlanningControllerMetadata } from './planningCacheController';

const context = { identity: 'actor-1', companyId: 'company-1' };
const basis = { context, revision: 4 };

function planningAt(overrides: Partial<PlanningControllerMetadata>): PlanningControllerMetadata {
  return {
    ...createPlanningCacheState().planning,
    context,
    revision: 5,
    status: 'ready',
    outcome: { kind: 'acknowledged', mutationId: 'mutation-1', revision: 5 },
    ...overrides,
  };
}

describe('isSoleAcknowledgedAdvance', () => {
  it('accepts the basis advanced by exactly its acknowledged change', () => {
    expect(isSoleAcknowledgedAdvance(basis, planningAt({}))).toBe(true);
  });

  it('refuses when another commit landed or the read moved past the acknowledgement', () => {
    expect(
      isSoleAcknowledgedAdvance(
        basis,
        planningAt({
          revision: 6,
          outcome: { kind: 'acknowledged', mutationId: 'mutation-1', revision: 6 },
        }),
      ),
    ).toBe(false);
    expect(
      isSoleAcknowledgedAdvance(
        basis,
        planningAt({ outcome: { kind: 'acknowledged', mutationId: 'mutation-1', revision: 4 } }),
      ),
    ).toBe(false);
  });

  it('refuses without an acknowledgement, a known basis or the same context', () => {
    expect(isSoleAcknowledgedAdvance(basis, planningAt({ outcome: null }))).toBe(false);
    expect(isSoleAcknowledgedAdvance({ context, revision: null }, planningAt({}))).toBe(false);
    expect(isSoleAcknowledgedAdvance(basis, planningAt({ context: { ...context } }))).toBe(false);
  });
});
