import { NULLABLE_FIELDS } from '../types/nullableFields.js';
import { describe, it, expect } from 'vitest';
import {
  assertActivityProjectAllowsDependents,
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  assertScopedRefs,
  getOwned,
} from './mutations.js';
import { emptyAppData } from '../types/entities.js';
import { addDaysISO } from '../lib/dateMath.js';
import { MAX_SPAN_DAYS } from '../lib/schedulingDays.js';
import { DomainError } from './errors.js';
import type {
  Account,
  Allocation,
  AppData,
  Client,
  Discipline,
  ID,
  Phase,
  Project,
  Resource,
  Activity,
  TimeOff,
} from '../types/entities.js';

interface ActivityOptions {
  id: ID;
  accountId: ID;
  projectId: ID;
  phaseId?: ID;
}

interface AllocationOptions {
  id: ID;
  accountId: ID;
  resourceId: ID;
  activityId: ID;
  overrides?: Partial<Allocation>;
}

interface TimeOffOptions {
  id: ID;
  accountId: ID;
  resourceId: ID;
  overrides?: Partial<TimeOff>;
}

// These specs exercise the shared mutations without the store or React. The server uses
// the same module, so these assertions pin the validation rules for both callers.

const TS = '2026-01-01T00:00:00.000Z';
const meta = (id: ID, accountId: ID) => ({
  id,
  accountId,
  createdAt: TS,
  updatedAt: TS,
});

const account = (id: ID, name = 'Co'): Account => ({
  ...NULLABLE_FIELDS.accounts,
  id,
  name,
  color: '#3b82f6',
  createdAt: TS,
  updatedAt: TS,
});
const client = (id: ID, accountId: ID, name = 'Ferris'): Client => ({
  ...NULLABLE_FIELDS.clients,
  ...meta(id, accountId),
  name,
  color: '#3b82f6',
});
const project = (id: ID, accountId: ID, clientId: ID): Project => ({
  ...NULLABLE_FIELDS.projects,
  ...meta(id, accountId),
  name: 'Web',
  clientId,
  color: '#3b82f6',
});
const phase = (id: ID, accountId: ID, projectId: ID): Phase => ({
  ...meta(id, accountId),
  name: 'Discovery',
  projectId,
});
const activity = ({ id, accountId, projectId, phaseId }: ActivityOptions): Activity => ({
  ...NULLABLE_FIELDS.activities,
  ...meta(id, accountId),
  name: 'Activity',
  kind: 'project',
  projectId,
  ...(phaseId === undefined ? {} : { phaseId }),
});
const person = (id: ID, accountId: ID): Resource => ({
  ...NULLABLE_FIELDS.resources,
  ...meta(id, accountId),
  kind: 'person',
  role: 'Designer',
  employmentType: 'permanent',
  engagement: 'studio' as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: '#3b82f6',
});
const discipline = (id: ID, accountId: ID): Discipline => ({
  ...NULLABLE_FIELDS.disciplines,
  ...meta(id, accountId),
  name: 'Design',
  sortOrder: 0,
});
const placeholder = (id: ID, accountId: ID, projectId?: ID): Resource => ({
  ...person(id, accountId),
  kind: 'placeholder',
  ...(projectId === undefined ? {} : { projectId }),
});
const external = (id: ID, accountId: ID): Resource => ({
  ...person(id, accountId),
  kind: 'external',
});
const allocation = ({
  id,
  accountId,
  resourceId,
  activityId,
  overrides: o = {},
}: AllocationOptions): Allocation => ({
  ...NULLABLE_FIELDS.allocations,
  ...meta(id, accountId),
  resourceId,
  activityId,
  startDate: '2026-01-01',
  endDate: '2026-01-05',
  hoursPerDay: 8,
  status: 'confirmed',
  ...o,
});
const timeOff = ({ id, accountId, resourceId, overrides: o = {} }: TimeOffOptions): TimeOff => ({
  ...NULLABLE_FIELDS.timeOff,
  ...meta(id, accountId),
  resourceId,
  startDate: '2026-01-01',
  endDate: '2026-01-03',
  type: 'holiday',
  ...o,
});

const A1 = 'acct-1';
const A2 = 'acct-2';
const base = (): AppData => ({
  ...emptyAppData(),
  accounts: [account(A1), account(A2)],
});

describe('getOwned', () => {
  it('returns the row when it belongs to the active account', () => {
    const data = { ...base(), clients: [client('c1', A1)] };
    expect(getOwned(data, A1, 'clients', 'c1')?.id).toBe('c1');
  });

  it('returns null for an absent id (stale-id no-op contract)', () => {
    expect(getOwned(base(), A1, 'clients', 'missing')).toBeNull();
  });

  it('throws when the row belongs to another account', () => {
    const data = { ...base(), clients: [client('c1', A2)] };
    expect(() => getOwned(data, A1, 'clients', 'c1')).toThrow(
      'That record does not belong to the active company.',
    );
  });

  it('carries a stable code independently from its display message', () => {
    const data = { ...base(), clients: [client('c1', A2)] };
    let error: unknown;
    try {
      getOwned(data, A1, 'clients', 'c1');
      // Capture the failure so the test can assert its domain code.
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe('record_wrong_account');
  });
});

const registerUnchangedParentIdOnUpdatePart1 = () => {
  it('passes an UNCHANGED clientId even when the client is absent from data (archived parent)', () => {
    const existing = project('p1', A1, 'c-archived');
    // No clients at all. The archived parent was stripped from the slice.
    expect(() =>
      assertScopedRefs(
        base(),
        A1,
        'projects',
        { name: 'Renamed', clientId: 'c-archived' },
        existing,
      ),
    ).not.toThrow();
  });
};
const registerUnchangedParentIdOnUpdatePart2 = () => {
  it('rejects an unchanged legacy reference when the resolved parent belongs to another account', () => {
    const existing = project('p1', A1, 'cross-account-client');
    const data: AppData = {
      ...base(),
      clients: [client('cross-account-client', A2)],
      projects: [existing],
    };

    expect(() =>
      assertScopedRefs(
        data,
        A1,
        'projects',
        { name: 'Unrelated rename', clientId: existing.clientId },
        existing,
      ),
    ).toThrow('Project must reference a client in this company.');
  });
};
const registerUnchangedParentIdOnUpdatePart3 = () => {
  it('still rejects a CHANGED clientId that is absent from data', () => {
    const existing = project('p1', A1, 'c-archived');
    expect(() =>
      assertScopedRefs(base(), A1, 'projects', { clientId: 'c-other' }, existing),
    ).toThrow('Project must reference a client in this company.');
  });
};
const registerUnchangedParentIdOnUpdatePart4 = () => {
  it('passes an UNCHANGED projectId+phaseId pair even when both are absent from data', () => {
    const existing = activity({
      id: 't1',
      accountId: A1,
      projectId: 'p-archived',
      phaseId: 'ph-archived',
    });
    const merged = { ...existing, name: 'Renamed' };
    expect(() => assertScopedRefs(base(), A1, 'activities', merged, existing)).not.toThrow();
  });
};
const registerUnchangedParentIdOnUpdatePart5 = () => {
  it('rejects an unchanged phaseId when the resolved legacy phase belongs to another account', () => {
    const existing = activity({
      id: 't1',
      accountId: A1,
      projectId: 'p1',
      phaseId: 'cross-account-phase',
    });
    const data: AppData = {
      ...base(),
      projects: [project('p1', A1, 'c1')],
      phases: [phase('cross-account-phase', A2, 'p2')],
      activities: [existing],
    };

    expect(() =>
      assertScopedRefs(data, A1, 'activities', { ...existing, name: 'Unrelated rename' }, existing),
    ).toThrow('Activity phase must belong to this company.');
  });
};
const registerUnchangedParentIdOnUpdatePart6 = () => {
  it('re-runs the full phase coherence check when the phaseId CHANGES', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
    };
    const existing = activity({ id: 't1', accountId: A1, projectId: 'p1', phaseId: 'ph-old' });
    const merged = { ...existing, phaseId: 'ph-new' };
    expect(() => assertScopedRefs(data, A1, 'activities', merged, existing)).toThrow(
      'Activity phase must belong to this company.',
    );
  });
};
const registerUnchangedParentIdOnUpdatePart7 = () => {
  it('passes an UNCHANGED placeholder projectId even when the project is absent from data', () => {
    const existing = placeholder('r1', A1, 'p-archived');
    expect(() =>
      assertScopedRefs(
        base(),
        A1,
        'resources',
        { name: 'Renamed', projectId: 'p-archived' },
        existing,
      ),
    ).not.toThrow();
  });
};
const registerUnchangedParentIdOnUpdatePart8 = () => {
  it('without `existing` (an ADD) the check stays strict', () => {
    expect(() => assertScopedRefs(base(), A1, 'projects', { clientId: 'c-archived' })).toThrow(
      'Project must reference a client in this company.',
    );
  });
};
const registerUnchangedParentIdOnUpdate = () => {
  registerUnchangedParentIdOnUpdatePart1();
  registerUnchangedParentIdOnUpdatePart2();
  registerUnchangedParentIdOnUpdatePart3();
  registerUnchangedParentIdOnUpdatePart4();
  registerUnchangedParentIdOnUpdatePart5();
  registerUnchangedParentIdOnUpdatePart6();
  registerUnchangedParentIdOnUpdatePart7();
  registerUnchangedParentIdOnUpdatePart8();
};
const registerAssertScopedRefsPart1 = () => {
  it.each(['clients', 'disciplines', 'allocations', 'timeOff'] as const)(
    'leaves %s validation to its dedicated boundary',
    (table) => {
      expect(() => assertScopedRefs(base(), A1, table, {})).not.toThrow();
    },
  );

  it('passes when a project references a client in the same account', () => {
    const data = { ...base(), clients: [client('c1', A1)] };
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'c1' })).not.toThrow();
  });

  it('throws when a project references a client in another account', () => {
    const data = { ...base(), clients: [client('c1', A2)] };
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'c1' })).toThrow(
      'Project must reference a client in this company.',
    );
  });

  it('rejects a non-string reference id', () => {
    const data = { ...base(), clients: [client('c1', A1)] };
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 1 })).toThrow(
      'Project must reference a client in this company.',
    );
  });
};

const registerAssertScopedRefsPart2 = () => {
  it('rejects a new reference to an archived parent at the generic scoped write boundary', () => {
    const archivedClient = { ...client('c1', A1), archivedAt: TS };
    const data = { ...base(), clients: [archivedClient] };
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'c1' })).toThrow(
      'Project must reference a client in this company.',
    );
  });

  it.each([
    ['archived', { archivedAt: TS }],
    ['soft-deleted', { archivedAt: TS, deletedAt: '2026-01-02T00:00:00.000Z' }],
  ] as const)(
    'rejects new descendants beneath an active project with an %s client ancestor',
    (_state, lifecycle) => {
      const existingPhase = phase('ph-existing', A1, 'p1');
      const data: AppData = {
        ...base(),
        clients: [{ ...client('c1', A1), ...lifecycle }],
        projects: [project('p1', A1, 'c1')],
        phases: [existingPhase],
      };

      expect(() => assertScopedRefs(data, A1, 'phases', { projectId: 'p1' })).toThrow(
        'Phase must reference a project in this company.',
      );
      expect(() =>
        assertScopedRefs(data, A1, 'activities', {
          kind: 'project',
          projectId: 'p1',
          name: 'New activity',
        }),
      ).toThrow('Activity must reference a project in this company.');
      expect(() =>
        assertScopedRefs(data, A1, 'resources', {
          kind: 'placeholder',
          projectId: 'p1',
          role: 'Slot',
        }),
      ).toThrow('Placeholder project must belong to this company.');

      // The existing row already owns this reference. Preserve the established relaxation for an
      // unrelated edit while refusing every create/reparent onto the hidden subtree.
      expect(() =>
        assertScopedRefs(data, A1, 'phases', { ...existingPhase, name: 'Renamed' }, existingPhase),
      ).not.toThrow();
    },
  );
};

const registerAssertScopedRefsPart3 = () => {
  it('only checks FK fields actually present (partial patch)', () => {
    // A patch with no clientId must not be rejected for omitting it.
    const existing = project('p1', A1, 'c1');
    expect(() =>
      assertScopedRefs(base(), A1, 'projects', { name: 'Renamed' }, existing),
    ).not.toThrow();
  });

  it('throws when an activity phase belongs to another account', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [phase('ph1', A2, 'p1')],
    };
    expect(() =>
      assertScopedRefs(data, A1, 'activities', {
        projectId: 'p1',
        phaseId: 'ph1',
      }),
    ).toThrow('Activity phase must belong to this company.');
  });

  it('throws when an activity phase belongs to a DIFFERENT project than the activity', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      phases: [phase('ph1', A1, 'p1')],
    };
    // Activity is bound to p2 but references p1's phase, double-bound to two projects.
    expect(() =>
      assertScopedRefs(data, A1, 'activities', {
        projectId: 'p2',
        phaseId: 'ph1',
      }),
    ).toThrow('Activity phase must belong to the activity’s project.');
  });
};

const registerAssertScopedRefsPart4 = () => {
  it('throws when an activity carries a phase but no project', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [phase('ph1', A1, 'p1')],
    };
    expect(() => assertScopedRefs(data, A1, 'activities', { phaseId: 'ph1' })).toThrow(
      'An activity with a phase must also belong to that phase’s project.',
    );
  });

  it('passes when an activity phase belongs to the activity’s own project', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [phase('ph1', A1, 'p1')],
    };
    expect(() =>
      assertScopedRefs(data, A1, 'activities', {
        projectId: 'p1',
        phaseId: 'ph1',
      }),
    ).not.toThrow();
  });

  it('throws when a project activity carries no project (kind coherence)', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
    };
    expect(() => assertScopedRefs(data, A1, 'activities', { kind: 'project', name: 'T' })).toThrow(
      'A project-specific activity must be assigned to a project.',
    );
  });
};

const registerAssertScopedRefsPart5 = () => {
  it('throws when an internal/repeatable activity carries a project or phase (kind coherence)', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [phase('ph1', A1, 'p1')],
    };
    expect(() =>
      assertScopedRefs(data, A1, 'activities', {
        kind: 'internal',
        projectId: 'p1',
      }),
    ).toThrow('cannot belong to a project');
    expect(() =>
      assertScopedRefs(data, A1, 'activities', {
        kind: 'repeatable',
        phaseId: 'ph1',
      }),
    ).toThrow('cannot belong to a phase');
  });

  it('passes for a valid project-less internal activity', () => {
    expect(() =>
      assertScopedRefs(base(), A1, 'activities', {
        kind: 'internal',
        name: 'Admin',
      }),
    ).not.toThrow();
  });

  it('throws when a placeholder is bound to a project in another account', () => {
    const data = {
      ...base(),
      clients: [client('c1', A2)],
      projects: [project('p1', A2, 'c1')],
    };
    expect(() => assertScopedRefs(data, A1, 'resources', { projectId: 'p1' })).toThrow(
      'Placeholder project must belong to this company.',
    );
  });
};

const registerAssertScopedRefsPart6 = () => {
  it('rejects project bindings on people and externals at the shared write boundary', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
    };

    expect(() =>
      assertScopedRefs(data, A1, 'resources', { kind: 'person', projectId: 'p1' }),
    ).toThrow('Only a placeholder can be assigned to a project.');
    expect(() =>
      assertScopedRefs(data, A1, 'resources', { kind: 'external', projectId: 'p1' }),
    ).toThrow('Only a placeholder can be assigned to a project.');
  });

  it('rejects converting a bound placeholder without clearing its project', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
    };
    const existing = placeholder('r1', A1, 'p1');

    expect(() => assertScopedRefs(data, A1, 'resources', { kind: 'person' }, existing)).toThrow(
      'A resource’s kind cannot change after creation.',
    );
    expect(() =>
      assertScopedRefs(data, A1, 'resources', { kind: 'person', projectId: undefined }, existing),
    ).toThrow('A resource’s kind cannot change after creation.');
  });

  it('does not make an unrelated edit fail solely because of a legacy non-placeholder binding', () => {
    const existing = { ...person('r1', A1), projectId: 'legacy-project' };
    expect(() =>
      assertScopedRefs(base(), A1, 'resources', { name: 'Renamed' }, existing),
    ).not.toThrow();
  });
};

const registerAssertScopedRefsPart7 = () => {
  it('rejects absent or null required parents on project and phase creates', () => {
    expect(() => assertScopedRefs(base(), A1, 'projects', { name: 'No parent' })).toThrow(
      'Project must reference a client in this company.',
    );
    expect(() => assertScopedRefs(base(), A1, 'projects', { clientId: null })).toThrow(
      'Project must reference a client in this company.',
    );
    expect(() => assertScopedRefs(base(), A1, 'phases', { name: 'No parent' })).toThrow(
      'Phase must reference a project in this company.',
    );
    expect(() => assertScopedRefs(base(), A1, 'phases', { projectId: null })).toThrow(
      'Phase must reference a project in this company.',
    );
  });

  it('rejects an explicitly cleared required parent on a partial patch', () => {
    expect(() =>
      assertScopedRefs(base(), A1, 'projects', { clientId: null }, project('p1', A1, 'c1')),
    ).toThrow('Project must reference a client in this company.');
    expect(() =>
      assertScopedRefs(base(), A1, 'phases', { projectId: undefined }, phase('ph1', A1, 'p1')),
    ).toThrow('Phase must reference a project in this company.');
  });

  it('rejects a project whose client id is ABSENT even though ANOTHER client belongs to the account', () => {
    // The in-account check must match the referenced id, not merely "does any row belong here": with a
    // valid A1 client present but a dangling reference, the FK is still unsatisfied and must throw.
    const data = { ...base(), clients: [client('c1', A1)] };
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'ghost' })).toThrow(
      'Project must reference a client in this company.',
    );
  });
};

const registerAssertScopedRefsPart8 = () => {
  it('validates a phase’s projectId FK (throws cross-account, passes in-account)', () => {
    const cross = {
      ...base(),
      clients: [client('c1', A2)],
      projects: [project('p1', A2, 'c1')],
    };
    expect(() => assertScopedRefs(cross, A1, 'phases', { projectId: 'p1' })).toThrow(
      'Phase must reference a project in this company.',
    );
    const ok = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
    };
    expect(() => assertScopedRefs(ok, A1, 'phases', { projectId: 'p1' })).not.toThrow();
  });

  it('validates an activity’s projectId FK with its OWN message when a dangling project is referenced', () => {
    const data = { ...base(), clients: [client('c1', A1)] };
    expect(() => assertScopedRefs(data, A1, 'activities', { projectId: 'ghost' })).toThrow(
      'Activity must reference a project in this company.',
    );
  });

  it('rejects an activity whose phase id is ABSENT even though ANOTHER phase belongs to the account', () => {
    // The phase lookup must match the referenced id, not "any account phase": a dangling phaseId must
    // fail with the belong-to-company message even when a real phase exists in the account.
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [phase('ph1', A1, 'p1')],
    };
    expect(() =>
      assertScopedRefs(data, A1, 'activities', {
        projectId: 'p1',
        phaseId: 'ph-absent',
      }),
    ).toThrow('Activity phase must belong to this company.');
  });
};

const registerAssertScopedRefsPart9 = () => {
  it('an UNRECOGNISED activity kind is not treated as internal/repeatable (no false project rejection)', () => {
    // assertScopedRefs checks refs + coherence for the known kinds only; it does not police the kind
    // enum itself (sanitize does). An unknown kind carrying a valid project must pass the ref checks.
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1')],
    };
    expect(() =>
      assertScopedRefs(data, A1, 'activities', {
        kind: 'bogus',
        projectId: 'p1',
      }),
    ).not.toThrow();
  });

  it('validates a resource’s disciplineId FK with its own message (dangling discipline throws)', () => {
    const data = { ...base(), disciplines: [discipline('d1', A2)] };
    expect(() => assertScopedRefs(data, A1, 'resources', { disciplineId: 'd1' })).toThrow(
      'Resource discipline must belong to this company.',
    );
  });

  // The unchanged-on-update relaxation (5th arg `existing`): in server mode the client's hydrated
  // slice is active-only, so an unchanged parent id pointing at an archived parent (absent from
  // `data`) must not block an unrelated edit. A changed id is still validated strictly.
  describe(
    'unchanged parent id on update (existing row passed)',
    registerUnchangedParentIdOnUpdate,
  );
};

describe('assertScopedRefs', () => {
  registerAssertScopedRefsPart1();
  registerAssertScopedRefsPart2();
  registerAssertScopedRefsPart3();
  registerAssertScopedRefsPart4();
  registerAssertScopedRefsPart5();
  registerAssertScopedRefsPart6();
  registerAssertScopedRefsPart7();
  registerAssertScopedRefsPart8();
  registerAssertScopedRefsPart9();
});

const registerAssertAllocationRefsPart1 = (world: () => AppData) => {
  it('passes for a real resource + activity in the account', () => {
    expect(() => assertAllocationRefs(world(), A1, 'r1', 't1', 8)).not.toThrow();
  });

  it('throws when the resource or activity is missing / cross-account', () => {
    expect(() => assertAllocationRefs(world(), A1, 'missing', 't1', 8)).toThrow(
      'Allocation must reference an existing resource and activity in this company.',
    );
  });
};

const registerAssertAllocationRefsPart2 = (world: () => AppData) => {
  it('rejects new allocations to archived resources and archived projects', () => {
    const archivedResource: AppData = {
      ...world(),
      resources: [{ ...person('r1', A1), archivedAt: TS }],
    };
    expect(() => assertAllocationRefs(archivedResource, A1, 'r1', 't1', 8)).toThrow(
      'Allocation must reference an active resource in this company.',
    );

    const archivedProject: AppData = {
      ...world(),
      projects: [{ ...project('p1', A1, 'c1'), archivedAt: TS }],
    };
    expect(() => assertAllocationRefs(archivedProject, A1, 'r1', 't1', 8)).toThrow(
      'Allocation must reference an activity under an active project.',
    );
  });

  it.each([
    ['archived', { archivedAt: TS }],
    ['soft-deleted', { archivedAt: TS, deletedAt: '2026-01-02T00:00:00.000Z' }],
  ] as const)(
    'rejects new allocations beneath an active project with an %s client ancestor',
    (_state, lifecycle) => {
      const data: AppData = {
        ...world(),
        clients: [{ ...client('c1', A1), ...lifecycle }],
      };

      expect(() => assertAllocationRefs(data, A1, 'r1', 't1', 8)).toThrow(
        'Allocation must reference an activity under an active project.',
      );
      expect(() =>
        assertAllocationRefs(data, A1, 'r1', 't1', 8, undefined, {
          resourceId: 'r1',
          activityId: 't1',
        }),
      ).not.toThrow();
    },
  );
};

const registerAssertAllocationRefsPart3 = (world: () => AppData) => {
  it('rejects a project-bound activity whose project is missing or belongs to another account', () => {
    const missingProject = { ...world(), projects: [] };
    expect(() => assertAllocationRefs(missingProject, A1, 'r1', 't1', 8)).toThrow(
      'Allocation must reference an activity under an active project in this company.',
    );

    const crossAccountProject = {
      ...world(),
      projects: [project('p1', A2, 'c1')],
    };
    expect(() => assertAllocationRefs(crossAccountProject, A1, 'r1', 't1', 8)).toThrow(
      'Allocation must reference an activity under an active project in this company.',
    );
  });

  it('allows unchanged archived references but rejects switching an existing allocation to them', () => {
    const data: AppData = {
      ...world(),
      projects: [project('p1', A1, 'c1'), { ...project('p2', A1, 'c1'), archivedAt: TS }],
      activities: [
        activity({ id: 't1', accountId: A1, projectId: 'p1' }),
        activity({ id: 't2', accountId: A1, projectId: 'p2' }),
      ],
      resources: [person('r1', A1), { ...person('r2', A1), archivedAt: TS }],
    };

    expect(() =>
      assertAllocationRefs(data, A1, 'r2', 't2', 8, undefined, {
        resourceId: 'r2',
        activityId: 't2',
      }),
    ).not.toThrow();
    expect(() =>
      assertAllocationRefs(data, A1, 'r2', 't1', 8, undefined, {
        resourceId: 'r1',
        activityId: 't1',
      }),
    ).toThrow('Allocation must reference an active resource in this company.');
    expect(() =>
      assertAllocationRefs(data, A1, 'r1', 't2', 8, undefined, {
        resourceId: 'r1',
        activityId: 't1',
      }),
    ).toThrow('Allocation must reference an activity under an active project.');
  });
};

const registerAssertAllocationRefsPart4 = (world: () => AppData) => {
  it('throws when a placeholder is assigned outside its bound project', () => {
    const data: AppData = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      activities: [activity({ id: 't2', accountId: A1, projectId: 'p2' })],
      resources: [placeholder('ph', A1, 'p1')],
    };
    expect(() => assertAllocationRefs(data, A1, 'ph', 't2', 8)).toThrow(
      'A placeholder can only be assigned to activities from its bound project.',
    );
  });

  it('rejects a non-zero load on an external / 3rd-party resource (no capacity)', () => {
    const data: AppData = { ...world(), resources: [external('ext', A1)] };
    expect(() => assertAllocationRefs(data, A1, 'ext', 't1', 8)).toThrow('can’t carry hours');
  });

  it('allows a zero load on an external resource (the external rule is always enforced)', () => {
    const data: AppData = { ...world(), resources: [external('ext', A1)] };
    expect(() => assertAllocationRefs(data, A1, 'ext', 't1', 0)).not.toThrow();
  });

  it('allows a non-zero load on a normal resource', () => {
    expect(() => assertAllocationRefs(world(), A1, 'r1', 't1', 8)).not.toThrow();
  });
};

const registerAssertAllocationRefsPart5 = (world: () => AppData) => {
  it('enforces repeatable-only attribution, project ownership/liveness and placeholder scope', () => {
    const repeatable: Activity = {
      ...activity({ id: 'repeatable', accountId: A1, projectId: 'p1' }),
      kind: 'repeatable' as const,
    };
    repeatable.projectId = null;
    const projectActivity = world().activities[0];
    if (projectActivity === undefined) {
      throw new Error('World fixture must include a project activity.');
    }
    const data: AppData = {
      ...world(),
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1'), project('foreign', A2, 'c2')],
      activities: [projectActivity, repeatable],
      resources: [
        person('r1', A1),
        placeholder('bound', A1, 'p1'),
        placeholder('unbound', A1, undefined),
      ],
    };

    expect(() => assertAllocationRefs(data, A1, 'r1', 'repeatable', 8, 'p1')).not.toThrow();
    expect(() => assertAllocationRefs(data, A1, 'r1', 't1', 8, 'p1')).toThrowError(
      expect.objectContaining({ code: 'allocation_project_forbidden' }),
    );
    expect(() => assertAllocationRefs(data, A1, 'r1', 'repeatable', 8, 'missing')).toThrow(
      /active project/i,
    );
    expect(() => assertAllocationRefs(data, A1, 'r1', 'repeatable', 8, 'foreign')).toThrow(
      /active project/i,
    );
    expect(() => assertAllocationRefs(data, A1, 'bound', 'repeatable', 8, 'p1')).not.toThrow();
    expect(() => assertAllocationRefs(data, A1, 'bound', 'repeatable', 8, 'p2')).toThrow(
      /bound project/i,
    );
    expect(() => assertAllocationRefs(data, A1, 'unbound', 'repeatable', 8, 'p1')).toThrow(
      /not bound/i,
    );
  });

  it('allows an unchanged archived allocation attribution but rejects changing to it', () => {
    const repeatable: Activity = {
      ...activity({ id: 'repeatable', accountId: A1, projectId: 'p1' }),
      kind: 'repeatable' as const,
    };
    repeatable.projectId = null;
    const data: AppData = {
      ...world(),
      projects: [{ ...project('p1', A1, 'c1'), archivedAt: TS }],
      activities: [repeatable],
    };
    const existing = { resourceId: 'r1', activityId: 'repeatable', projectId: 'p1' };

    expect(() =>
      assertAllocationRefs(data, A1, 'r1', 'repeatable', 8, 'p1', existing),
    ).not.toThrow();
    expect(() =>
      assertAllocationRefs(data, A1, 'r1', 'repeatable', 8, 'p1', {
        resourceId: existing.resourceId,
        activityId: existing.activityId,
      }),
    ).toThrow(/active project/i);
  });
};

describe('assertAllocationRefs', () => {
  const world = (): AppData => ({
    ...base(),
    clients: [client('c1', A1)],
    projects: [project('p1', A1, 'c1')],
    activities: [activity({ id: 't1', accountId: A1, projectId: 'p1' })],
    resources: [person('r1', A1)],
  });
  registerAssertAllocationRefsPart1(world);
  registerAssertAllocationRefsPart2(world);
  registerAssertAllocationRefsPart3(world);
  registerAssertAllocationRefsPart4(world);
  registerAssertAllocationRefsPart5(world);
});

describe('assertDateRange', () => {
  it('passes for a valid forward range', () => {
    expect(() => assertDateRange('2026-01-01', '2026-01-05')).not.toThrow();
  });
  it('throws for a reversed range', () => {
    expect(() => assertDateRange('2026-01-05', '2026-01-01')).toThrow(
      'End date cannot be before the start date.',
    );
  });
  it('throws when an end is missing', () => {
    expect(() => assertDateRange('2026-01-01', undefined)).toThrow(
      'Start and end dates are required.',
    );
  });
  it('throws before a range can exceed the shared calendar-span bound', () => {
    const start = '2026-01-01';
    expect(() => assertDateRange(start, addDaysISO(start, MAX_SPAN_DAYS - 1))).not.toThrow();
    expect(() => assertDateRange(start, addDaysISO(start, MAX_SPAN_DAYS))).toThrow(
      'Date span cannot exceed 36,500 calendar days.',
    );
  });
});

describe('assertResourceExists', () => {
  it('passes when the resource is in the account', () => {
    const data = { ...base(), resources: [person('r1', A1)] };
    expect(() => assertResourceExists(data, A1, 'r1')).not.toThrow();
  });
  it('throws for a missing / cross-account resource', () => {
    const data = { ...base(), resources: [person('r1', A2)] };
    expect(() => assertResourceExists(data, A1, 'r1')).toThrow(
      'Time off must reference an existing resource in this company.',
    );
  });
  it('rejects a new reference to an archived resource but permits an unchanged archived reference', () => {
    const data = {
      ...base(),
      resources: [{ ...person('r1', A1), archivedAt: TS }],
    };
    expect(() => assertResourceExists(data, A1, 'r1')).toThrow(
      'Time off must reference an active resource in this company.',
    );
    expect(() => assertResourceExists(data, A1, 'r1', { resourceId: 'r1' })).not.toThrow();
    expect(() => assertResourceExists(data, A1, 'r1', { resourceId: 'other' })).toThrow(
      'Time off must reference an active resource in this company.',
    );
  });
  it('rejects a resource hidden by an inactive project ancestor', () => {
    const data = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [{ ...project('p1', A1, 'c1'), archivedAt: TS }],
      resources: [{ ...person('r1', A1), kind: 'placeholder' as const, projectId: 'p1' }],
    };
    expect(() => assertResourceExists(data, A1, 'r1')).toThrow(
      'Time off must reference an active resource in this company.',
    );
  });
  it('throws for an external / 3rd-party resource (no capacity → no time off)', () => {
    const data = { ...base(), resources: [external('ext', A1)] };
    expect(() => assertResourceExists(data, A1, 'ext')).toThrow(
      'Time off can’t be recorded for an external / 3rd-party resource.',
    );
  });
});

const registerAssertResourceKindAllowsDependentsPart1 = () => {
  const reject = /reassign or remove this resource’s work and time off/i;

  it('is a no-op when the merged kind is not external', () => {
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1)],
      activities: [activity({ id: 't1', accountId: A1, projectId: 'p1' })],
      allocations: [
        allocation({
          id: 'al',
          accountId: A1,
          resourceId: 'r1',
          activityId: 't1',
          overrides: { hoursPerDay: 8 },
        }),
      ],
      timeOff: [timeOff({ id: 'to', accountId: A1, resourceId: 'r1' })],
    };
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'person')).not.toThrow();
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'placeholder')).not.toThrow();
  });

  it('rejects making external a resource that still owns a loaded allocation', () => {
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1)],
      allocations: [
        allocation({
          id: 'al',
          accountId: A1,
          resourceId: 'r1',
          activityId: 't1',
          overrides: { hoursPerDay: 8 },
        }),
      ],
    };
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).toThrow(reject);
  });

  it('rejects making external a resource that still owns time off', () => {
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1)],
      timeOff: [timeOff({ id: 'to', accountId: A1, resourceId: 'r1' })],
    };
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).toThrow(reject);
  });
};

const registerAssertResourceKindAllowsDependentsPart2 = () => {
  it('ignores company closures when making a resource external', () => {
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1)],
      closures: [
        {
          ...meta('closure', A1),
          name: 'Company shutdown',
          startDate: '2026-01-01',
          endDate: '2026-01-03',
        },
      ],
    };
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).not.toThrow();
  });

  it('allows making external a resource whose only allocation carries a zero load (already valid for an external)', () => {
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1)],
      allocations: [
        allocation({
          id: 'al',
          accountId: A1,
          resourceId: 'r1',
          activityId: 't1',
          overrides: { hoursPerDay: 0 },
        }),
      ],
    };
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).not.toThrow();
  });

  it('allows making external a resource with no dependents', () => {
    const data: AppData = { ...base(), resources: [person('r1', A1)] };
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).not.toThrow();
  });

  it('only considers THIS resource’s dependents in THIS account', () => {
    // Another resource's loaded allocation + a same-id dependent in a different account must not block.
    const data: AppData = {
      ...base(),
      resources: [person('r1', A1), person('other', A1)],
      allocations: [
        allocation({
          id: 'al',
          accountId: A1,
          resourceId: 'other',
          activityId: 't1',
          overrides: { hoursPerDay: 8 },
        }),
        allocation({
          id: 'al2',
          accountId: A2,
          resourceId: 'r1',
          activityId: 't1',
          overrides: { hoursPerDay: 8 },
        }),
      ],
      timeOff: [timeOff({ id: 'to', accountId: A2, resourceId: 'r1' })],
    };
    expect(() => assertResourceKindAllowsDependents(data, A1, 'r1', 'external')).not.toThrow();
  });
};

describe('assertResourceKindAllowsDependents', () => {
  registerAssertResourceKindAllowsDependentsPart1();
  registerAssertResourceKindAllowsDependentsPart2();
});

const registerParentProjectEditsPart1 = (rejectResource: RegExp) => {
  it('rejects rebinding a placeholder while it owns work under its previous project', () => {
    const existing = placeholder('ph', A1, 'p1');
    const data: AppData = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      resources: [existing],
      activities: [activity({ id: 't1', accountId: A1, projectId: 'p1' })],
      allocations: [allocation({ id: 'al', accountId: A1, resourceId: 'ph', activityId: 't1' })],
    };

    expect(() =>
      assertResourceProjectAllowsDependents(
        data,
        A1,
        'ph',
        { ...existing, projectId: 'p2' },
        existing,
      ),
    ).toThrow(rejectResource);
  });

  it('allows a rebind when the placeholder only owns project-less work', () => {
    const existing = placeholder('ph', A1, 'p1');
    const data: AppData = {
      ...base(),
      resources: [existing],
      activities: [
        {
          ...NULLABLE_FIELDS.activities,
          ...meta('general', A1),
          name: 'Admin',
          kind: 'repeatable',
        },
      ],
      allocations: [
        allocation({ id: 'al', accountId: A1, resourceId: 'ph', activityId: 'general' }),
      ],
    };

    expect(() =>
      assertResourceProjectAllowsDependents(
        data,
        A1,
        'ph',
        { ...existing, projectId: 'p2' },
        existing,
      ),
    ).not.toThrow();
  });
};

const registerParentProjectEditsPart2 = (rejectResource: RegExp, rejectActivity: RegExp) => {
  it('rejects rebinding a placeholder with repeatable work attributed to its bound project', () => {
    const existing = placeholder('ph', A1, 'p1');
    const repeatable: Activity = {
      ...NULLABLE_FIELDS.activities,
      ...meta('shared', A1),
      name: 'Shared',
      kind: 'repeatable',
    };
    const data: AppData = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      resources: [existing],
      activities: [repeatable],
      allocations: [
        allocation({
          id: 'al',
          accountId: A1,
          resourceId: 'ph',
          activityId: 'shared',
          overrides: { projectId: 'p1' },
        }),
      ],
    };

    expect(() =>
      assertResourceProjectAllowsDependents(
        data,
        A1,
        'ph',
        { ...existing, projectId: 'p2' },
        existing,
      ),
    ).toThrow(rejectResource);
  });

  it('validates the post-clear effective project when repeatable work becomes project-specific', () => {
    const existing: Activity = {
      ...NULLABLE_FIELDS.activities,
      ...meta('shared', A1),
      name: 'Shared',
      kind: 'repeatable',
    };
    const data: AppData = {
      ...base(),
      clients: [client('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      resources: [placeholder('ph', A1, 'p1')],
      activities: [existing],
      allocations: [
        allocation({
          id: 'al',
          accountId: A1,
          resourceId: 'ph',
          activityId: 'shared',
          overrides: { projectId: 'p1' },
        }),
      ],
    };

    expect(() =>
      assertActivityProjectAllowsDependents(
        data,
        A1,
        'shared',
        { ...existing, kind: 'project', projectId: 'p2' },
        existing,
      ),
    ).toThrow(rejectActivity);
    expect(() =>
      assertActivityProjectAllowsDependents(
        data,
        A1,
        'shared',
        { ...existing, kind: 'internal' },
        existing,
      ),
    ).not.toThrow();
  });
};

const registerParentProjectEditsPart3 = (rejectResource: RegExp, rejectActivity: RegExp) => {
  it('rejects converting a person with all-projects work into a bound placeholder', () => {
    const existing = person('r1', A1);
    const data: AppData = {
      ...base(),
      resources: [existing],
      activities: [activity({ id: 't1', accountId: A1, projectId: 'p1' })],
      allocations: [allocation({ id: 'al', accountId: A1, resourceId: 'r1', activityId: 't1' })],
    };

    expect(() =>
      assertResourceProjectAllowsDependents(
        data,
        A1,
        'r1',
        { ...existing, kind: 'placeholder', projectId: 'p2' },
        existing,
      ),
    ).toThrow(rejectResource);
  });

  it('rejects moving an activity while a placeholder bound to its previous project owns it', () => {
    const existing = activity({ id: 't1', accountId: A1, projectId: 'p1' });
    const data: AppData = {
      ...base(),
      resources: [placeholder('ph', A1, 'p1')],
      activities: [existing],
      allocations: [allocation({ id: 'al', accountId: A1, resourceId: 'ph', activityId: 't1' })],
    };

    expect(() =>
      assertActivityProjectAllowsDependents(
        data,
        A1,
        't1',
        { ...existing, projectId: 'p2' },
        existing,
      ),
    ).toThrow(rejectActivity);
  });
};

const registerParentProjectEditsPart4 = () => {
  it('allows moving an activity owned only by people and allows making placeholder work project-less', () => {
    const projectActivity = activity({ id: 'project-work', accountId: A1, projectId: 'p1' });
    const placeholderActivity = activity({
      id: 'placeholder-work',
      accountId: A1,
      projectId: 'p1',
    });
    const data: AppData = {
      ...base(),
      resources: [person('person', A1), placeholder('ph', A1, 'p1')],
      activities: [projectActivity, placeholderActivity],
      allocations: [
        allocation({
          id: 'person-al',
          accountId: A1,
          resourceId: 'person',
          activityId: 'project-work',
        }),
        allocation({
          id: 'placeholder-al',
          accountId: A1,
          resourceId: 'ph',
          activityId: 'placeholder-work',
        }),
      ],
    };

    expect(() =>
      assertActivityProjectAllowsDependents(
        data,
        A1,
        'project-work',
        { ...projectActivity, projectId: 'p2' },
        projectActivity,
      ),
    ).not.toThrow();
    expect(() =>
      assertActivityProjectAllowsDependents(
        data,
        A1,
        'placeholder-work',
        (() => {
          const changed = { ...placeholderActivity, kind: 'repeatable' as const };
          changed.projectId = null;
          return changed;
        })(),
        placeholderActivity,
      ),
    ).not.toThrow();
  });
};

const registerParentProjectEditsPart5 = () => {
  it('does not make an unrelated edit the repair boundary for already-corrupt assignments', () => {
    const resource = placeholder('ph', A1, 'p2');
    const activityRow = activity({ id: 't1', accountId: A1, projectId: 'p1' });
    const data: AppData = {
      ...base(),
      resources: [resource],
      activities: [activityRow],
      allocations: [allocation({ id: 'al', accountId: A1, resourceId: 'ph', activityId: 't1' })],
    };

    expect(() =>
      assertResourceProjectAllowsDependents(data, A1, 'ph', resource, resource),
    ).not.toThrow();
    expect(() =>
      assertActivityProjectAllowsDependents(data, A1, 't1', activityRow, activityRow),
    ).not.toThrow();
  });
};

describe('parent project edits preserve placeholder allocation assignments', () => {
  const rejectResource =
    /reassign or remove this placeholder’s work before changing its bound project/i;
  const rejectActivity = /reassign placeholder work before changing this activity’s project/i;
  registerParentProjectEditsPart1(rejectResource);
  registerParentProjectEditsPart2(rejectResource, rejectActivity);
  registerParentProjectEditsPart3(rejectResource, rejectActivity);
  registerParentProjectEditsPart4();
  registerParentProjectEditsPart5();
});
