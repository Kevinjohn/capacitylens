import type { PlanningAccess } from '@/data/planning/planningCacheTypes';

/** A planning authority for test reads: by default an Owner, reading as themselves, who can write. */
export function makePlanningAccess(overrides: Partial<PlanningAccess> = {}): PlanningAccess {
  return {
    actorId: 'test-principal',
    effectiveActorId: 'test-principal',
    role: 'owner',
    canWrite: true,
    canSeePrivateNames: true,
    canSeeTimeOffNote: true,
    ...overrides,
  };
}
