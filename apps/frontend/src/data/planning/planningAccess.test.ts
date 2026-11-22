import { describe, expect, it } from 'vitest';
import { buildAccessKey, canWritePlanning } from './planningAccess';
import { makePlanningAccess } from '@/test/planning/planningAccessFixtures';

describe('planning access', () => {
  it('builds equal keys for equal records and null for no record', () => {
    expect(buildAccessKey(makePlanningAccess())).toBe(buildAccessKey(makePlanningAccess()));
    expect(buildAccessKey(null)).toBeNull();
  });

  it.each([
    { actorId: 'bruce' },
    { effectiveActorId: 'diana' },
    { role: 'editor' as const },
    { canWrite: false },
    { canSeePrivateNames: false },
    { canSeeTimeOffNote: false },
  ])('builds a different key when one field differs: %j', (change) => {
    expect(buildAccessKey(makePlanningAccess(change))).not.toBe(
      buildAccessKey(makePlanningAccess()),
    );
  });

  it('allows a write only for an access that can write', () => {
    expect(canWritePlanning(null)).toBe(false);
    expect(canWritePlanning(makePlanningAccess({ canWrite: false }))).toBe(false);
    expect(canWritePlanning(makePlanningAccess())).toBe(true);
  });
});
