import { describe, expect, it } from 'vitest';
import { addDaysISO } from '../../lib/dateMath.js';
import { MAX_SPAN_DAYS } from '../../lib/schedulingDays.js';
import { createEmptyAppData } from '../../types/entities.js';
import type { Activity, AppData, ID, Resource } from '../../types/entities.js';
import type { DomainErrorCode } from '../errors.js';
import {
  assertActivityProjectAllowsDependents,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
} from './dependents.js';
import {
  A1,
  A2,
  TS,
  captureFailure,
  makeActivity,
  makeAllocation,
  makeClient,
  makeCompany,
  makePerson,
  makePlaceholder,
  makeProject,
  makeTimeOff,
} from './assertionTestKit.js';
import type { Failure } from './assertionTestKit.js';

// Each row pins the code a rule refuses with and the English message the wire carries, plus the
// guards that decide whether a dependents check runs at all, which the UI and server both branch on.

/** Three active projects and one project activity t1 on p1; each row adds its own dependents. */
function makeData(overrides: Partial<AppData> = {}): AppData {
  return {
    ...createEmptyAppData(),
    companies: [makeCompany(A1, 'Wayne Enterprises'), makeCompany(A2, 'Stark Industries')],
    clients: [makeClient('c1')],
    projects: [makeProject('p1'), makeProject('p2'), makeProject('p3')],
    activities: [makeActivity('t1')],
    ...overrides,
  };
}

const pass = undefined;
const refusal = (code: DomainErrorCode, message: string): Failure => ({ code, message });

const dateRequired = refusal('E_DATE_REQUIRED', 'Start and end dates are required.');
const dateReversed = refusal('E_DATE_REVERSED', 'End date cannot be before the start date.');
const dateSpan = refusal('E_DATE_SPAN_TOO_LONG', 'Date span cannot exceed 36,500 calendar days.');
const resourceInvalid = refusal(
  'E_TIME_OFF_RESOURCE_INVALID',
  'Time off must reference an existing resource in this company.',
);
const resourceInactive = refusal(
  'E_TIME_OFF_RESOURCE_INACTIVE',
  'Time off must reference an active resource in this company.',
);
const externalTimeOff = refusal(
  'E_TIME_OFF_EXTERNAL_RESOURCE',
  'Time off can’t be recorded for an external party.',
);
const externalDependents = refusal(
  'E_RESOURCE_EXTERNAL_DEPENDENTS',
  'Reassign or remove this resource’s work and time off before making it external.',
);
const placeholderDependents = refusal(
  'E_PLACEHOLDER_PROJECT_DEPENDENTS',
  'Reassign or remove this placeholder’s work before changing its bound project.',
);
const activityDependents = refusal(
  'E_ACTIVITY_PROJECT_DEPENDENTS',
  'Reassign placeholder work before changing this activity’s project.',
);

const work = (resourceId: ID, activityId: ID, hoursPerDay = 8) =>
  makeAllocation(`al-${resourceId}-${activityId}`, { resourceId, activityId, hoursPerDay });
const allProjectsActivity = (id: ID): Activity =>
  makeActivity(id, { name: 'Shared', kind: 'allProjects', projectId: null });

describe('assertDateRange', () => {
  const start = '2026-01-01';
  it.each([
    ['passes for a forward range', pass, start, '2026-01-05'],
    ['refuses a reversed range', dateReversed, '2026-01-05', start],
    ['refuses a missing end', dateRequired, start, undefined],
    ['passes at the calendar-span bound', pass, start, addDaysISO(start, MAX_SPAN_DAYS - 1)],
    [
      'refuses a range past the calendar-span bound',
      dateSpan,
      start,
      addDaysISO(start, MAX_SPAN_DAYS),
    ],
  ])('%s', (_title, expected, startDate, endDate) => {
    expect(captureFailure(() => assertDateRange(startDate, endDate))).toEqual(expected);
  });
});

describe('assertResourceExists', () => {
  const archived = makeData({ resources: [makePerson('r1', { archivedAt: TS })] });
  it.each([
    ['passes for an active person', pass, makeData({ resources: [makePerson('r1')] })],
    ['refuses a missing resource', resourceInvalid, makeData()],
    [
      'refuses a resource in another company',
      resourceInvalid,
      makeData({ resources: [makePerson('r1', { companyId: A2 })] }),
    ],
    ['refuses a new reference to an archived resource', resourceInactive, archived],
    ['passes an unchanged archived reference', pass, archived, { resourceId: 'r1' }],
    [
      'refuses switching to an archived resource',
      resourceInactive,
      archived,
      { resourceId: 'other' },
    ],
    [
      'refuses a placeholder hidden by an archived project',
      resourceInactive,
      makeData({
        projects: [makeProject('p1', { archivedAt: TS })],
        resources: [makePlaceholder('r1', 'p1')],
      }),
    ],
    [
      'refuses an external party',
      externalTimeOff,
      makeData({ resources: [makePerson('r1', { kind: 'external' })] }),
    ],
  ] as const)('%s', (_title, expected, data, existing?: { resourceId: ID }) => {
    expect(
      captureFailure(() =>
        assertResourceExists({ data, companyId: A1, resourceId: 'r1', existing }),
      ),
    ).toEqual(expected);
  });
});

describe('assertResourceKindAllowsDependents', () => {
  const person = makePerson('r1');
  const loaded = makeData({ resources: [person], allocations: [work('r1', 't1')] });
  const loadedAndAway = makeData({
    resources: [person],
    allocations: [work('r1', 't1')],
    timeOff: [makeTimeOff('to1', 'r1')],
  });
  it.each([
    ['refuses a loaded allocation', externalDependents, loaded, 'external'],
    [
      'refuses any time off',
      externalDependents,
      makeData({ resources: [person], timeOff: [makeTimeOff('to1', 'r1')] }),
      'external',
    ],
    [
      'passes a zero-load allocation',
      pass,
      makeData({ resources: [person], allocations: [work('r1', 't1', 0)] }),
      'external',
    ],
    ['passes no dependents', pass, makeData({ resources: [person] }), 'external'],
    [
      'ignores company closures',
      pass,
      makeData({
        resources: [person],
        closures: [
          {
            id: 'closure',
            companyId: A1,
            createdAt: TS,
            updatedAt: TS,
            name: 'Company shutdown',
            startDate: '2026-01-01',
            endDate: '2026-01-03',
          },
        ],
      }),
      'external',
    ],
    [
      'ignores another resource’s and another company’s dependents',
      pass,
      makeData({
        resources: [person, makePerson('other')],
        allocations: [work('other', 't1'), { ...work('r1', 't1'), companyId: A2 }],
        timeOff: [makeTimeOff('to1', 'r1', { companyId: A2 })],
      }),
      'external',
    ],
    ['passes a loaded allocation when the target kind is placeholder', pass, loaded, 'placeholder'],
    ['passes any dependents when the target kind is person', pass, loadedAndAway, 'person'],
    [
      'passes any dependents when the target kind is placeholder',
      pass,
      loadedAndAway,
      'placeholder',
    ],
  ] as const)('%s', (_title, expected, data, mergedKind) => {
    expect(
      captureFailure(() =>
        assertResourceKindAllowsDependents({ data, companyId: A1, resourceId: 'r1', mergedKind }),
      ),
    ).toEqual(expected);
  });
});

type EditRow<T> = [
  title: string,
  expected: Failure | undefined,
  data: AppData,
  edit: { id: ID; merged: T; existing?: T },
];

describe('assertResourceProjectAllowsDependents', () => {
  const p1Placeholder = makePlaceholder('r1', 'p1');
  const p2Placeholder = makePlaceholder('r1', 'p2');
  const bound = makeData({ resources: [p1Placeholder], allocations: [work('r1', 't1')] });
  const misbound = makeData({ resources: [p2Placeholder], allocations: [work('r1', 't1')] });
  const personWithWork = makeData({
    resources: [makePerson('r1')],
    allocations: [work('r1', 't1')],
  });
  const rows: EditRow<Resource>[] = [
    [
      'refuses a rebind that newly invalidates work',
      placeholderDependents,
      bound,
      { id: 'r1', merged: p2Placeholder, existing: p1Placeholder },
    ],
    [
      'treats an omitted existing row as previously valid',
      placeholderDependents,
      bound,
      { id: 'r1', merged: p2Placeholder },
    ],
    [
      'skips the check when neither kind nor project changed',
      pass,
      bound,
      { id: 'r1', merged: p1Placeholder, existing: p1Placeholder },
    ],
    [
      'runs the check for a kind change to an unbound placeholder',
      placeholderDependents,
      personWithWork,
      { id: 'r1', merged: makePlaceholder('r1', null), existing: makePerson('r1') },
    ],
    [
      'refuses converting a person with work into a placeholder bound elsewhere',
      placeholderDependents,
      personWithWork,
      { id: 'r1', merged: p2Placeholder, existing: makePerson('r1') },
    ],
    [
      'tolerates work that was already invalid',
      pass,
      misbound,
      { id: 'r1', merged: makePlaceholder('r1', 'p3'), existing: p2Placeholder },
    ],
    [
      'accepts an edit that repairs invalid work',
      pass,
      misbound,
      { id: 'r1', merged: p1Placeholder, existing: p2Placeholder },
    ],
    [
      'does not make an unrelated edit the repair boundary',
      pass,
      misbound,
      { id: 'r1', merged: p2Placeholder, existing: p2Placeholder },
    ],
    [
      'skips an allocation whose activity no longer resolves',
      pass,
      makeData({ resources: [p1Placeholder], allocations: [work('r1', 'ghost')] }),
      { id: 'r1', merged: p2Placeholder, existing: p1Placeholder },
    ],
    [
      'allows a rebind when the placeholder only owns project-less work',
      pass,
      makeData({
        resources: [p1Placeholder],
        activities: [allProjectsActivity('shared')],
        allocations: [work('r1', 'shared')],
      }),
      { id: 'r1', merged: p2Placeholder, existing: p1Placeholder },
    ],
    [
      'refuses a rebind with all-projects work attributed to the bound project',
      placeholderDependents,
      makeData({
        resources: [p1Placeholder],
        activities: [allProjectsActivity('shared')],
        allocations: [{ ...work('r1', 'shared'), projectId: 'p1' }],
      }),
      { id: 'r1', merged: p2Placeholder, existing: p1Placeholder },
    ],
  ];
  it.each(rows)('%s', (_title, expected, data, { id, merged, existing }) => {
    expect(
      captureFailure(() =>
        assertResourceProjectAllowsDependents({
          data,
          companyId: A1,
          resourceId: id,
          merged,
          existing,
        }),
      ),
    ).toEqual(expected);
  });
});

describe('assertActivityProjectAllowsDependents', () => {
  const onP1 = makeActivity('t1');
  const onP2 = makeActivity('t1', { projectId: 'p2' });
  const bound = makeData({
    resources: [makePlaceholder('r1', 'p1')],
    allocations: [work('r1', 't1')],
  });
  const shared = allProjectsActivity('shared');
  const sharedAttributed = makeData({
    resources: [makePlaceholder('r1', 'p1')],
    activities: [shared],
    allocations: [{ ...work('r1', 'shared'), projectId: 'p1' }],
  });
  const peopleOnly = makeActivity('project-work');
  const placeholderOnly = makeActivity('placeholder-work');
  const mixed = makeData({
    resources: [makePerson('person'), makePlaceholder('r1', 'p1')],
    activities: [peopleOnly, placeholderOnly],
    allocations: [work('person', 'project-work'), work('r1', 'placeholder-work')],
  });
  const misassigned = makeData({
    activities: [onP2],
    resources: [makePlaceholder('r1', 'p1')],
    allocations: [work('r1', 't1')],
  });
  const rows: EditRow<Activity>[] = [
    [
      'refuses moving work a placeholder owns',
      activityDependents,
      bound,
      { id: 't1', merged: onP2, existing: onP1 },
    ],
    [
      'treats an omitted existing row as previously valid',
      activityDependents,
      bound,
      { id: 't1', merged: onP2 },
    ],
    ['skips an unchanged edit', pass, bound, { id: 't1', merged: onP1, existing: onP1 }],
    [
      'tolerates work that was already invalid',
      pass,
      misassigned,
      { id: 't1', merged: makeActivity('t1', { projectId: 'p3' }), existing: onP2 },
    ],
    [
      'does not make an unrelated edit the repair boundary',
      pass,
      makeData({ resources: [makePlaceholder('r1', 'p2')], allocations: [work('r1', 't1')] }),
      { id: 't1', merged: onP1, existing: onP1 },
    ],
    [
      'skips an unchanged edit even when a legacy attribution would be stripped',
      pass,
      makeData({
        resources: [makePlaceholder('r1', 'p2')],
        allocations: [{ ...work('r1', 't1'), projectId: 'p2' }],
      }),
      { id: 't1', merged: onP1, existing: onP1 },
    ],
    [
      'skips an allocation whose resource no longer resolves',
      pass,
      makeData({ allocations: [work('ghost', 't1')] }),
      { id: 't1', merged: onP2, existing: onP1 },
    ],
    [
      'validates the post-clear project when all-projects work becomes project work',
      activityDependents,
      sharedAttributed,
      { id: 'shared', merged: { ...shared, kind: 'project', projectId: 'p2' }, existing: shared },
    ],
    [
      'allows all-projects work to become internal',
      pass,
      sharedAttributed,
      { id: 'shared', merged: { ...shared, kind: 'internal' }, existing: shared },
    ],
    [
      'allows moving work owned only by people',
      pass,
      mixed,
      { id: 'project-work', merged: { ...peopleOnly, projectId: 'p2' }, existing: peopleOnly },
    ],
    [
      'allows making placeholder work project-less',
      pass,
      mixed,
      {
        id: 'placeholder-work',
        merged: { ...placeholderOnly, kind: 'allProjects', projectId: null },
        existing: placeholderOnly,
      },
    ],
  ];
  it.each(rows)('%s', (_title, expected, data, { id, merged, existing }) => {
    expect(
      captureFailure(() =>
        assertActivityProjectAllowsDependents({
          data,
          companyId: A1,
          activityId: id,
          merged,
          existing,
        }),
      ),
    ).toEqual(expected);
  });
});
