import { NULLABLE_FIELDS } from '../../types/nullableFields.js';
import { describe, it, expect } from 'vitest';
import { addDaysISO } from '../../lib/dateMath.js';
import { MAX_SPAN_DAYS } from '../../lib/schedulingDays.js';
import type { Activity, AppData } from '../../types/entities.js';
import {
  assertActivityProjectAllowsDependents,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
} from './dependents.js';
import {
  TS,
  makeMeta,
  makeClient,
  project,
  makeActivity,
  makePerson,
  makePlaceholder,
  makeExternal,
  allocation,
  timeOff,
  A1,
  A2,
  makeBaseData,
} from './assertionMessagesTestKit.js';

// These specs check each rule's rejection message without the store or React. The server uses
// the same module, so these assertions pin the validation rules for both callers.

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
    const data = { ...makeBaseData(), resources: [makePerson('r1', A1)] };
    expect(() => assertResourceExists({ data, companyId: A1, resourceId: 'r1' })).not.toThrow();
  });
  it('throws for a missing / cross-account resource', () => {
    const data = { ...makeBaseData(), resources: [makePerson('r1', A2)] };
    expect(() => assertResourceExists({ data, companyId: A1, resourceId: 'r1' })).toThrow(
      'Time off must reference an existing resource in this company.',
    );
  });
  it('rejects a new reference to an archived resource but permits an unchanged archived reference', () => {
    const data = {
      ...makeBaseData(),
      resources: [{ ...makePerson('r1', A1), archivedAt: TS }],
    };
    expect(() => assertResourceExists({ data, companyId: A1, resourceId: 'r1' })).toThrow(
      'Time off must reference an active resource in this company.',
    );
    expect(() =>
      assertResourceExists({
        data,
        companyId: A1,
        resourceId: 'r1',
        existing: { resourceId: 'r1' },
      }),
    ).not.toThrow();
    expect(() =>
      assertResourceExists({
        data,
        companyId: A1,
        resourceId: 'r1',
        existing: { resourceId: 'other' },
      }),
    ).toThrow('Time off must reference an active resource in this company.');
  });
  it('rejects a resource hidden by an inactive project ancestor', () => {
    const data = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [{ ...project('p1', A1, 'c1'), archivedAt: TS }],
      resources: [{ ...makePerson('r1', A1), kind: 'placeholder' as const, projectId: 'p1' }],
    };
    expect(() => assertResourceExists({ data, companyId: A1, resourceId: 'r1' })).toThrow(
      'Time off must reference an active resource in this company.',
    );
  });
  it('throws for an external party (no capacity → no time off)', () => {
    const data = { ...makeBaseData(), resources: [makeExternal('ext', A1)] };
    expect(() => assertResourceExists({ data, companyId: A1, resourceId: 'ext' })).toThrow(
      'Time off can’t be recorded for an external party.',
    );
  });
});

describe('assertResourceKindAllowsDependents', () => {
  const reject = /reassign or remove this resource’s work and time off/i;

  it('is a no-op when the merged kind is not external', () => {
    const data: AppData = {
      ...makeBaseData(),
      resources: [makePerson('r1', A1)],
      activities: [makeActivity({ id: 't1', companyId: A1, projectId: 'p1' })],
      allocations: [
        allocation({
          id: 'al',
          companyId: A1,
          resourceId: 'r1',
          activityId: 't1',
          overrides: { hoursPerDay: 8 },
        }),
      ],
      timeOff: [timeOff({ id: 'to', companyId: A1, resourceId: 'r1' })],
    };
    expect(() =>
      assertResourceKindAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'r1',
        mergedKind: 'person',
      }),
    ).not.toThrow();
    expect(() =>
      assertResourceKindAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'r1',
        mergedKind: 'placeholder',
      }),
    ).not.toThrow();
  });

  it('rejects making external a resource that still owns a loaded allocation', () => {
    const data: AppData = {
      ...makeBaseData(),
      resources: [makePerson('r1', A1)],
      allocations: [
        allocation({
          id: 'al',
          companyId: A1,
          resourceId: 'r1',
          activityId: 't1',
          overrides: { hoursPerDay: 8 },
        }),
      ],
    };
    expect(() =>
      assertResourceKindAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'r1',
        mergedKind: 'external',
      }),
    ).toThrow(reject);
  });

  it('rejects making external a resource that still owns time off', () => {
    const data: AppData = {
      ...makeBaseData(),
      resources: [makePerson('r1', A1)],
      timeOff: [timeOff({ id: 'to', companyId: A1, resourceId: 'r1' })],
    };
    expect(() =>
      assertResourceKindAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'r1',
        mergedKind: 'external',
      }),
    ).toThrow(reject);
  });
  it('ignores company closures when making a resource external', () => {
    const data: AppData = {
      ...makeBaseData(),
      resources: [makePerson('r1', A1)],
      closures: [
        {
          ...makeMeta('closure', A1),
          name: 'Company shutdown',
          startDate: '2026-01-01',
          endDate: '2026-01-03',
        },
      ],
    };
    expect(() =>
      assertResourceKindAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'r1',
        mergedKind: 'external',
      }),
    ).not.toThrow();
  });

  it('allows making external a resource whose only allocation carries a zero load (already valid for an external)', () => {
    const data: AppData = {
      ...makeBaseData(),
      resources: [makePerson('r1', A1)],
      allocations: [
        allocation({
          id: 'al',
          companyId: A1,
          resourceId: 'r1',
          activityId: 't1',
          overrides: { hoursPerDay: 0 },
        }),
      ],
    };
    expect(() =>
      assertResourceKindAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'r1',
        mergedKind: 'external',
      }),
    ).not.toThrow();
  });

  it('allows making external a resource with no dependents', () => {
    const data: AppData = { ...makeBaseData(), resources: [makePerson('r1', A1)] };
    expect(() =>
      assertResourceKindAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'r1',
        mergedKind: 'external',
      }),
    ).not.toThrow();
  });

  it('only considers THIS resource’s dependents in THIS account', () => {
    // Another resource's loaded allocation + a same-id dependent in a different account must not block.
    const data: AppData = {
      ...makeBaseData(),
      resources: [makePerson('r1', A1), makePerson('other', A1)],
      allocations: [
        allocation({
          id: 'al',
          companyId: A1,
          resourceId: 'other',
          activityId: 't1',
          overrides: { hoursPerDay: 8 },
        }),
        allocation({
          id: 'al2',
          companyId: A2,
          resourceId: 'r1',
          activityId: 't1',
          overrides: { hoursPerDay: 8 },
        }),
      ],
      timeOff: [timeOff({ id: 'to', companyId: A2, resourceId: 'r1' })],
    };
    expect(() =>
      assertResourceKindAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'r1',
        mergedKind: 'external',
      }),
    ).not.toThrow();
  });
});

describe('parent project edits preserve placeholder allocation assignments', () => {
  const rejectResource =
    /reassign or remove this placeholder’s work before changing its bound project/i;
  const rejectActivity = /reassign placeholder work before changing this activity’s project/i;
  it('rejects rebinding a placeholder while it owns work under its previous project', () => {
    const existing = makePlaceholder('ph', A1, 'p1');
    const data: AppData = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      resources: [existing],
      activities: [makeActivity({ id: 't1', companyId: A1, projectId: 'p1' })],
      allocations: [allocation({ id: 'al', companyId: A1, resourceId: 'ph', activityId: 't1' })],
    };

    expect(() =>
      assertResourceProjectAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'ph',
        merged: { ...existing, projectId: 'p2' },
        existing,
      }),
    ).toThrow(rejectResource);
  });

  it('allows a rebind when the placeholder only owns project-less work', () => {
    const existing = makePlaceholder('ph', A1, 'p1');
    const data: AppData = {
      ...makeBaseData(),
      resources: [existing],
      activities: [
        {
          ...NULLABLE_FIELDS.activities,
          ...makeMeta('general', A1),
          name: 'Admin',
          kind: 'repeatable',
        },
      ],
      allocations: [
        allocation({ id: 'al', companyId: A1, resourceId: 'ph', activityId: 'general' }),
      ],
    };

    expect(() =>
      assertResourceProjectAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'ph',
        merged: { ...existing, projectId: 'p2' },
        existing,
      }),
    ).not.toThrow();
  });
  it('rejects rebinding a placeholder with repeatable work attributed to its bound project', () => {
    const existing = makePlaceholder('ph', A1, 'p1');
    const repeatable: Activity = {
      ...NULLABLE_FIELDS.activities,
      ...makeMeta('shared', A1),
      name: 'Shared',
      kind: 'repeatable',
    };
    const data: AppData = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      resources: [existing],
      activities: [repeatable],
      allocations: [
        allocation({
          id: 'al',
          companyId: A1,
          resourceId: 'ph',
          activityId: 'shared',
          overrides: { projectId: 'p1' },
        }),
      ],
    };

    expect(() =>
      assertResourceProjectAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'ph',
        merged: { ...existing, projectId: 'p2' },
        existing,
      }),
    ).toThrow(rejectResource);
  });

  it('validates the post-clear effective project when repeatable work becomes project-specific', () => {
    const existing: Activity = {
      ...NULLABLE_FIELDS.activities,
      ...makeMeta('shared', A1),
      name: 'Shared',
      kind: 'repeatable',
    };
    const data: AppData = {
      ...makeBaseData(),
      clients: [makeClient('c1', A1)],
      projects: [project('p1', A1, 'c1'), project('p2', A1, 'c1')],
      resources: [makePlaceholder('ph', A1, 'p1')],
      activities: [existing],
      allocations: [
        allocation({
          id: 'al',
          companyId: A1,
          resourceId: 'ph',
          activityId: 'shared',
          overrides: { projectId: 'p1' },
        }),
      ],
    };

    expect(() =>
      assertActivityProjectAllowsDependents({
        data,
        companyId: A1,
        activityId: 'shared',
        merged: { ...existing, kind: 'project', projectId: 'p2' },
        existing,
      }),
    ).toThrow(rejectActivity);
    expect(() =>
      assertActivityProjectAllowsDependents({
        data,
        companyId: A1,
        activityId: 'shared',
        merged: { ...existing, kind: 'internal' },
        existing,
      }),
    ).not.toThrow();
  });
  it('rejects converting a person with all-projects work into a bound placeholder', () => {
    const existing = makePerson('r1', A1);
    const data: AppData = {
      ...makeBaseData(),
      resources: [existing],
      activities: [makeActivity({ id: 't1', companyId: A1, projectId: 'p1' })],
      allocations: [allocation({ id: 'al', companyId: A1, resourceId: 'r1', activityId: 't1' })],
    };

    expect(() =>
      assertResourceProjectAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'r1',
        merged: { ...existing, kind: 'placeholder', projectId: 'p2' },
        existing,
      }),
    ).toThrow(rejectResource);
  });

  it('rejects moving an activity while a placeholder bound to its previous project owns it', () => {
    const existing = makeActivity({ id: 't1', companyId: A1, projectId: 'p1' });
    const data: AppData = {
      ...makeBaseData(),
      resources: [makePlaceholder('ph', A1, 'p1')],
      activities: [existing],
      allocations: [allocation({ id: 'al', companyId: A1, resourceId: 'ph', activityId: 't1' })],
    };

    expect(() =>
      assertActivityProjectAllowsDependents({
        data,
        companyId: A1,
        activityId: 't1',
        merged: { ...existing, projectId: 'p2' },
        existing,
      }),
    ).toThrow(rejectActivity);
  });
  it('allows moving an activity owned only by people and allows making placeholder work project-less', () => {
    const projectActivity = makeActivity({ id: 'project-work', companyId: A1, projectId: 'p1' });
    const placeholderActivity = makeActivity({
      id: 'placeholder-work',
      companyId: A1,
      projectId: 'p1',
    });
    const data: AppData = {
      ...makeBaseData(),
      resources: [makePerson('person', A1), makePlaceholder('ph', A1, 'p1')],
      activities: [projectActivity, placeholderActivity],
      allocations: [
        allocation({
          id: 'person-al',
          companyId: A1,
          resourceId: 'person',
          activityId: 'project-work',
        }),
        allocation({
          id: 'placeholder-al',
          companyId: A1,
          resourceId: 'ph',
          activityId: 'placeholder-work',
        }),
      ],
    };

    expect(() =>
      assertActivityProjectAllowsDependents({
        data,
        companyId: A1,
        activityId: 'project-work',
        merged: { ...projectActivity, projectId: 'p2' },
        existing: projectActivity,
      }),
    ).not.toThrow();
    expect(() =>
      assertActivityProjectAllowsDependents({
        data,
        companyId: A1,
        activityId: 'placeholder-work',
        merged: (() => {
          const changed = { ...placeholderActivity, kind: 'repeatable' as const };
          changed.projectId = null;
          return changed;
        })(),
        existing: placeholderActivity,
      }),
    ).not.toThrow();
  });
  it('does not make an unrelated edit the repair boundary for already-corrupt assignments', () => {
    const resource = makePlaceholder('ph', A1, 'p2');
    const activityRow = makeActivity({ id: 't1', companyId: A1, projectId: 'p1' });
    const data: AppData = {
      ...makeBaseData(),
      resources: [resource],
      activities: [activityRow],
      allocations: [allocation({ id: 'al', companyId: A1, resourceId: 'ph', activityId: 't1' })],
    };

    expect(() =>
      assertResourceProjectAllowsDependents({
        data,
        companyId: A1,
        resourceId: 'ph',
        merged: resource,
        existing: resource,
      }),
    ).not.toThrow();
    expect(() =>
      assertActivityProjectAllowsDependents({
        data,
        companyId: A1,
        activityId: 't1',
        merged: activityRow,
        existing: activityRow,
      }),
    ).not.toThrow();
  });
});
