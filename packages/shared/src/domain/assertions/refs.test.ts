import { describe, expect, it } from 'vitest'
import { createEmptyAppData } from '../../types/entities.js'
import type { AppData, ID, ScopedEntity, ScopedEntityKey } from '../../types/entities.js'
import type { DomainErrorCode } from '../errors.js'
import { assertAllocationRefs, assertScopedRefs, getOwned } from './refs.js'
import {
  A1,
  A2,
  TS,
  captureFailure,
  makeActivity,
  makeClient,
  makeCompany,
  makeDiscipline,
  makePerson,
  makePhase,
  makePlaceholder,
  makeProject,
} from './assertionTestKit.js'
import type { Failure } from './assertionTestKit.js'

// Each row pins the code a rule refuses with and the English message the wire carries. The
// server and the client share this module, so the rows pin the rules for both callers.

/** One company with active, archived, hidden and corrupt rows of each referenced kind, plus a
 * second company whose rows must never be referenced. */
function makeWorld(): AppData {
  return {
    ...createEmptyAppData(),
    companies: [makeCompany(A1, 'Wayne Enterprises'), makeCompany(A2, 'Stark Industries')],
    clients: [
      makeClient('c1'),
      makeClient('c-archived', { archivedAt: TS }),
      makeClient('c-loft', { companyId: A2, name: 'Avengers Tower' }),
    ],
    projects: [
      makeProject('p1'),
      makeProject('p2'),
      makeProject('p-archived', { archivedAt: TS }),
      makeProject('p-loft', { clientId: 'c-loft', companyId: A2 }),
      // Active itself, but hidden by its archived client.
      makeProject('p-hidden', { clientId: 'c-archived' }),
    ],
    phases: [
      makePhase('ph1', 'p1'),
      makePhase('ph-loft', 'p-loft', { companyId: A2 }),
      makePhase('ph-hidden', 'p-hidden'),
    ],
    disciplines: [makeDiscipline('d-loft', { companyId: A2 })],
    activities: [
      makeActivity('t1'),
      makeActivity('t2', { projectId: 'p2' }),
      makeActivity('t-all', { kind: 'allProjects', projectId: null }),
      makeActivity('t-archived', { archivedAt: TS }),
      makeActivity('t-loft', { projectId: 'p-loft', companyId: A2 }),
      makeActivity('t-hidden', { projectId: 'p-hidden' }),
      makeActivity('t-in-archived', { projectId: 'p-archived' }),
      // Corrupt rows: one project is gone, the other is in the other company.
      makeActivity('t-orphan', { projectId: 'p-missing' }),
      makeActivity('t-foreign', { projectId: 'p-loft' }),
    ],
    resources: [
      makePerson('r1'),
      makePerson('r-archived', { archivedAt: TS }),
      makePlaceholder('ph-p1', 'p1'),
      makePerson('ph-unbound', { kind: 'placeholder', name: 'Batgirl' }),
      makePerson('ext1', { kind: 'external', name: 'Kord Industries' }),
      makePerson('r-loft', { name: 'Tony Stark', companyId: A2 }),
    ],
  }
}

const pass = undefined
const refusal = (code: DomainErrorCode, message: string): Failure => ({ code, message })
const wrongCompany = (message: string) => refusal('E_REFERENCE_WRONG_COMPANY', message)

const projectClient = wrongCompany('Project must reference a client in this company.')
const phaseProject = wrongCompany('Phase must reference a project in this company.')
const activityProject = wrongCompany('Activity must reference a project in this company.')
const discipline = wrongCompany('Resource discipline must belong to this company.')
const placeholderProject = wrongCompany('Placeholder project must belong to this company.')
const projectRequired = refusal(
  'E_ACTIVITY_PROJECT_REQUIRED',
  'A project-specific activity must be assigned to a project.'
)
const projectForbidden = refusal(
  'E_ACTIVITY_PROJECT_FORBIDDEN',
  'An internal or all-projects activity cannot belong to a project.'
)
const phaseForbidden = refusal(
  'E_ACTIVITY_PHASE_FORBIDDEN',
  'An internal or all-projects activity cannot belong to a phase.'
)
const phaseWrongCompany = refusal(
  'E_ACTIVITY_PHASE_WRONG_COMPANY',
  'Activity phase must belong to this company.'
)
const phaseNeedsProject = refusal(
  'E_ACTIVITY_PHASE_PROJECT_REQUIRED',
  'An activity with a phase must also belong to that phase’s project.'
)
const phaseMismatch = refusal(
  'E_ACTIVITY_PHASE_PROJECT_MISMATCH',
  'Activity phase must belong to the activity’s project.'
)
const avatarForbidden = refusal(
  'E_RESOURCE_AVATAR_URL_FORBIDDEN',
  'Only a person can have an avatar URL.'
)
const avatarInvalid = refusal(
  'E_RESOURCE_AVATAR_URL_INVALID',
  'Avatar URL must be a normalised HTTPS URL without credentials.'
)
const bindingForbidden = refusal(
  'E_RESOURCE_PROJECT_FORBIDDEN',
  'Only a placeholder can be assigned to a project.'
)
const kindChanged = refusal(
  'E_RESOURCE_KIND_IMMUTABLE',
  'A resource’s kind cannot change after creation.'
)
const kindCorrupt = refusal(
  'E_RESOURCE_KIND_IMMUTABLE',
  'The stored resource kind is invalid and must be repaired by import.'
)
const references = refusal(
  'E_ALLOCATION_REFERENCES_INVALID',
  'Allocation must reference an existing resource and activity in this company.'
)
const resourceInactive = refusal(
  'E_ALLOCATION_RESOURCE_INACTIVE',
  'Allocation must reference an active resource in this company.'
)
const activityInactive = refusal(
  'E_ALLOCATION_ACTIVITY_INACTIVE',
  'Allocation must reference an activity under an active project.'
)
const attributionForbidden = refusal(
  'E_ALLOCATION_PROJECT_FORBIDDEN',
  'Only an all-projects activity allocation can be attributed to a project.'
)
const projectInactive = refusal(
  'E_ALLOCATION_PROJECT_INACTIVE',
  'Allocation must reference an activity under an active project in this company.'
)
const placeholderMismatch = refusal(
  'E_PLACEHOLDER_PROJECT_MISMATCH',
  'A placeholder can only be assigned to activities from its bound project.'
)
const placeholderUnbound = refusal(
  'E_PLACEHOLDER_PROJECT_MISSING',
  'This placeholder is not bound to a project yet.'
)
const externalHours = refusal(
  'E_EXTERNAL_ALLOCATION_HOURS',
  'An external party’s allocation can’t carry hours.'
)

describe('getOwned', () => {
  it.each([
    ['returns the row when it belongs to the active company', 'c1', 'c1'],
    ['returns null for an absent id (stale-id no-op contract)', 'c-gone', null],
  ])('%s', (_title, id, expected) => {
    expect(getOwned(makeWorld(), A1, 'clients', id)?.id ?? null).toBe(expected)
  })

  it('refuses a row that belongs to another company', () => {
    expect(captureFailure(() => getOwned(makeWorld(), A1, 'clients', 'c-loft'))).toEqual(
      refusal('E_RECORD_WRONG_COMPANY', 'That record does not belong to the active company.')
    )
  })
})

type Stored = ScopedEntity | Record<string, unknown>
type ScopedRow = [
  title: string,
  expected: Failure | undefined,
  record: Record<string, unknown>,
  existing?: Stored,
  options?: { fullRow?: boolean },
]

/** Register one test per row, each calling assertScopedRefs on a fresh world. */
function itRefusesScoped(key: ScopedEntityKey, rows: ScopedRow[]): void {
  it.each(rows)('%s', (_title, expected, record, existing, options) => {
    expect(
      captureFailure(() => assertScopedRefs(makeWorld(), A1, key, record, existing, options))
    ).toEqual(expected)
  })
}

const storedProject = makeProject('p1')
const storedPhase = makePhase('ph1', 'p1')
const hiddenPhase = makePhase('ph-hidden', 'p-hidden')
const storedPerson = makePerson('r1')
const boundPerson = makePerson('r1', { projectId: 'p1' })
const boundPlaceholder = makePlaceholder('r1', 'p1')
const projectWithClient = (clientId: ID) => makeProject('p1', { clientId })
const activityWith = (fields: { projectId?: ID; phaseId: ID }) => makeActivity('t1', fields)
const avatar = 'https://images.example/bruce.png'

describe('assertScopedRefs projects', () => {
  itRefusesScoped('projects', [
    ['accepts an active in-company client', pass, { clientId: 'c1' }],
    ['rejects a non-string client id', projectClient, { clientId: 42 }],
    ['rejects a missing client', projectClient, { clientId: 'c-missing' }],
    ['rejects a client in another company', projectClient, { clientId: 'c-loft' }],
    ['rejects a new reference to an archived client', projectClient, { clientId: 'c-archived' }],
    ['requires the client on create', projectClient, {}],
    ['rejects a null client on create', projectClient, { clientId: null }],
    ['rejects an update clearing the client', projectClient, { clientId: null }, storedProject],
    ['lets a partial update omit the client', pass, { name: 'Renamed' }, storedProject],
    ['accepts a changed active client', pass, { clientId: 'c1' }, storedProject],
    ['rejects a changed archived client', projectClient, { clientId: 'c-archived' }, storedProject],
    [
      'rejects a changed client absent from the data',
      projectClient,
      { clientId: 'c-other' },
      projectWithClient('c-gone'),
    ],
    [
      'accepts an unchanged archived client',
      pass,
      { clientId: 'c-archived' },
      projectWithClient('c-archived'),
    ],
    [
      'accepts an unchanged client absent from the data',
      pass,
      { name: 'Renamed', clientId: 'c-gone' },
      projectWithClient('c-gone'),
    ],
    [
      'rejects an unchanged client in another company',
      projectClient,
      { clientId: 'c-loft' },
      projectWithClient('c-loft'),
    ],
  ])
})

describe('assertScopedRefs phases', () => {
  itRefusesScoped('phases', [
    ['accepts an in-company project', pass, { projectId: 'p1' }],
    ['rejects a project in another company', phaseProject, { projectId: 'p-loft' }],
    ['rejects a project whose client is archived', phaseProject, { projectId: 'p-hidden' }],
    ['requires the project on create', phaseProject, { name: 'No parent' }],
    ['rejects a null project on create', phaseProject, { projectId: null }],
    ['requires the project on a full row', phaseProject, {}, storedPhase, { fullRow: true }],
    ['rejects an update clearing the project', phaseProject, { projectId: null }, storedPhase],
    [
      'rejects an update unsetting the project',
      phaseProject,
      { projectId: undefined },
      storedPhase,
    ],
    ['lets a partial update omit the project', pass, { name: 'Delivery' }, storedPhase],
    ['lets a non-full row omit it', pass, { name: 'Delivery' }, storedPhase, { fullRow: false }],
    [
      'accepts an unrelated edit beneath an archived client',
      pass,
      { ...hiddenPhase, name: 'Renamed' },
      hiddenPhase,
    ],
  ])
})

describe('assertScopedRefs activities', () => {
  itRefusesScoped('activities', [
    ['requires a project for a project activity', projectRequired, { kind: 'project', name: 'T' }],
    ['accepts a project activity with a project', pass, { kind: 'project', projectId: 'p1' }],
    ['rejects a dangling project', activityProject, { projectId: 'ghost' }],
    [
      'rejects a project whose client is archived',
      activityProject,
      { kind: 'project', projectId: 'p-hidden', name: 'New activity' },
    ],
    ['forbids a project on internal work', projectForbidden, { kind: 'internal', projectId: 'p1' }],
    ['forbids a phase on internal work', phaseForbidden, { kind: 'internal', phaseId: 'ph1' }],
    ['accepts project-less internal work', pass, { kind: 'internal', name: 'Admin' }],
    [
      'forbids a project on all-projects work',
      projectForbidden,
      { kind: 'allProjects', projectId: 'p1' },
    ],
    [
      'forbids a phase on all-projects work',
      phaseForbidden,
      { kind: 'allProjects', phaseId: 'ph1' },
    ],
    ['accepts project-less all-projects work', pass, { kind: 'allProjects' }],
    ['does not treat an unknown kind as internal', pass, { kind: 'bogus', projectId: 'p1' }],
    [
      'checks the project before a phase of another company',
      activityProject,
      { kind: 'project', projectId: 'p-loft', phaseId: 'ph-loft' },
    ],
    [
      'rejects a phase of another company',
      phaseWrongCompany,
      { projectId: 'p1', phaseId: 'ph-loft' },
    ],
    ['rejects a missing phase', phaseWrongCompany, { projectId: 'p1', phaseId: 'ph-missing' }],
    ['rejects a non-string phase id', phaseWrongCompany, { projectId: 'p1', phaseId: 7 }],
    ['requires a project alongside a phase', phaseNeedsProject, { phaseId: 'ph1' }],
    ['rejects a phase of another project', phaseMismatch, { projectId: 'p2', phaseId: 'ph1' }],
    [
      'rejects a phase of another project on project work',
      phaseMismatch,
      { kind: 'project', projectId: 'p2', phaseId: 'ph1' },
    ],
    ['accepts a phase of its own project', pass, { projectId: 'p1', phaseId: 'ph1' }],
    [
      'accepts a phase of its own project on project work',
      pass,
      { kind: 'project', projectId: 'p1', phaseId: 'ph1' },
    ],
    [
      'accepts an unchanged missing phase',
      pass,
      { projectId: 'p1', phaseId: 'ph-missing' },
      activityWith({ phaseId: 'ph-missing' }),
    ],
    [
      'accepts an unchanged missing project and phase',
      pass,
      { ...activityWith({ projectId: 'p-gone', phaseId: 'ph-gone' }), name: 'Renamed' },
      activityWith({ projectId: 'p-gone', phaseId: 'ph-gone' }),
    ],
    [
      'rejects an unchanged phase of another company',
      phaseWrongCompany,
      { projectId: 'p1', phaseId: 'ph-loft' },
      activityWith({ phaseId: 'ph-loft' }),
    ],
    [
      'rechecks an unchanged phase when the project changes',
      phaseMismatch,
      { projectId: 'p2', phaseId: 'ph1' },
      activityWith({ phaseId: 'ph1' }),
    ],
    [
      'rechecks a changed phase',
      phaseWrongCompany,
      { ...activityWith({ phaseId: 'ph-old' }), phaseId: 'ph-new' },
      activityWith({ phaseId: 'ph-old' }),
    ],
  ])
})

describe('assertScopedRefs resources', () => {
  itRefusesScoped('resources', [
    ['lets a person carry an avatar URL', pass, { kind: 'person', avatarUrl: avatar }],
    [
      'forbids an avatar on a placeholder',
      avatarForbidden,
      { kind: 'placeholder', avatarUrl: avatar },
    ],
    [
      'forbids a stored avatar on a placeholder',
      avatarForbidden,
      { name: 'Batgirl' },
      makePerson('ph', { kind: 'placeholder', avatarUrl: avatar }),
    ],
    [
      'rejects an http avatar URL',
      avatarInvalid,
      { kind: 'person', avatarUrl: 'http://images.example/a.png' },
    ],
    [
      'rejects an avatar URL that is not normalised',
      avatarInvalid,
      { kind: 'person', avatarUrl: 'https://Images.example/a.png' },
    ],
    [
      'leaves a stored resource without an avatar alone',
      pass,
      { name: 'Clark Kent' },
      storedPerson,
    ],
    ['leaves a null avatar URL alone', pass, { kind: 'placeholder', avatarUrl: null }],
    ['forbids a project on a new person', bindingForbidden, { kind: 'person', projectId: 'p1' }],
    [
      'forbids a project on a new external',
      bindingForbidden,
      { kind: 'external', projectId: 'p1' },
    ],
    [
      'forbids a stored binding when kind is supplied',
      bindingForbidden,
      { kind: 'person' },
      boundPerson,
    ],
    [
      'forbids a binding supplied to a stored person',
      bindingForbidden,
      { projectId: 'p1' },
      storedPerson,
    ],
    [
      'leaves a stored binding alone on an unrelated edit',
      pass,
      { name: 'Clark Kent' },
      boundPerson,
    ],
    [
      'leaves a legacy binding to a missing project alone',
      pass,
      { name: 'Renamed' },
      makePerson('r1', { projectId: 'legacy-project' }),
    ],
    ['accepts a project on a placeholder', pass, { kind: 'placeholder', projectId: 'p1' }],
    ['skips the binding rule without a known kind', pass, { projectId: 'p1' }],
    ['skips the binding rule for a null kind', pass, { kind: null, projectId: 'p1' }],
    [
      'keeps a person from becoming a placeholder',
      kindChanged,
      { kind: 'placeholder' },
      storedPerson,
    ],
    [
      'keeps a placeholder from becoming a person',
      kindChanged,
      { kind: 'person' },
      boundPlaceholder,
    ],
    [
      'keeps a placeholder from becoming a person with no project',
      kindChanged,
      { kind: 'person', projectId: undefined },
      boundPlaceholder,
    ],
    [
      'rejects an unknown stored kind',
      kindCorrupt,
      { name: 'Clark Kent' },
      { ...storedPerson, kind: 'robot' },
    ],
    [
      'rejects a non-string stored kind',
      kindCorrupt,
      { name: 'Clark Kent' },
      { ...storedPerson, kind: 7 },
    ],
    ['accepts the unchanged kind', pass, { kind: 'person' }, storedPerson],
    ['rejects a missing discipline', discipline, { kind: 'person', disciplineId: 'd-missing' }],
    ['rejects a discipline in another company', discipline, { disciplineId: 'd-loft' }],
    [
      'rejects a placeholder project in another company',
      placeholderProject,
      { kind: 'placeholder', projectId: 'p-loft' },
    ],
    ['rejects a kindless binding in another company', placeholderProject, { projectId: 'p-loft' }],
    [
      'rejects a placeholder project whose client is archived',
      placeholderProject,
      { kind: 'placeholder', projectId: 'p-hidden', jobTitle: 'Slot' },
    ],
    [
      'accepts an unchanged placeholder project absent from the data',
      pass,
      { name: 'Renamed', projectId: 'p-gone' },
      makePlaceholder('r1', 'p-gone'),
    ],
  ])
})

describe('assertScopedRefs tables without catalogue references', () => {
  const referenceLooking = { clientId: 'c-loft', projectId: 'p-loft', kind: 'robot' }
  describe.each(['clients', 'disciplines', 'allocations', 'timeOff', 'closures'] as const)(
    '%s',
    (key) => {
      itRefusesScoped(key, [
        ['ignores reference-looking fields', pass, referenceLooking],
        ['accepts an empty record', pass, {}],
      ])
    }
  )
  itRefusesScoped('unknown' as ScopedEntityKey, [
    ['ignores an unknown table key', pass, { clientId: 'c-loft' }],
  ])
})

describe('assertAllocationRefs', () => {
  type Existing = { resourceId: ID; activityId: ID; projectId?: ID | null }
  type AllocationRow = [
    title: string,
    expected: Failure | undefined,
    call: [resourceId: ID, activityId: ID, hoursPerDay?: number, projectId?: ID | null],
    existing?: Existing,
  ]
  const was = (resourceId: ID, activityId: ID, projectId?: ID): Existing =>
    projectId === undefined ? { resourceId, activityId } : { resourceId, activityId, projectId }

  const rows: AllocationRow[] = [
    ['accepts an active resource and activity', pass, ['r1', 't1']],
    ['rejects a missing resource', references, ['r-missing', 't1']],
    ['rejects a resource in another company', references, ['r-loft', 't1']],
    ['rejects a missing activity', references, ['r1', 't-missing']],
    ['rejects an activity in another company', references, ['r1', 't-loft']],
    ['rejects a newly chosen archived resource', resourceInactive, ['r-archived', 't1']],
    ['keeps an unchanged archived resource', pass, ['r-archived', 't1'], was('r-archived', 't1')],
    [
      'rejects switching to an archived resource',
      resourceInactive,
      ['r-archived', 't1'],
      was('r1', 't1'),
    ],
    ['rejects a newly chosen archived activity', activityInactive, ['r1', 't-archived']],
    ['keeps an unchanged archived activity', pass, ['r1', 't-archived'], was('r1', 't-archived')],
    ['rejects new work under an archived project', activityInactive, ['r1', 't-in-archived']],
    [
      'rejects switching to work under an archived project',
      activityInactive,
      ['r1', 't-in-archived'],
      was('r1', 't1'),
    ],
    [
      'keeps unchanged archived references',
      pass,
      ['r-archived', 't-in-archived'],
      was('r-archived', 't-in-archived'),
    ],
    ['rejects new work beneath an archived client', activityInactive, ['r1', 't-hidden']],
    [
      'keeps unchanged work beneath an archived client',
      pass,
      ['r1', 't-hidden'],
      was('r1', 't-hidden'),
    ],
    ['rejects work whose project is missing', projectInactive, ['r1', 't-orphan']],
    ['rejects work whose project is in another company', projectInactive, ['r1', 't-foreign']],
    ['forbids attribution on project work', attributionForbidden, ['r1', 't1', 8, 'p1']],
    ['allows attribution on all-projects work', pass, ['r1', 't-all', 8, 'p1']],
    ['allows a null attribution on all-projects work', pass, ['r1', 't-all', 8, null]],
    ['rejects attribution to a missing project', projectInactive, ['r1', 't-all', 8, 'p-missing']],
    ['rejects attribution to another company', projectInactive, ['r1', 't-all', 8, 'p-loft']],
    [
      'rejects new attribution to an archived project',
      projectInactive,
      ['r1', 't-all', 8, 'p-archived'],
    ],
    [
      'rejects changing attribution to an archived project',
      projectInactive,
      ['r1', 't-all', 8, 'p-archived'],
      was('r1', 't-all'),
    ],
    [
      'keeps unchanged attribution to an archived project',
      pass,
      ['r1', 't-all', 8, 'p-archived'],
      was('r1', 't-all', 'p-archived'),
    ],
    ['accepts a placeholder on its bound project', pass, ['ph-p1', 't1']],
    ['rejects a placeholder on another project', placeholderMismatch, ['ph-p1', 't2']],
    ['accepts a placeholder attributed to its project', pass, ['ph-p1', 't-all', 8, 'p1']],
    [
      'rejects a placeholder attributed to another project',
      placeholderMismatch,
      ['ph-p1', 't-all', 8, 'p2'],
    ],
    ['rejects an unbound placeholder', placeholderUnbound, ['ph-unbound', 't-all', 8, 'p1']],
    ['lets an external resource carry zero hours', pass, ['ext1', 't1', 0]],
    ['rejects four hours on an external resource', externalHours, ['ext1', 't1', 4]],
    ['rejects eight hours on an external resource', externalHours, ['ext1', 't1', 8]],
    ['lets a person carry four hours', pass, ['r1', 't1', 4]],
  ]

  it.each(rows)(
    '%s',
    (_title, expected, [resourceId, activityId, hours = 8, projectId], existing) => {
      expect(
        captureFailure(() =>
          assertAllocationRefs(makeWorld(), A1, resourceId, activityId, hours, projectId, existing)
        )
      ).toEqual(expected)
    }
  )
})
