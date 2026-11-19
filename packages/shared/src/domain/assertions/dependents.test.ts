import { describe, expect, it } from 'vitest';
import { NULLABLE_FIELDS } from '../../types/nullableFields.js';
import { createEmptyAppData } from '../../types/entities.js';
import type {
  Company,
  Activity,
  Allocation,
  AppData,
  Client,
  ID,
  Project,
  Resource,
  TimeOff,
} from '../../types/entities.js';
import { DomainError } from '../errors.js';
import type { DomainErrorCode } from '../errors.js';
import {
  assertActivityProjectAllowsDependents,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
} from './dependents.js';

// dependents.messages.test.ts proves these rules throw; this file pins which code each rule
// carries and the guards that decide whether the dependents check runs at all, which the UI and
// server both branch on.

const TS = '2026-01-01T00:00:00.000Z';
const A1 = 'a-studio';

const meta = (id: ID) => ({ id, companyId: A1, createdAt: TS, updatedAt: TS });
const company: Company = {
  ...NULLABLE_FIELDS.accounts,
  id: A1,
  name: 'Wayne Enterprises',
  color: '#3b82f6',
  createdAt: TS,
  updatedAt: TS,
};
const client: Client = {
  ...NULLABLE_FIELDS.clients,
  ...meta('c1'),
  name: 'Gotham City',
  color: '#3b82f6',
};
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
const placeholder = (id: ID, projectId: ID | null): Resource =>
  person(id, { kind: 'placeholder', name: 'Batgirl', projectId });
const projectActivity = (id: ID, projectId: ID): Activity => ({
  ...NULLABLE_FIELDS.activities,
  ...meta(id),
  name: `Activity ${id}`,
  kind: 'project',
  projectId,
});
const allocation = (id: ID, resourceId: ID, activityId: ID, hoursPerDay = 8): Allocation => ({
  ...NULLABLE_FIELDS.allocations,
  ...meta(id),
  resourceId,
  activityId,
  startDate: '2026-01-05',
  endDate: '2026-01-09',
  hoursPerDay,
  status: 'confirmed',
});
const timeOff = (id: ID, resourceId: ID): TimeOff => ({
  ...NULLABLE_FIELDS.timeOff,
  ...meta(id),
  resourceId,
  startDate: '2026-01-12',
  endDate: '2026-01-13',
  type: 'holiday',
});

function data(overrides: Partial<AppData> = {}): AppData {
  return {
    ...createEmptyAppData(),
    accounts: [company],
    clients: [client],
    projects: [project('p1'), project('p2'), project('p3')],
    activities: [projectActivity('t1', 'p1')],
    ...overrides,
  };
}

/** The domain code a call throws, or undefined when it passes. Any other throw fails the test. */
function codeOf(run: () => void): DomainErrorCode | undefined {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(DomainError);
    return (error as DomainError).code;
  }
  return undefined;
}

describe('assertResourceKindAllowsDependents', () => {
  it('names the external-conversion code for a loaded allocation or any time off', () => {
    const loaded = data({
      resources: [person('r1')],
      allocations: [allocation('al1', 'r1', 't1')],
    });
    expect(
      codeOf(() =>
        assertResourceKindAllowsDependents({
          data: loaded,
          companyId: A1,
          resourceId: 'r1',
          mergedKind: 'external',
        }),
      ),
    ).toBe('resource_external_dependents');
    const away = data({ resources: [person('r1')], timeOff: [timeOff('to1', 'r1')] });
    expect(
      codeOf(() =>
        assertResourceKindAllowsDependents({
          data: away,
          companyId: A1,
          resourceId: 'r1',
          mergedKind: 'external',
        }),
      ),
    ).toBe('resource_external_dependents');
  });

  it('passes for a zero-load allocation and for a non-external target kind', () => {
    const zero = data({
      resources: [person('r1')],
      allocations: [allocation('al1', 'r1', 't1', 0)],
    });
    expect(
      codeOf(() =>
        assertResourceKindAllowsDependents({
          data: zero,
          companyId: A1,
          resourceId: 'r1',
          mergedKind: 'external',
        }),
      ),
    ).toBeUndefined();
    const loaded = data({
      resources: [person('r1')],
      allocations: [allocation('al1', 'r1', 't1')],
    });
    expect(
      codeOf(() =>
        assertResourceKindAllowsDependents({
          data: loaded,
          companyId: A1,
          resourceId: 'r1',
          mergedKind: 'placeholder',
        }),
      ),
    ).toBeUndefined();
  });
});

describe('assertResourceProjectAllowsDependents', () => {
  const bound = data({
    resources: [placeholder('r1', 'p1')],
    allocations: [allocation('al1', 'r1', 't1')],
  });

  it('names the placeholder code when rebinding newly invalidates assigned work', () => {
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents({
          data: bound,
          companyId: A1,
          resourceId: 'r1',
          merged: placeholder('r1', 'p2'),
          existing: placeholder('r1', 'p1'),
        }),
      ),
    ).toBe('placeholder_project_dependents');
  });

  it('treats an omitted existing row as previously valid and still throws the domain code', () => {
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents({
          data: bound,
          companyId: A1,
          resourceId: 'r1',
          merged: placeholder('r1', 'p2'),
        }),
      ),
    ).toBe('placeholder_project_dependents');
  });

  it('skips the check when neither kind nor project changed', () => {
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents({
          data: bound,
          companyId: A1,
          resourceId: 'r1',
          merged: placeholder('r1', 'p1'),
          existing: placeholder('r1', 'p1'),
        }),
      ),
    ).toBeUndefined();
  });

  it('runs the check for a kind change even when the project binding is unchanged', () => {
    const personWithWork = data({
      resources: [person('r1')],
      allocations: [allocation('al1', 'r1', 't1')],
    });
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents({
          data: personWithWork,
          companyId: A1,
          resourceId: 'r1',
          merged: placeholder('r1', null),
          existing: person('r1'),
        }),
      ),
    ).toBe('placeholder_project_dependents');
  });

  it('tolerates work that was already invalid before the edit and accepts a repairing edit', () => {
    const misbound = data({
      resources: [placeholder('r1', 'p2')],
      allocations: [allocation('al1', 'r1', 't1')],
    });
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents({
          data: misbound,
          companyId: A1,
          resourceId: 'r1',
          merged: placeholder('r1', 'p3'),
          existing: placeholder('r1', 'p2'),
        }),
      ),
    ).toBeUndefined();
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents({
          data: misbound,
          companyId: A1,
          resourceId: 'r1',
          merged: placeholder('r1', 'p1'),
          existing: placeholder('r1', 'p2'),
        }),
      ),
    ).toBeUndefined();
  });

  it('skips an allocation whose activity no longer resolves', () => {
    const orphaned = data({
      resources: [placeholder('r1', 'p1')],
      allocations: [allocation('al1', 'r1', 'ghost')],
    });
    expect(
      codeOf(() =>
        assertResourceProjectAllowsDependents({
          data: orphaned,
          companyId: A1,
          resourceId: 'r1',
          merged: placeholder('r1', 'p2'),
          existing: placeholder('r1', 'p1'),
        }),
      ),
    ).toBeUndefined();
  });
});

describe('assertActivityProjectAllowsDependents', () => {
  const bound = data({
    resources: [placeholder('r1', 'p1')],
    allocations: [allocation('al1', 'r1', 't1')],
  });

  it('names the activity code when moving the project newly invalidates placeholder work', () => {
    expect(
      codeOf(() =>
        assertActivityProjectAllowsDependents({
          data: bound,
          companyId: A1,
          activityId: 't1',
          merged: projectActivity('t1', 'p2'),
          existing: projectActivity('t1', 'p1'),
        }),
      ),
    ).toBe('activity_project_dependents');
    expect(
      codeOf(() =>
        assertActivityProjectAllowsDependents({
          data: bound,
          companyId: A1,
          activityId: 't1',
          merged: projectActivity('t1', 'p2'),
        }),
      ),
    ).toBe('activity_project_dependents');
  });

  it('skips an unchanged edit and tolerates work that was already invalid', () => {
    expect(
      codeOf(() =>
        assertActivityProjectAllowsDependents({
          data: bound,
          companyId: A1,
          activityId: 't1',
          merged: projectActivity('t1', 'p1'),
          existing: projectActivity('t1', 'p1'),
        }),
      ),
    ).toBeUndefined();
    const misassigned = data({
      activities: [projectActivity('t1', 'p2')],
      resources: [placeholder('r1', 'p1')],
      allocations: [allocation('al1', 'r1', 't1')],
    });
    expect(
      codeOf(() =>
        assertActivityProjectAllowsDependents({
          data: misassigned,
          companyId: A1,
          activityId: 't1',
          merged: projectActivity('t1', 'p3'),
          existing: projectActivity('t1', 'p2'),
        }),
      ),
    ).toBeUndefined();
  });

  it('skips an unchanged edit even when a legacy attribution would be stripped', () => {
    // Only all-projects work may carry attribution, so the pair check would compare the stored p2
    // attribution with the stripped p1 project and refuse an edit that moves nothing.
    const legacy = data({
      resources: [placeholder('r1', 'p2')],
      allocations: [{ ...allocation('al1', 'r1', 't1'), projectId: 'p2' }],
    });
    expect(
      codeOf(() =>
        assertActivityProjectAllowsDependents({
          data: legacy,
          companyId: A1,
          activityId: 't1',
          merged: projectActivity('t1', 'p1'),
          existing: projectActivity('t1', 'p1'),
        }),
      ),
    ).toBeUndefined();
  });

  it('skips an allocation whose resource no longer resolves', () => {
    const orphaned = data({ allocations: [allocation('al1', 'ghost', 't1')] });
    expect(
      codeOf(() =>
        assertActivityProjectAllowsDependents({
          data: orphaned,
          companyId: A1,
          activityId: 't1',
          merged: projectActivity('t1', 'p2'),
          existing: projectActivity('t1', 'p1'),
        }),
      ),
    ).toBeUndefined();
  });
});

describe('assertResourceExists', () => {
  it('names the invalid, inactive and external time-off codes', () => {
    expect(
      codeOf(() => assertResourceExists({ data: data(), companyId: A1, resourceId: 'r1' })),
    ).toBe('time_off_resource_invalid');
    const archived = data({ resources: [person('r1', { archivedAt: TS })] });
    expect(
      codeOf(() => assertResourceExists({ data: archived, companyId: A1, resourceId: 'r1' })),
    ).toBe('time_off_resource_inactive');
    const externalParty = data({ resources: [person('r1', { kind: 'external' })] });
    expect(
      codeOf(() => assertResourceExists({ data: externalParty, companyId: A1, resourceId: 'r1' })),
    ).toBe('time_off_external_resource');
  });

  it('passes for an active person and for an unchanged archived reference', () => {
    expect(
      codeOf(() =>
        assertResourceExists({
          data: data({ resources: [person('r1')] }),
          companyId: A1,
          resourceId: 'r1',
        }),
      ),
    ).toBeUndefined();
    const archived = data({ resources: [person('r1', { archivedAt: TS })] });
    expect(
      codeOf(() =>
        assertResourceExists({
          data: archived,
          companyId: A1,
          resourceId: 'r1',
          existing: { resourceId: 'r1' },
        }),
      ),
    ).toBeUndefined();
  });
});
