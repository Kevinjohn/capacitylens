import { describe, expect, it } from 'vitest';
import { buildAuthorityKey, canWritePlanning } from './planningAuthority';
import { makePlanningAuthority } from '@/test/planning/planningAuthorityFixtures';

describe('planning authority', () => {
  it('builds equal keys for equal records and null for no record', () => {
    expect(buildAuthorityKey(makePlanningAuthority())).toBe(
      buildAuthorityKey(makePlanningAuthority()),
    );
    expect(buildAuthorityKey(null)).toBeNull();
  });

  it.each([
    { actorId: 'bruce' },
    { effectiveActorId: 'diana' },
    { role: 'editor' as const },
    { canWrite: false },
    { canSeePrivateNames: false },
    { canSeeTimeOffNote: false },
  ])('builds a different key when one field differs: %j', (change) => {
    expect(buildAuthorityKey(makePlanningAuthority(change))).not.toBe(
      buildAuthorityKey(makePlanningAuthority()),
    );
  });

  it('allows a write only for an authority that can write', () => {
    expect(canWritePlanning(null)).toBe(false);
    expect(canWritePlanning(makePlanningAuthority({ canWrite: false }))).toBe(false);
    expect(canWritePlanning(makePlanningAuthority())).toBe(true);
  });
});
