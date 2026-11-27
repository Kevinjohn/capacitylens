import {
  isAllocationAttributionAllowed,
  resolveEffectiveProjectId,
  validateAllocationAssignment,
} from '../../lib/integrity.js'
import { RESOURCE_KINDS, isExternalResource } from '../../types/entities.js'
import type {
  Activity,
  Allocation,
  AppData,
  ID,
  Resource,
  ScopedEntity,
  ScopedEntityKey,
} from '../../types/entities.js'
import { isInCompany } from '../companyBoundary.js'
import { throwDomainError } from '../errors.js'
import { parseResourceAvatarUrl } from '../resourceAvatarUrl.js'
import {
  resolveValidationRow,
  resolveOwnedRow,
  assertValid,
  isEffectivelyActive,
} from '../validationRows.js'

const knownResourceKinds: ReadonlySet<unknown> = new Set(RESOURCE_KINDS)

/** Require the target row to belong to companyId before an update or delete.
 * Returns null for a stale id so callers can preserve the no-op contract; otherwise returns the owned row.
 * @throws DomainError for a cross-company row; nothing may be changed. */
export function getOwned<K extends ScopedEntityKey>(
  ...[data, companyId, key, id]: [data: AppData, companyId: ID, key: K, id: ID]
): AppData[K][number] | null {
  const row = (data[key] as ScopedEntity[]).find((entity) => entity.id === id)
  if (!row) return null
  if (!isInCompany(row, companyId)) {
    throwDomainError('record_wrong_company', 'That record does not belong to the active company.')
  }
  return row as AppData[K][number]
}

type ScopedRefsArgs = [
  data: AppData,
  companyId: ID,
  key: ScopedEntityKey,
  record: Record<string, unknown>,
  existing?: ScopedEntity | Record<string, unknown>,
  options?: { fullRow?: boolean },
]

type ScopedRefsContext = {
  data: AppData
  companyId: ID
  record: Record<string, unknown>
  previous: Record<string, unknown> | undefined
  isPresent: (field: string) => boolean
  isSupplied: (field: string) => boolean
  isUnchanged: (field: string) => boolean
  assertRef: (field: string, table: ScopedEntityKey, message: string) => void
}

function createScopedRefsContext(
  ...[data, companyId, record, existing]: [
    AppData,
    ID,
    Record<string, unknown>,
    ScopedEntity | Record<string, unknown> | undefined,
  ]
): ScopedRefsContext {
  const isPresent = (field: string) => record[field] !== undefined && record[field] !== null
  const isSupplied = (field: string) => Object.prototype.hasOwnProperty.call(record, field)
  // Reading loose field names off the stored row is safe: an absent field is undefined and can
  // only equal an equally absent patch field, which is an unchanged no-op.
  const previous = existing as Record<string, unknown> | undefined
  // An unchanged id was already proven in-company when it was written.
  const isUnchanged = (field: string) => previous !== undefined && record[field] === previous[field]
  const assertRef = (field: string, table: ScopedEntityKey, message: string) => {
    if (!isPresent(field)) return
    const resolved =
      typeof record[field] === 'string'
        ? (resolveValidationRow({ data, table, id: record[field] }) as ScopedEntity | undefined)
        : undefined
    if (isUnchanged(field) && (resolved === undefined || isInCompany(resolved, companyId))) {
      return
    }
    if (
      resolved === undefined ||
      !isInCompany(resolved, companyId) ||
      !isEffectivelyActive({ data, table, row: resolved })
    ) {
      throwDomainError('reference_wrong_company', message)
    }
  }
  return {
    data,
    companyId,
    record,
    previous,
    isPresent,
    isSupplied,
    isUnchanged,
    assertRef,
  }
}

function assertRequiredRef(
  context: ScopedRefsContext,
  ...[field, table, message, existing, fullRow]: [
    string,
    ScopedEntityKey,
    string,
    ScopedEntity | Record<string, unknown> | undefined,
    boolean | undefined,
  ]
): void {
  if (context.isPresent(field)) {
    context.assertRef(field, table, message)
    return
  }
  if (existing === undefined || fullRow === true || context.isSupplied(field)) {
    throwDomainError('reference_wrong_company', message)
  }
}

function assertActivityKind(context: ScopedRefsContext): void {
  if (!context.isPresent('kind')) return
  const { record, isPresent } = context
  if (record.kind === 'project' && !isPresent('projectId')) {
    throwDomainError(
      'activity_project_required',
      'A project-specific activity must be assigned to a project.'
    )
  }
  if (record.kind !== 'internal' && record.kind !== 'allProjects') return
  if (isPresent('projectId')) {
    throwDomainError(
      'activity_project_forbidden',
      'An internal or all-projects activity cannot belong to a project.'
    )
  }
  if (isPresent('phaseId')) {
    throwDomainError(
      'activity_phase_forbidden',
      'An internal or all-projects activity cannot belong to a phase.'
    )
  }
}

function assertActivityPhase(context: ScopedRefsContext): void {
  const { data, companyId, record, isPresent, isUnchanged } = context
  if (!isPresent('phaseId')) return
  const phase =
    typeof record.phaseId === 'string'
      ? (resolveValidationRow({ data, table: 'phases', id: record.phaseId }) as
          AppData['phases'][number] | undefined)
      : undefined
  const ownedPhase = phase && isInCompany(phase, companyId) ? phase : undefined
  if (isUnchanged('phaseId') && isUnchanged('projectId')) {
    if (phase && !ownedPhase) {
      throwDomainError(
        'activity_phase_wrong_company',
        'Activity phase must belong to this company.'
      )
    }
    return
  }
  if (!ownedPhase) {
    throwDomainError('activity_phase_wrong_company', 'Activity phase must belong to this company.')
  }
  if (!isPresent('projectId')) {
    throwDomainError(
      'activity_phase_project_required',
      'An activity with a phase must also belong to that phase’s project.'
    )
  }
  if (ownedPhase.projectId !== record.projectId) {
    throwDomainError(
      'activity_phase_project_mismatch',
      'Activity phase must belong to the activity’s project.'
    )
  }
}

function assertActivityRefs(context: ScopedRefsContext): void {
  assertActivityKind(context)
  context.assertRef('projectId', 'projects', 'Activity must reference a project in this company.')
  assertActivityPhase(context)
}

// Resource reference rules intentionally combines kind-dependent project and avatar invariants.

function assertResourceRefs(context: ScopedRefsContext): void {
  const { record, previous, isSupplied, assertRef } = context
  const mergedKind = isSupplied('kind') ? record.kind : previous?.kind
  const mergedProjectId = isSupplied('projectId') ? record.projectId : previous?.projectId
  const projectBindingChanged = isSupplied('kind') || isSupplied('projectId')
  const hasProject = mergedProjectId !== undefined && mergedProjectId !== null
  const hasKind = mergedKind !== undefined && mergedKind !== null
  const mergedAvatarUrl = isSupplied('avatarUrl') ? record.avatarUrl : previous?.avatarUrl
  if (mergedAvatarUrl != null) {
    if (mergedKind !== 'person') {
      throwDomainError('resource_avatar_url_forbidden', 'Only a person can have an avatar URL.')
    }
    const avatarUrl = parseResourceAvatarUrl(mergedAvatarUrl)
    if (avatarUrl !== mergedAvatarUrl) {
      throwDomainError(
        'resource_avatar_url_invalid',
        'Avatar URL must be a normalised HTTPS URL without credentials.'
      )
    }
  }
  if (projectBindingChanged && hasProject && hasKind && mergedKind !== 'placeholder') {
    throwDomainError(
      'resource_project_forbidden',
      'Only a placeholder can be assigned to a project.'
    )
  }
  assertRef('disciplineId', 'disciplines', 'Resource discipline must belong to this company.')
  assertRef('projectId', 'projects', 'Placeholder project must belong to this company.')
}

// Resource kind is immutable on ordinary updates; malformed stored kinds are rejected.
function assertResourceKindImmutable(
  previous: Record<string, unknown> | undefined,
  record: Record<string, unknown>
): void {
  if (previous === undefined) return
  if (typeof previous.kind !== 'string' || !knownResourceKinds.has(previous.kind)) {
    throwDomainError(
      'resource_kind_immutable',
      'The stored resource kind is invalid and must be repaired by import.'
    )
  }
  if (typeof record.kind === 'string' && previous.kind !== record.kind) {
    throwDomainError('resource_kind_immutable', 'A resource’s kind cannot change after creation.')
  }
}

/** Check catalogue references within companyId without checking the record’s own company.
 * Allocation and time-off references have separate validators. Existing must be the owned stored row.
 * Unchanged references may be absent from an active-only client set; their missing/inactive target checks are skipped, but a resolved foreign-company target still fails.
 * Creates and full project/phase rows require their parent; partial updates may omit the parent but cannot clear it.
 * Ordinary resource updates cannot change kind.
 * @throws DomainError on a violation; callers must not persist the write. */
export function assertScopedRefs(
  ...[data, companyId, key, record, existing, options = {}]: ScopedRefsArgs
): void {
  const context = createScopedRefsContext(data, companyId, record, existing)
  if (key === 'resources') assertResourceKindImmutable(context.previous, record)
  switch (key) {
    case 'projects':
      assertRequiredRef(
        context,
        'clientId',
        'clients',
        'Project must reference a client in this company.',
        existing,
        options.fullRow
      )
      break
    case 'phases':
      assertRequiredRef(
        context,
        'projectId',
        'projects',
        'Phase must reference a project in this company.',
        existing,
        options.fullRow
      )
      break
    case 'activities':
      assertActivityRefs(context)
      break
    case 'resources':
      assertResourceRefs(context)
      break
    case 'clients':
    case 'disciplines':
      break
    case 'allocations':
    case 'timeOff':
      // Allocation and time-off references use their dedicated validators.
      break
    case 'closures':
      break
    default: {
      const exhaustive: never = key
      return exhaustive
    }
  }
}

// An allocation must reference a real resource and activity in the active company. Changed
// all-projects attribution may reference only a live project, and placeholder allocations must
// remain effective under their bound project. External resources have no capacity and may carry
// only zero load. Requiring `hoursPerDay` makes every allocation write check that rule.
type AllocationRefsArgs = [
  data: AppData,
  companyId: ID,
  resourceId: ID,
  activityId: ID,
  hoursPerDay: number,
  projectId?: ID | null,
  existing?: Pick<Allocation, 'resourceId' | 'activityId'> & Partial<Pick<Allocation, 'projectId'>>,
]

type AllocationRefsContext = {
  data: AppData
  companyId: ID
  projectId: ID | null | undefined
  existing:
    | (Pick<Allocation, 'resourceId' | 'activityId'> & Partial<Pick<Allocation, 'projectId'>>)
    | undefined
}

function assertAllocationProject(
  context: AllocationRefsContext,
  activity: Activity
): ID | undefined {
  const { data, companyId, projectId, existing } = context
  if (projectId != null && !isAllocationAttributionAllowed(activity.kind)) {
    throwDomainError(
      'allocation_project_forbidden',
      'Only an all-projects activity allocation can be attributed to a project.'
    )
  }
  const resolvedProjectId = resolveEffectiveProjectId(
    projectId === undefined ? {} : { projectId },
    activity
  )
  const project = resolvedProjectId
    ? resolveOwnedRow<AppData['projects'][number]>({
        data,
        table: 'projects',
        id: resolvedProjectId,
        companyId,
      })
    : undefined
  const projectMissing = resolvedProjectId !== undefined && project === undefined
  const projectChanged = existing?.projectId !== projectId
  const projectInactive =
    projectChanged &&
    project !== undefined &&
    !isEffectivelyActive({ data, table: 'projects', row: project })
  if (projectMissing || projectInactive) {
    throwDomainError(
      'allocation_project_inactive',
      'Allocation must reference an activity under an active project in this company.'
    )
  }
  return resolvedProjectId
}

/** Assert an allocation's resource, activity, project and hours are valid for `companyId`. Throws a `DomainError` on a violation. */
export function assertAllocationRefs(
  ...[data, companyId, resourceId, activityId, hoursPerDay, projectId, existing]: AllocationRefsArgs
): void {
  const resource = resolveOwnedRow<Resource>({
    data,
    table: 'resources',
    id: resourceId,
    companyId,
  })
  const activity = resolveOwnedRow<Activity>({
    data,
    table: 'activities',
    id: activityId,
    companyId,
  })
  if (!resource || !activity) {
    throwDomainError(
      'allocation_references_invalid',
      'Allocation must reference an existing resource and activity in this company.'
    )
  }
  if (
    existing?.resourceId !== resourceId &&
    !isEffectivelyActive({ data, table: 'resources', row: resource })
  ) {
    throwDomainError(
      'allocation_resource_inactive',
      'Allocation must reference an active resource in this company.'
    )
  }
  // A project-bound activity must resolve to a project in this company. Normally assertScopedRefs
  // and the database FK make this impossible, but this validator is also the last line of defence
  // for corrupt state. Treat a missing or cross-company project exactly like an inactive
  // one instead of silently accepting the allocation because `project` resolved to undefined.
  const resolvedProjectId = assertAllocationProject(
    { data, companyId, projectId, existing },
    activity
  )
  if (
    existing?.activityId !== activityId &&
    !isEffectivelyActive({ data, table: 'activities', row: activity })
  ) {
    throwDomainError(
      'allocation_activity_inactive',
      'Allocation must reference an activity under an active project.'
    )
  }
  assertValid(validateAllocationAssignment(resource, resolvedProjectId))
  // External parties have no capacity: their allocations carry no load (hoursPerDay 0). The
  // form forces 0 and a drag-reassign reconciles to 0, but those are UI-only, enforce it at the
  // write boundary too so a direct store / API write can't land a phantom load on a capacity-free
  // resource (the scheduler hides it, so it would persist invisibly). Import validates the same rule
  // without coercing the supplied value. Always checked: `hoursPerDay` is a
  // required parameter, so no caller can opt out of the rule.
  if (hoursPerDay !== 0 && isExternalResource(resource)) {
    throwDomainError(
      'external_allocation_hours',
      'An external party’s allocation can’t carry hours.'
    )
  }
}
