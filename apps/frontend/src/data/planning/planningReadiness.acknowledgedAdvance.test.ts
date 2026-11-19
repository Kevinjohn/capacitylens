import { describe, expect, it } from 'vitest';
import { createPlanningCacheState } from './planningCacheController';
import { isSoleAcknowledgedAdvance } from './planningReadiness';
import type { PlanningControllerMetadata } from './planningCacheTypes';

const context = { identity: 'actor-1', companyId: 'company-1' };
const basis = { context, revision: 4 };

function acknowledgedAt(revision: number): PlanningControllerMetadata['phase'] {
  return { kind: 'ready', lastWrite: { kind: 'acknowledged', mutationId: 'mutation-1', revision } };
}

function planningAt(overrides: Partial<PlanningControllerMetadata>): PlanningControllerMetadata {
  return {
    ...createPlanningCacheState().planning,
    context,
    revision: 5,
    phase: acknowledgedAt(5),
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
          phase: acknowledgedAt(6),
        }),
      ),
    ).toBe(false);
    expect(isSoleAcknowledgedAdvance(basis, planningAt({ phase: acknowledgedAt(4) }))).toBe(false);
  });

  it('refuses without an acknowledgement, a known basis or the same context', () => {
    expect(
      isSoleAcknowledgedAdvance(basis, planningAt({ phase: { kind: 'ready', lastWrite: null } })),
    ).toBe(false);
    expect(isSoleAcknowledgedAdvance({ context, revision: null }, planningAt({}))).toBe(false);
    expect(isSoleAcknowledgedAdvance(basis, planningAt({ context: { ...context } }))).toBe(false);
  });
});
