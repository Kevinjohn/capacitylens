import { describe, expect, it } from 'vitest';
import { makeResource, DEFAULT_ACCOUNT_ID, WORKDAYS } from '@/test/fixtures';
import type { Resource } from '@capacitylens/shared/types/entities';
import { hasEffectiveDaysFor } from './gestureWorkingWeeks';

const calendar = (resources: Resource[]) => ({ resources, accountWorkingDays: WORKDAYS });

describe('hasEffectiveDaysFor', () => {
  it('allows a resource with effective working days', () => {
    const resources = [
      makeResource({ id: 'person', companyId: DEFAULT_ACCOUNT_ID, workingDays: WORKDAYS }),
    ];

    expect(
      hasEffectiveDaysFor({
        calendar: calendar(resources),
        resourceId: 'person',
        ignoreWorkingDays: undefined,
      }),
    ).toBe(true);
  });

  it('rejects a resource whose effective working week is collapsed', () => {
    const resources = [
      makeResource({ id: 'person', companyId: DEFAULT_ACCOUNT_ID, workingDays: [] }),
    ];

    expect(
      hasEffectiveDaysFor({
        calendar: calendar(resources),
        resourceId: 'person',
        ignoreWorkingDays: false,
      }),
    ).toBe(false);
  });

  it('allows a collapsed resource when the allocation ignores working days', () => {
    const resources = [
      makeResource({ id: 'person', companyId: DEFAULT_ACCOUNT_ID, workingDays: [] }),
    ];

    expect(
      hasEffectiveDaysFor({
        calendar: calendar(resources),
        resourceId: 'person',
        ignoreWorkingDays: true,
      }),
    ).toBe(true);
  });

  it('allows a missing resource so the caller can apply its own deletion guard', () => {
    expect(
      hasEffectiveDaysFor({
        calendar: calendar([]),
        resourceId: 'deleted',
        ignoreWorkingDays: false,
      }),
    ).toBe(true);
  });
});
