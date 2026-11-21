import { describe, it, expect } from 'vitest';
import { DomainError } from '../errors.js';
import type { Activity, AppData } from '../../types/entities.js';
import { assertAllocationRefs, assertScopedRefs, getOwned } from './refs.js';
import {
  TS,
  makeClient,
  project,
  makePhase,
  makeActivity,
  makePerson,
  makeDiscipline,
  makePlaceholder,
  makeExternal,
  A1,
  A2,
  makeBaseData,
} from './assertionMessagesTestKit.js';

// These specs check each rule's rejection message without the store or React. The server uses
// the same module, so these assertions pin the validation rules for both callers.

describe('getOwned', () => {
  it('returns the row when it belongs to the active account', () => {
    const data = { ...makeBaseData(), clients: [makeClient('c1', A1)] };
    expect(getOwned(data, A1, 'clients', 'c1')?.id).toBe('c1');
  });

  it('returns null for an absent id (stale-id no-op contract)', () => {
    expect(getOwned(makeBaseData(), A1, 'clients', 'missing')).toBeNull();
  });

  it('throws when the row belongs to another account', () => {
    const data = { ...makeBaseData(), clients: [makeClient('c1', A2)] };
    expect(() => getOwned(data, A1, 'clients', 'c1')).toThrow(
      'That record does not belong to the active company.',
    );
  });

  it('carries a stable code independently from its display message', () => {
    const data = { ...makeBaseData(), clients: [makeClient('c1', A2)] };
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

describe('assertScopedRefs', () => {
  it.each(['clients', 'disciplines', 'allocations', 'timeOff'] as const)(
    'leaves %s validation to its dedicated boundary',
    (table) => {
      expect(() => assertScopedRefs(makeBaseData(), A1, table, {})).not.toThrow();
    },
  );

  it('passes when a project references a client in the same account', () => {
    const data = { ...makeBaseData(), clients: [makeClient('c1', A1)] };
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'c1' })).not.toThrow();
  });

  it('throws when a project references a client in another account', () => {
    const data = { ...makeBaseData(), clients: [makeClient('c1', A2)] };
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'c1' })).toThrow(
      'Project must reference a client in this company.',
    );
  });

  it('rejects a non-string reference id', () => {
    const data = { ...makeBaseData(), clients: [makeClient('c1', A1)] };
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 1 })).toThrow(
      'Project must reference a client in this company.',
    );
  });
  it('rejects a new reference to an archived parent at the generic scoped write boundary', () => {
    const archivedClient = { ...makeClient('c1', A1), archivedAt: TS };
    const data = { ...makeBaseData(), clients: [archivedClient] };
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
      const existingPhase = makePhase('ph-existing', A1, 'p1');
      const data: AppData = {
        ...makeBaseData(),
        clients: [{ ...makeClient('c1', A1), ...lifecycle }],
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
  it('only checks FK fields actually present (partial patch)', () => {
    // A patch with no clientId must not be rejected for omitting it.
    const existing = project('p1', A1, 'c1');
    expect(() =>
      assertScopedRefs(makeBaseData(), A1, 'projects', { name: 'Renamed' }, existing),
    ).not.toThrow();
  });

  it('throws when an activity phase belongs to another account', () => {
    const data = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [makePhase('ph1', A2, 'p1')],
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
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      phases: [makePhase('ph1', A1, 'p1')],
    };
    // Activity is bound to p2 but references p1's phase, double-bound to two projects.
    expect(() =>
      assertScopedRefs(data, A1, 'activities', {
        projectId: 'p2',
        phaseId: 'ph1',
      }),
    ).toThrow('Activity phase must belong to the activity’s project.');
  });
  it('throws when an activity carries a phase but no project', () => {
    const data = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [makePhase('ph1', A1, 'p1')],
    };
    expect(() => assertScopedRefs(data, A1, 'activities', { phaseId: 'ph1' })).toThrow(
      'An activity with a phase must also belong to that phase’s project.',
    );
  });

  it('passes when an activity phase belongs to the activity’s own project', () => {
    const data = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [makePhase('ph1', A1, 'p1')],
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
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1')],
    };
    expect(() => assertScopedRefs(data, A1, 'activities', { kind: 'project', name: 'T' })).toThrow(
      'A project-specific activity must be assigned to a project.',
    );
  });
  it('throws when an internal/repeatable activity carries a project or phase (kind coherence)', () => {
    const data = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [makePhase('ph1', A1, 'p1')],
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
      assertScopedRefs(makeBaseData(), A1, 'activities', {
        kind: 'internal',
        name: 'Admin',
      }),
    ).not.toThrow();
  });

  it('throws when a placeholder is bound to a project in another account', () => {
    const data = {
      ...makeBaseData(),
      clients: [makeClient('c1', A2)],
      projects: [project('p1', A2, 'c1')],
    };
    expect(() => assertScopedRefs(data, A1, 'resources', { projectId: 'p1' })).toThrow(
      'Placeholder project must belong to this company.',
    );
  });
  it('rejects project bindings on people and externals at the shared write boundary', () => {
    const data = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
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
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1')],
    };
    const existing = makePlaceholder('r1', A1, 'p1');

    expect(() => assertScopedRefs(data, A1, 'resources', { kind: 'person' }, existing)).toThrow(
      'A resource’s kind cannot change after creation.',
    );
    expect(() =>
      assertScopedRefs(data, A1, 'resources', { kind: 'person', projectId: undefined }, existing),
    ).toThrow('A resource’s kind cannot change after creation.');
  });

  it('does not make an unrelated edit fail solely because of a legacy non-placeholder binding', () => {
    const existing = { ...makePerson('r1', A1), projectId: 'legacy-project' };
    expect(() =>
      assertScopedRefs(makeBaseData(), A1, 'resources', { name: 'Renamed' }, existing),
    ).not.toThrow();
  });
  it('rejects absent or null required parents on project and phase creates', () => {
    expect(() => assertScopedRefs(makeBaseData(), A1, 'projects', { name: 'No parent' })).toThrow(
      'Project must reference a client in this company.',
    );
    expect(() => assertScopedRefs(makeBaseData(), A1, 'projects', { clientId: null })).toThrow(
      'Project must reference a client in this company.',
    );
    expect(() => assertScopedRefs(makeBaseData(), A1, 'phases', { name: 'No parent' })).toThrow(
      'Phase must reference a project in this company.',
    );
    expect(() => assertScopedRefs(makeBaseData(), A1, 'phases', { projectId: null })).toThrow(
      'Phase must reference a project in this company.',
    );
  });

  it('rejects an explicitly cleared required parent on a partial patch', () => {
    expect(() =>
      assertScopedRefs(makeBaseData(), A1, 'projects', { clientId: null }, project('p1', A1, 'c1')),
    ).toThrow('Project must reference a client in this company.');
    expect(() =>
      assertScopedRefs(
        makeBaseData(),
        A1,
        'phases',
        { projectId: undefined },
        makePhase('ph1', A1, 'p1'),
      ),
    ).toThrow('Phase must reference a project in this company.');
  });

  it('rejects a project whose client id is ABSENT even though ANOTHER client belongs to the account', () => {
    // The in-company check must match the referenced id, not merely "does any row belong here": with a
    // valid A1 client present but a dangling reference, the FK is still unsatisfied and must throw.
    const data = { ...makeBaseData(), clients: [makeClient('c1', A1)] };
    expect(() => assertScopedRefs(data, A1, 'projects', { clientId: 'ghost' })).toThrow(
      'Project must reference a client in this company.',
    );
  });
  it('validates a phase’s projectId FK (throws cross-account, passes in-account)', () => {
    const cross = {
      ...makeBaseData(),
      clients: [makeClient('c1', A2)],
      projects: [project('p1', A2, 'c1')],
    };
    expect(() => assertScopedRefs(cross, A1, 'phases', { projectId: 'p1' })).toThrow(
      'Phase must reference a project in this company.',
    );
    const ok = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1')],
    };
    expect(() => assertScopedRefs(ok, A1, 'phases', { projectId: 'p1' })).not.toThrow();
  });

  it('validates an activity’s projectId FK with its OWN message when a dangling project is referenced', () => {
    const data = { ...makeBaseData(), clients: [makeClient('c1', A1)] };
    expect(() => assertScopedRefs(data, A1, 'activities', { projectId: 'ghost' })).toThrow(
      'Activity must reference a project in this company.',
    );
  });

  it('rejects an activity whose phase id is ABSENT even though ANOTHER phase belongs to the account', () => {
    // The phase lookup must match the referenced id, not "any company phase": a dangling phaseId must
    // fail with the belong-to-company message even when a real phase exists in the company.
    const data = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1')],
      phases: [makePhase('ph1', A1, 'p1')],
    };
    expect(() =>
      assertScopedRefs(data, A1, 'activities', {
        projectId: 'p1',
        phaseId: 'ph-absent',
      }),
    ).toThrow('Activity phase must belong to this company.');
  });
  it('an UNRECOGNISED activity kind is not treated as internal/repeatable (no false project rejection)', () => {
    // assertScopedRefs checks refs + coherence for the known kinds only; it does not police the kind
    // enum itself (the write validator does). An unknown kind carrying a valid project must pass the ref checks.
    const data = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
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
    const data = { ...makeBaseData(), disciplines: [makeDiscipline('d1', A2)] };
    expect(() => assertScopedRefs(data, A1, 'resources', { disciplineId: 'd1' })).toThrow(
      'Resource discipline must belong to this company.',
    );
  });

  // The unchanged-on-update relaxation (5th arg `existing`): in server mode the client's hydrated
  // slice is active-only, so an unchanged parent id pointing at an archived parent (absent from
  // `data`) must not block an unrelated edit. A changed id is still validated strictly.
  describe('unchanged parent id on update (existing row passed)', () => {
    it('passes an UNCHANGED clientId even when the client is absent from data (archived parent)', () => {
      const existing = project('p1', A1, 'c-archived');
      // No clients at all. The archived parent was stripped from the slice.
      expect(() =>
        assertScopedRefs(
          makeBaseData(),
          A1,
          'projects',
          { name: 'Renamed', clientId: 'c-archived' },
          existing,
        ),
      ).not.toThrow();
    });
    it('rejects an unchanged legacy reference when the resolved parent belongs to another account', () => {
      const existing = project('p1', A1, 'cross-account-client');
      const data: AppData = {
        ...makeBaseData(),
        clients: [makeClient('cross-account-client', A2)],
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
    it('still rejects a CHANGED clientId that is absent from data', () => {
      const existing = project('p1', A1, 'c-archived');
      expect(() =>
        assertScopedRefs(makeBaseData(), A1, 'projects', { clientId: 'c-other' }, existing),
      ).toThrow('Project must reference a client in this company.');
    });
    it('passes an UNCHANGED projectId+phaseId pair even when both are absent from data', () => {
      const existing = makeActivity({
        id: 't1',
        companyId: A1,
        projectId: 'p-archived',
        phaseId: 'ph-archived',
      });
      const merged = { ...existing, name: 'Renamed' };
      expect(() =>
        assertScopedRefs(makeBaseData(), A1, 'activities', merged, existing),
      ).not.toThrow();
    });
    it('rejects an unchanged phaseId when the resolved legacy phase belongs to another account', () => {
      const existing = makeActivity({
        id: 't1',
        companyId: A1,
        projectId: 'p1',
        phaseId: 'cross-account-phase',
      });
      const data: AppData = {
        ...makeBaseData(),
        projects: [project('p1', A1, 'c1')],
        phases: [makePhase('cross-account-phase', A2, 'p2')],
        activities: [existing],
      };

      expect(() =>
        assertScopedRefs(
          data,
          A1,
          'activities',
          { ...existing, name: 'Unrelated rename' },
          existing,
        ),
      ).toThrow('Activity phase must belong to this company.');
    });
    it('re-runs the full phase coherence check when the phaseId CHANGES', () => {
      const data = {
        ...makeBaseData(),
        clients: [makeClient('c1', A1)],
        projects: [project('p1', A1, 'c1')],
      };
      const existing = makeActivity({
        id: 't1',
        companyId: A1,
        projectId: 'p1',
        phaseId: 'ph-old',
      });
      const merged = { ...existing, phaseId: 'ph-new' };
      expect(() => assertScopedRefs(data, A1, 'activities', merged, existing)).toThrow(
        'Activity phase must belong to this company.',
      );
    });
    it('passes an UNCHANGED placeholder projectId even when the project is absent from data', () => {
      const existing = makePlaceholder('r1', A1, 'p-archived');
      expect(() =>
        assertScopedRefs(
          makeBaseData(),
          A1,
          'resources',
          { name: 'Renamed', projectId: 'p-archived' },
          existing,
        ),
      ).not.toThrow();
    });
    it('without `existing` (an ADD) the check stays strict', () => {
      expect(() =>
        assertScopedRefs(makeBaseData(), A1, 'projects', { clientId: 'c-archived' }),
      ).toThrow('Project must reference a client in this company.');
    });
  });
});

describe('assertAllocationRefs', () => {
  const world = (): AppData => ({
    ...makeBaseData(),
    clients: [makeClient('c1', A1)],
    projects: [project('p1', A1, 'c1')],
    activities: [makeActivity({ id: 't1', companyId: A1, projectId: 'p1' })],
    resources: [makePerson('r1', A1)],
  });
  it('passes for a real resource + activity in the account', () => {
    expect(() => assertAllocationRefs(world(), A1, 'r1', 't1', 8)).not.toThrow();
  });

  it('throws when the resource or activity is missing / cross-account', () => {
    expect(() => assertAllocationRefs(world(), A1, 'missing', 't1', 8)).toThrow(
      'Allocation must reference an existing resource and activity in this company.',
    );
  });
  it('rejects new allocations to archived resources and archived projects', () => {
    const archivedResource: AppData = {
      ...world(),
      resources: [{ ...makePerson('r1', A1), archivedAt: TS }],
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
        clients: [{ ...makeClient('c1', A1), ...lifecycle }],
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
  it('rejects a project-bound activity whose project is missing or belongs to another account', () => {
    const missingProject = { ...world(), projects: [] };
    expect(() => assertAllocationRefs(missingProject, A1, 'r1', 't1', 8)).toThrow(
      'Allocation must reference an activity under an active project in this company.',
    );

    const crossCompanyProject = {
      ...world(),
      projects: [project('p1', A2, 'c1')],
    };
    expect(() => assertAllocationRefs(crossCompanyProject, A1, 'r1', 't1', 8)).toThrow(
      'Allocation must reference an activity under an active project in this company.',
    );
  });

  it('allows unchanged archived references but rejects switching an existing allocation to them', () => {
    const data: AppData = {
      ...world(),
      projects: [project('p1', A1, 'c1'), { ...project('p2', A1, 'c1'), archivedAt: TS }],
      activities: [
        makeActivity({ id: 't1', companyId: A1, projectId: 'p1' }),
        makeActivity({ id: 't2', companyId: A1, projectId: 'p2' }),
      ],
      resources: [makePerson('r1', A1), { ...makePerson('r2', A1), archivedAt: TS }],
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
  it('throws when a placeholder is assigned outside its bound project', () => {
    const data: AppData = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      activities: [makeActivity({ id: 't2', companyId: A1, projectId: 'p2' })],
      resources: [makePlaceholder('ph', A1, 'p1')],
    };
    expect(() => assertAllocationRefs(data, A1, 'ph', 't2', 8)).toThrow(
      'A placeholder can only be assigned to activities from its bound project.',
    );
  });

  it('rejects a non-zero load on an external / 3rd-party resource (no capacity)', () => {
    const data: AppData = { ...world(), resources: [makeExternal('ext', A1)] };
    expect(() => assertAllocationRefs(data, A1, 'ext', 't1', 8)).toThrow('can’t carry hours');
  });

  it('allows a zero load on an external resource (the external rule is always enforced)', () => {
    const data: AppData = { ...world(), resources: [makeExternal('ext', A1)] };
    expect(() => assertAllocationRefs(data, A1, 'ext', 't1', 0)).not.toThrow();
  });

  it('allows a non-zero load on a normal resource', () => {
    expect(() => assertAllocationRefs(world(), A1, 'r1', 't1', 8)).not.toThrow();
  });
  it('enforces repeatable-only attribution, project ownership/liveness and placeholder scope', () => {
    const repeatable: Activity = {
      ...makeActivity({ id: 'repeatable', companyId: A1, projectId: 'p1' }),
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
        makePerson('r1', A1),
        makePlaceholder('bound', A1, 'p1'),
        makePlaceholder('unbound', A1, undefined),
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
      ...makeActivity({ id: 'repeatable', companyId: A1, projectId: 'p1' }),
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
});
