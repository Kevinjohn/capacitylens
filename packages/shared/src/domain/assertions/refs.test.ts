import { describe, expect, it } from 'vitest';
import { NULLABLE_FIELDS } from '../../types/nullableFields.js';
import { emptyAppData } from '../../types/entities.js';
import type {
  Account,
  Activity,
  AppData,
  Client,
  ID,
  Phase,
  Project,
  Resource,
  ScopedEntity,
  ScopedEntityKey,
} from '../../types/entities.js';
import { DomainError } from '../errors.js';
import type { DomainErrorCode } from '../errors.js';
import { assertAllocationRefs, assertScopedRefs } from './refs.js';

// mutations.test.ts proves these rules reject bad writes by message; this file pins the code each
// rule carries and the conditions that decide whether it runs.

const TS = '2026-01-01T00:00:00.000Z';
const A1 = 'a-studio';
const A2 = 'a-loft';

const meta = (id: ID, accountId: ID = A1) => ({ id, accountId, createdAt: TS, updatedAt: TS });
const account = (id: ID, name: string): Account => ({
  ...NULLABLE_FIELDS.accounts,
  id,
  name,
  color: '#3b82f6',
  createdAt: TS,
  updatedAt: TS,
});
const client = (id: ID, overrides: Partial<Client> = {}): Client => ({
  ...NULLABLE_FIELDS.clients,
  ...meta(id),
  name: 'Gotham City',
  color: '#3b82f6',
  ...overrides,
});
const project = (id: ID, overrides: Partial<Project> = {}): Project => ({
  ...NULLABLE_FIELDS.projects,
  ...meta(id),
  name: `Project ${id}`,
  clientId: 'c1',
  color: '#3b82f6',
  ...overrides,
});
const phase = (id: ID, projectId: ID, accountId: ID = A1): Phase => ({
  ...meta(id, accountId),
  name: 'Discovery',
  projectId,
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
const activity = (id: ID, overrides: Partial<Activity> = {}): Activity => ({
  ...NULLABLE_FIELDS.activities,
  ...meta(id),
  name: `Activity ${id}`,
  kind: 'project',
  projectId: 'p1',
  ...overrides,
});

// One company with an active and an archived row of each referenced kind, plus a second company
// whose rows must never be referenced.
function data(): AppData {
  return {
    ...emptyAppData(),
    accounts: [account(A1, 'Wayne Enterprises'), account(A2, 'Stark Industries')],
    clients: [
      client('c1'),
      client('c-archived', { archivedAt: TS }),
      { ...client('c-loft'), accountId: A2, name: 'Avengers Tower' },
    ],
    projects: [
      project('p1'),
      project('p2'),
      project('p-archived', { archivedAt: TS }),
      { ...project('p-loft', { clientId: 'c-loft' }), accountId: A2 },
    ],
    phases: [phase('ph1', 'p1'), phase('ph-loft', 'p-loft', A2)],
    activities: [
      activity('t1'),
      activity('t-repeatable', { kind: 'repeatable', projectId: null }),
      activity('t-archived', { archivedAt: TS }),
      { ...activity('t-loft', { projectId: 'p-loft' }), accountId: A2 },
    ],
    resources: [
      person('r1'),
      person('r-archived', { archivedAt: TS }),
      person('ph-p1', { kind: 'placeholder', name: 'Batgirl', projectId: 'p1' }),
      person('ext1', { kind: 'external', name: 'Kord Industries' }),
      { ...person('r-loft', { name: 'Tony Stark' }), accountId: A2 },
    ],
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

function scoped(
  key: ScopedEntityKey,
  record: Record<string, unknown>,
  existing?: ScopedEntity | Record<string, unknown>,
  options?: { fullRow?: boolean },
) {
  return codeOf(() => assertScopedRefs(data(), A1, key, record, existing, undefined, options));
}

describe('assertScopedRefs required references', () => {
  it('accepts an active in-company reference', () => {
    expect(scoped('projects', { clientId: 'c1' })).toBeUndefined();
  });

  it('rejects a non-string, missing, cross-company or archived reference on create', () => {
    for (const clientId of [42, 'c-missing', 'c-loft', 'c-archived']) {
      expect(scoped('projects', { clientId })).toBe('reference_wrong_account');
    }
  });

  it('requires the parent on create, on a full row and when an update clears it', () => {
    expect(scoped('projects', {})).toBe('reference_wrong_account');
    expect(scoped('phases', {}, phase('ph1', 'p1'), { fullRow: true })).toBe(
      'reference_wrong_account',
    );
    expect(scoped('phases', { projectId: null }, phase('ph1', 'p1'))).toBe(
      'reference_wrong_account',
    );
  });

  it('lets a partial update omit the parent', () => {
    expect(scoped('phases', { name: 'Delivery' }, phase('ph1', 'p1'))).toBeUndefined();
    expect(
      scoped('phases', { name: 'Delivery' }, phase('ph1', 'p1'), { fullRow: false }),
    ).toBeUndefined();
  });

  it('skips the active check for an unchanged reference but still rejects a foreign one', () => {
    const stale = project('p1', { clientId: 'c-archived' });
    expect(scoped('projects', { clientId: 'c-archived' }, stale)).toBeUndefined();
    const gone = project('p1', { clientId: 'c-missing' });
    expect(scoped('projects', { clientId: 'c-missing' }, gone)).toBeUndefined();
    const foreign = project('p1', { clientId: 'c-loft' });
    expect(scoped('projects', { clientId: 'c-loft' }, foreign)).toBe('reference_wrong_account');
  });

  it('checks a changed reference on update', () => {
    expect(scoped('projects', { clientId: 'c-archived' }, project('p1'))).toBe(
      'reference_wrong_account',
    );
    expect(scoped('projects', { clientId: 'c1' }, project('p1'))).toBeUndefined();
  });
});

describe('assertScopedRefs activities', () => {
  it('requires a project for a project activity', () => {
    expect(scoped('activities', { kind: 'project' })).toBe('activity_project_required');
    expect(scoped('activities', { kind: 'project', projectId: 'p1' })).toBeUndefined();
  });

  it('forbids a project or phase on internal and repeatable activities', () => {
    for (const kind of ['internal', 'repeatable']) {
      expect(scoped('activities', { kind, projectId: 'p1' })).toBe('activity_project_forbidden');
      expect(scoped('activities', { kind, phaseId: 'ph1' })).toBe('activity_phase_forbidden');
      expect(scoped('activities', { kind })).toBeUndefined();
    }
  });

  it('rejects a phase of another company or one that does not exist', () => {
    expect(scoped('activities', { kind: 'project', projectId: 'p-loft', phaseId: 'ph-loft' })).toBe(
      'reference_wrong_account',
    );
    expect(scoped('activities', { projectId: 'p1', phaseId: 'ph-loft' })).toBe(
      'activity_phase_wrong_account',
    );
    expect(scoped('activities', { projectId: 'p1', phaseId: 'ph-missing' })).toBe(
      'activity_phase_wrong_account',
    );
    expect(scoped('activities', { projectId: 'p1', phaseId: 7 })).toBe(
      'activity_phase_wrong_account',
    );
  });

  it('requires the phase’s own project', () => {
    expect(scoped('activities', { phaseId: 'ph1' })).toBe('activity_phase_project_required');
    expect(scoped('activities', { kind: 'project', projectId: 'p2', phaseId: 'ph1' })).toBe(
      'activity_phase_project_mismatch',
    );
    expect(
      scoped('activities', { kind: 'project', projectId: 'p1', phaseId: 'ph1' }),
    ).toBeUndefined();
  });

  it('accepts an unchanged phase that is missing but not one in another company', () => {
    const missing = activity('t1', { phaseId: 'ph-missing' });
    expect(
      scoped('activities', { projectId: 'p1', phaseId: 'ph-missing' }, missing),
    ).toBeUndefined();
    const foreign = activity('t1', { phaseId: 'ph-loft' });
    expect(scoped('activities', { projectId: 'p1', phaseId: 'ph-loft' }, foreign)).toBe(
      'activity_phase_wrong_account',
    );
  });

  it('rechecks an unchanged phase when the project changes', () => {
    const stored = activity('t1', { phaseId: 'ph1' });
    expect(scoped('activities', { projectId: 'p2', phaseId: 'ph1' }, stored)).toBe(
      'activity_phase_project_mismatch',
    );
  });
});

describe('assertScopedRefs resources', () => {
  it('lets only a person carry an avatar URL', () => {
    const url = 'https://images.example/bruce.png';
    expect(scoped('resources', { kind: 'person', avatarUrl: url })).toBeUndefined();
    expect(scoped('resources', { kind: 'placeholder', avatarUrl: url })).toBe(
      'resource_avatar_url_forbidden',
    );
    expect(
      scoped(
        'resources',
        { name: 'Batgirl' },
        person('ph', { kind: 'placeholder', avatarUrl: url }),
      ),
    ).toBe('resource_avatar_url_forbidden');
  });

  it('rejects an avatar URL that is not already normalised HTTPS', () => {
    for (const avatarUrl of ['http://images.example/a.png', 'https://Images.example/a.png']) {
      expect(scoped('resources', { kind: 'person', avatarUrl })).toBe(
        'resource_avatar_url_invalid',
      );
    }
  });

  it('leaves a resource without an avatar URL alone', () => {
    expect(scoped('resources', { name: 'Clark Kent' }, person('r1'))).toBeUndefined();
    expect(scoped('resources', { kind: 'placeholder', avatarUrl: null })).toBeUndefined();
  });

  it('forbids a project on a non-placeholder when kind or project is supplied', () => {
    expect(scoped('resources', { kind: 'person', projectId: 'p1' })).toBe(
      'resource_project_forbidden',
    );
    const bound = person('r1', { projectId: 'p1' });
    expect(scoped('resources', { kind: 'person' }, bound)).toBe('resource_project_forbidden');
    expect(scoped('resources', { projectId: 'p1' }, person('r1'))).toBe(
      'resource_project_forbidden',
    );
    expect(scoped('resources', { name: 'Clark Kent' }, bound)).toBeUndefined();
    expect(scoped('resources', { kind: 'placeholder', projectId: 'p1' })).toBeUndefined();
    // Without a known kind the placeholder rule has nothing to compare.
    expect(scoped('resources', { projectId: 'p1' })).toBeUndefined();
    expect(scoped('resources', { kind: null, projectId: 'p1' })).toBeUndefined();
  });

  it('keeps the resource kind immutable and rejects a corrupt stored kind', () => {
    expect(scoped('resources', { kind: 'placeholder' }, person('r1'))).toBe(
      'resource_kind_immutable',
    );
    expect(scoped('resources', { name: 'Clark Kent' }, { ...person('r1'), kind: 'robot' })).toBe(
      'resource_kind_immutable',
    );
    expect(scoped('resources', { name: 'Clark Kent' }, { ...person('r1'), kind: 7 })).toBe(
      'resource_kind_immutable',
    );
    expect(scoped('resources', { kind: 'person' }, person('r1'))).toBeUndefined();
  });

  it('checks discipline and placeholder project references', () => {
    expect(scoped('resources', { kind: 'person', disciplineId: 'd-missing' })).toBe(
      'reference_wrong_account',
    );
    expect(scoped('resources', { kind: 'placeholder', projectId: 'p-loft' })).toBe(
      'reference_wrong_account',
    );
  });
});

describe('assertScopedRefs tables without catalog references', () => {
  it.each(['clients', 'disciplines', 'allocations', 'timeOff', 'closures'] as const)(
    'ignores reference-looking fields on %s',
    (key) => {
      expect(
        scoped(key, { clientId: 'c-loft', projectId: 'p-loft', kind: 'robot' }),
      ).toBeUndefined();
    },
  );

  it('ignores an unknown table key', () => {
    expect(scoped('unknown' as ScopedEntityKey, { clientId: 'c-loft' })).toBeUndefined();
  });
});

describe('assertAllocationRefs', () => {
  function allocationCode(
    resourceId: ID,
    activityId: ID,
    hoursPerDay = 8,
    projectId?: ID | null,
    existing?: { resourceId: ID; activityId: ID; projectId?: ID | null },
  ) {
    return codeOf(() =>
      assertAllocationRefs(data(), A1, resourceId, activityId, hoursPerDay, projectId, existing),
    );
  }

  it('accepts an active resource and activity', () => {
    expect(allocationCode('r1', 't1')).toBeUndefined();
  });

  it('rejects a missing or foreign resource or activity', () => {
    for (const [resourceId, activityId] of [
      ['r-missing', 't1'],
      ['r-loft', 't1'],
      ['r1', 't-missing'],
      ['r1', 't-loft'],
    ] as const) {
      expect(allocationCode(resourceId, activityId)).toBe('allocation_references_invalid');
    }
  });

  it('rejects a newly chosen archived resource but keeps an unchanged one', () => {
    expect(allocationCode('r-archived', 't1')).toBe('allocation_resource_inactive');
    expect(
      allocationCode('r-archived', 't1', 8, undefined, {
        resourceId: 'r-archived',
        activityId: 't1',
      }),
    ).toBeUndefined();
  });

  it('rejects a newly chosen archived activity but keeps an unchanged one', () => {
    const existing = { resourceId: 'r1', activityId: 't-archived' };
    expect(allocationCode('r1', 't-archived')).toBe('allocation_activity_inactive');
    expect(allocationCode('r1', 't-archived', 8, undefined, existing)).toBeUndefined();
  });

  it('allows attribution only on a repeatable activity', () => {
    expect(allocationCode('r1', 't1', 8, 'p1')).toBe('allocation_project_forbidden');
    expect(allocationCode('r1', 't-repeatable', 8, 'p1')).toBeUndefined();
    expect(allocationCode('r1', 't-repeatable', 8, null)).toBeUndefined();
  });

  it('rejects attribution to a missing, foreign or newly chosen archived project', () => {
    for (const projectId of ['p-missing', 'p-loft', 'p-archived']) {
      expect(allocationCode('r1', 't-repeatable', 8, projectId)).toBe(
        'allocation_project_inactive',
      );
    }
    const existing = { resourceId: 'r1', activityId: 't-repeatable', projectId: 'p-archived' };
    expect(allocationCode('r1', 't-repeatable', 8, 'p-archived', existing)).toBeUndefined();
  });

  it('applies the placeholder project rule through the assignment check', () => {
    expect(allocationCode('ph-p1', 't1')).toBeUndefined();
    expect(allocationCode('ph-p1', 't-repeatable', 8, 'p2')).toBe('placeholder_project_mismatch');
  });

  it('lets an external resource carry only zero hours', () => {
    expect(allocationCode('ext1', 't1', 0)).toBeUndefined();
    expect(allocationCode('ext1', 't1', 4)).toBe('external_allocation_hours');
    expect(allocationCode('r1', 't1', 4)).toBeUndefined();
  });
});
