import { describe, expect, it, vi } from 'vitest';
import { NULLABLE_FIELDS } from '../../types/nullableFields.js';
import { emptyAppData } from '../../types/entities.js';
import type {
  Activity,
  Allocation,
  AppData,
  ID,
  Resource,
  TimeOff,
  Weekday,
} from '../../types/entities.js';
import type { AppDataKey } from '../../types/entityKeys.js';
import { DomainError } from '../errors.js';
import type { DomainErrorCode } from '../errors.js';
import type { ValidationDataLookup } from '../validationLookup.js';
import {
  assertActivityProjectAllowsDependents,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
} from './dependents.js';

// Server batch validation supplies an indexed lookup instead of scanning `data`. Each test gives
// the lookup a view that disagrees with `data`, so only a forwarded lookup produces the outcome.

const TS = '2026-01-01T00:00:00.000Z';
const A1 = 'a-studio';

const meta = (id: ID) => ({ id, accountId: A1, createdAt: TS, updatedAt: TS });
const person = (id: ID, overrides: Partial<Resource> = {}): Resource => ({
  ...NULLABLE_FIELDS.resources,
  ...meta(id),
  kind: 'person',
  name: 'Bruce Wayne',
  role: 'Designer',
  employmentType: 'permanent',
  engagement: 'studio',
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: '#3b82f6',
  ...overrides,
});
const activity = (id: ID, overrides: Partial<Activity> = {}): Activity => ({
  ...NULLABLE_FIELDS.activities,
  ...meta(id),
  name: `Activity ${id}`,
  kind: 'project',
  projectId: 'p1',
  ...overrides,
});
const allocation = (resourceId: ID, activityId: ID): Allocation => ({
  ...NULLABLE_FIELDS.allocations,
  ...meta(`al-${resourceId}`),
  resourceId,
  activityId,
  startDate: '2026-01-05',
  endDate: '2026-01-09',
  hoursPerDay: 8,
  status: 'confirmed',
});
const timeOff = (resourceId: ID): TimeOff => ({
  ...NULLABLE_FIELDS.timeOff,
  ...meta(`to-${resourceId}`),
  resourceId,
  startDate: '2026-01-05',
  endDate: '2026-01-06',
  type: 'holiday',
});

const placeholder = person('ph-p1', { kind: 'placeholder', name: 'Batgirl', projectId: 'p1' });

function data(overrides: Partial<AppData> = {}): AppData {
  return {
    ...emptyAppData(),
    resources: [person('r1'), placeholder],
    activities: [activity('t1')],
    ...overrides,
  };
}

function lookupOver(view: AppData) {
  const owned = (row: { accountId: ID }, accountId: ID) => row.accountId === accountId;
  return {
    row: vi.fn((table: AppDataKey, id: ID) =>
      (view[table] as unknown as (Record<string, unknown> & { id: ID })[]).find(
        (row) => row.id === id,
      ),
    ),
    allocationsForResource: vi.fn((accountId: ID, resourceId: ID) =>
      view.allocations.filter((a) => owned(a, accountId) && a.resourceId === resourceId),
    ),
    allocationsForActivity: vi.fn((accountId: ID, activityId: ID) =>
      view.allocations.filter((a) => owned(a, accountId) && a.activityId === activityId),
    ),
    resourceHasLoadedAllocation: vi.fn((accountId: ID, resourceId: ID) =>
      view.allocations.some(
        (a) => owned(a, accountId) && a.resourceId === resourceId && a.hoursPerDay !== 0,
      ),
    ),
    resourceHasTimeOff: vi.fn((accountId: ID, resourceId: ID) =>
      view.timeOff.some((t) => owned(t, accountId) && t.resourceId === resourceId),
    ),
    accountWorkingDays: vi.fn((): Weekday[] => [1, 2, 3, 4, 5]),
  } satisfies ValidationDataLookup;
}

function codeOf(run: () => void): DomainErrorCode | undefined {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return (error as DomainError).code;
  }
  return undefined;
}

describe('assertResourceKindAllowsDependents with a lookup', () => {
  it('asks the lookup for loaded allocations instead of scanning data', () => {
    const lookup = lookupOver(data({ allocations: [allocation('r1', 't1')] }));
    expect(
      codeOf(() => assertResourceKindAllowsDependents(data(), A1, 'r1', 'external', lookup)),
    ).toBe('resource_external_dependents');
    expect(lookup.resourceHasLoadedAllocation).toHaveBeenCalledWith(A1, 'r1');
  });

  it('asks the lookup for time off instead of scanning data', () => {
    const lookup = lookupOver(data({ timeOff: [timeOff('r1')] }));
    expect(
      codeOf(() => assertResourceKindAllowsDependents(data(), A1, 'r1', 'external', lookup)),
    ).toBe('resource_external_dependents');
    expect(lookup.resourceHasTimeOff).toHaveBeenCalledWith(A1, 'r1');
  });

  it('trusts the lookup over dependents present only in data', () => {
    const stored = data({ allocations: [allocation('r1', 't1')], timeOff: [timeOff('r1')] });
    expect(codeOf(() => assertResourceKindAllowsDependents(stored, A1, 'r1', 'external'))).toBe(
      'resource_external_dependents',
    );
    const lookup = lookupOver(data());
    expect(
      codeOf(() => assertResourceKindAllowsDependents(stored, A1, 'r1', 'external', lookup)),
    ).toBeUndefined();
  });
});

describe('assertResourceProjectAllowsDependents with a lookup', () => {
  const rebound = { ...placeholder, projectId: 'p2' };

  it('reads the placeholder’s allocations and their activities through the lookup', () => {
    const lookup = lookupOver(data({ allocations: [allocation('ph-p1', 't1')] }));
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents(data(), A1, 'ph-p1', rebound, placeholder, lookup),
      ),
    ).toBe('placeholder_project_dependents');
    expect(lookup.allocationsForResource).toHaveBeenCalledWith(A1, 'ph-p1');
    expect(lookup.row).toHaveBeenCalledWith('activities', 't1');
  });

  it('forwards the lookup when no stored resource is supplied', () => {
    const lookup = lookupOver(data({ allocations: [allocation('ph-p1', 't1')] }));
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents(data(), A1, 'ph-p1', rebound, undefined, lookup),
      ),
    ).toBe('placeholder_project_dependents');
  });

  it('trusts the lookup over allocations present only in data', () => {
    const stored = data({ allocations: [allocation('ph-p1', 't1')] });
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents(stored, A1, 'ph-p1', rebound, placeholder),
      ),
    ).toBe('placeholder_project_dependents');
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents(
          stored,
          A1,
          'ph-p1',
          rebound,
          placeholder,
          lookupOver(data()),
        ),
      ),
    ).toBeUndefined();
  });
});

describe('assertActivityProjectAllowsDependents with a lookup', () => {
  const stored = activity('t1');
  const moved = { ...stored, projectId: 'p2' };

  it('reads the activity’s allocations and their resources through the lookup', () => {
    const lookup = lookupOver(data({ allocations: [allocation('ph-p1', 't1')] }));
    expect(
      codeOf(() => assertActivityProjectAllowsDependents(data(), A1, 't1', moved, stored, lookup)),
    ).toBe('activity_project_dependents');
    expect(lookup.allocationsForActivity).toHaveBeenCalledWith(A1, 't1');
    expect(lookup.row).toHaveBeenCalledWith('resources', 'ph-p1');
  });

  it('forwards the lookup when no stored activity is supplied', () => {
    const lookup = lookupOver(data({ allocations: [allocation('ph-p1', 't1')] }));
    expect(
      codeOf(() =>
        assertActivityProjectAllowsDependents(data(), A1, 't1', moved, undefined, lookup),
      ),
    ).toBe('activity_project_dependents');
  });

  it('trusts the lookup over allocations present only in data', () => {
    const withWork = data({ allocations: [allocation('ph-p1', 't1')] });
    expect(
      codeOf(() => assertActivityProjectAllowsDependents(withWork, A1, 't1', moved, stored)),
    ).toBe('activity_project_dependents');
    expect(
      codeOf(() =>
        assertActivityProjectAllowsDependents(
          withWork,
          A1,
          't1',
          moved,
          stored,
          lookupOver(data()),
        ),
      ),
    ).toBeUndefined();
  });
});

describe('assertResourceExists with a lookup', () => {
  const archived = () => data({ resources: [person('r1', { archivedAt: TS })] });

  it('rejects a resource the lookup reports as inactive even when data has it active', () => {
    const lookup = lookupOver(archived());
    expect(codeOf(() => assertResourceExists(data(), A1, 'r1', undefined, lookup))).toBe(
      'time_off_resource_inactive',
    );
    expect(lookup.row).toHaveBeenCalledWith('resources', 'r1');
  });

  it('accepts a resource the lookup reports as active even when data has it archived', () => {
    expect(codeOf(() => assertResourceExists(archived(), A1, 'r1'))).toBe(
      'time_off_resource_inactive',
    );
    expect(
      codeOf(() => assertResourceExists(archived(), A1, 'r1', undefined, lookupOver(data()))),
    ).toBeUndefined();
  });

  it('resolves a resource present only in the lookup', () => {
    const lookup = lookupOver(data({ resources: [person('r-new')] }));
    expect(codeOf(() => assertResourceExists(data(), A1, 'r-new', undefined, lookup))).toBe(
      undefined,
    );
    expect(codeOf(() => assertResourceExists(data(), A1, 'r-new'))).toBe(
      'time_off_resource_invalid',
    );
  });
});
