import { describe, expect, it, vi } from 'vitest';
import { NULLABLE_FIELDS } from '../../types/nullableFields.js';
import { emptyAppData } from '../../types/entities.js';
import type {
  Activity,
  AppData,
  Client,
  ID,
  Project,
  Resource,
  Weekday,
} from '../../types/entities.js';
import type { AppDataKey } from '../../types/entityKeys.js';
import { DomainError } from '../errors.js';
import type { DomainErrorCode } from '../errors.js';
import type { ValidationDataLookup } from '../validationLookup.js';
import { assertAllocationRefs, assertScopedRefs } from './refs.js';

// Server batch validation supplies an indexed lookup instead of scanning `data`. Each test gives
// the lookup a view that disagrees with `data`, so only a forwarded lookup produces the outcome.

const TS = '2026-01-01T00:00:00.000Z';
const A1 = 'a-studio';

const meta = (id: ID) => ({ id, accountId: A1, createdAt: TS, updatedAt: TS });
const client = (id: ID, overrides: Partial<Client> = {}): Client => ({
  ...NULLABLE_FIELDS.clients,
  ...meta(id),
  name: 'Gotham City',
  color: '#3b82f6',
  ...overrides,
});
const project = (id: ID): Project => ({
  ...NULLABLE_FIELDS.projects,
  ...meta(id),
  name: `Project ${id}`,
  clientId: 'c1',
  color: '#3b82f6',
});
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
const activity = (id: ID): Activity => ({
  ...NULLABLE_FIELDS.activities,
  ...meta(id),
  name: `Activity ${id}`,
  kind: 'project',
  projectId: 'p1',
});

function data(overrides: Partial<AppData> = {}): AppData {
  return {
    ...emptyAppData(),
    clients: [client('c1')],
    projects: [project('p1')],
    activities: [activity('t1')],
    resources: [person('r1')],
    ...overrides,
  };
}

function lookupOver(view: AppData) {
  return {
    row: vi.fn((table: AppDataKey, id: ID) =>
      (view[table] as unknown as (Record<string, unknown> & { id: ID })[]).find(
        (row) => row.id === id,
      ),
    ),
    allocationsForResource: vi.fn(() => []),
    allocationsForActivity: vi.fn(() => []),
    resourceHasLoadedAllocation: vi.fn(() => false),
    resourceHasTimeOff: vi.fn(() => false),
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

describe('assertScopedRefs with a lookup', () => {
  const archivedClient = () => data({ clients: [client('c1', { archivedAt: TS })] });

  it('rejects a reference the lookup reports as inactive even when data has it active', () => {
    const lookup = lookupOver(archivedClient());
    expect(
      codeOf(() => assertScopedRefs(data(), A1, 'projects', { clientId: 'c1' }, undefined, lookup)),
    ).toBe('reference_wrong_account');
    expect(lookup.row).toHaveBeenCalledWith('clients', 'c1');
  });

  it('accepts a reference the lookup reports as active even when data has it archived', () => {
    const write = { clientId: 'c1' };
    expect(codeOf(() => assertScopedRefs(archivedClient(), A1, 'projects', write))).toBe(
      'reference_wrong_account',
    );
    const lookup = lookupOver(data());
    expect(
      codeOf(() => assertScopedRefs(archivedClient(), A1, 'projects', write, undefined, lookup)),
    ).toBeUndefined();
  });
});

describe('assertAllocationRefs with a lookup', () => {
  const archivedResource = () => data({ resources: [person('r1', { archivedAt: TS })] });

  it('rejects a resource the lookup reports as inactive even when data has it active', () => {
    const lookup = lookupOver(archivedResource());
    expect(
      codeOf(() => assertAllocationRefs(data(), A1, 'r1', 't1', 8, undefined, undefined, lookup)),
    ).toBe('allocation_resource_inactive');
    expect(lookup.row).toHaveBeenCalledWith('resources', 'r1');
    expect(lookup.row).toHaveBeenCalledWith('activities', 't1');
  });

  it('accepts a resource the lookup reports as active even when data has it archived', () => {
    expect(codeOf(() => assertAllocationRefs(archivedResource(), A1, 'r1', 't1', 8))).toBe(
      'allocation_resource_inactive',
    );
    const lookup = lookupOver(data());
    expect(
      codeOf(() =>
        assertAllocationRefs(archivedResource(), A1, 'r1', 't1', 8, undefined, undefined, lookup),
      ),
    ).toBeUndefined();
  });
});
