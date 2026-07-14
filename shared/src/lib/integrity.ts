import { parseDate, toISODate } from './dateMath'
import type { AppData, EmploymentType, ID, ISODate, Resource } from '../types/entities'

// Referential-integrity rules and cascade-delete transforms. All pure: cascade helpers return a
// NEW AppData rather than mutating. Callers that own a clock may pass an updatedAt revision for
// surviving rows whose foreign key is cleared, so synchronization observes the relationship edit.

/**
 * Is `s` a well-formed, real calendar date in date-only ISO form ("YYYY-MM-DD")?
 * The shape regex alone would accept `2026-13-40` or `2026-02-30` (lexicographic
 * order is fine, but the date is nonsense and breaks later formatting/geometry),
 * so we also round-trip through parse → format: a real date survives unchanged, an
 * out-of-range one rolls over (parse("2026-02-30") → "2026-03-02") and mismatches.
 */
export function isValidISODate(s: unknown): s is ISODate {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const parsed = parseDate(s)
  return !Number.isNaN(parsed.getTime()) && toISODate(parsed) === s
}

export function isTemporary(resource: { employmentType: EmploymentType }): boolean {
  return resource.employmentType !== 'permanent'
}

export interface ValidationResult {
  ok: boolean
  errors: string[]
}

const toResult = (errors: string[]): ValidationResult => ({ ok: errors.length === 0, errors })

/** A project must belong to a client. */
export function validateProjectClient(clientId: ID | undefined | null): ValidationResult {
  return toResult(clientId ? [] : ['A project must belong to a client.'])
}

/**
 * A scheduled range (allocation / time off) must have both ends present, be
 * well-formed real dates, and not be reversed. Dates are date-only ISO strings
 * ("YYYY-MM-DD"), which sort lexicographically, so a plain string compare is a
 * correct date compare. This is the single source of truth the store enforces so
 * no caller can persist an empty, malformed, or reversed range (which would
 * otherwise produce NaN / negative bar geometry on the timeline). The malformed
 * check matters most on the import / direct-store paths, which bypass the native
 * date inputs that keep the UI well-formed.
 */
export function validateDateRange(
  startDate?: ISODate | null,
  endDate?: ISODate | null,
): ValidationResult {
  if (!startDate || !endDate) return toResult(['Start and end dates are required.'])
  if (!isValidISODate(startDate) || !isValidISODate(endDate)) {
    return toResult(['Dates must be valid calendar dates (YYYY-MM-DD).'])
  }
  if (endDate < startDate) return toResult(['End date cannot be before the start date.'])
  return toResult([])
}

/**
 * Placeholder rule: a placeholder is bound to one project and may only take activities
 * from that project — EXCEPT project-less activities (internal/repeatable kinds), which
 * anyone (people and placeholders alike) can be assigned. So the rule only bites when the
 * activity itself belongs to a project.
 */
export function validateAllocationAssignment(
  resource: Resource,
  activityProjectId: ID | undefined,
): ValidationResult {
  const errors: string[] = []
  // Only PLACEHOLDERS are project-restricted. `person` and `external` are intentionally
  // unrestricted (an external 3rd party can be assigned any activity) — don't add a guard here.
  if (resource.kind === 'placeholder' && activityProjectId !== undefined) {
    if (!resource.projectId) {
      errors.push('This placeholder is not bound to a project yet.')
    } else if (resource.projectId !== activityProjectId) {
      errors.push('A placeholder can only be assigned to activities from its bound project.')
    }
  }
  return toResult(errors)
}

// ---- Cascade deletes ----
//
// Every `delete*Cascade` below is PURE: it returns a NEW `AppData` and never mutates its input.
// Pushing onto the undo stack is the store's job. The optional revision lets that caller stamp
// surviving FK edits while these transforms express the referential consequences of a delete (which
// children are removed vs. unbound), mirroring the server's ON DELETE CASCADE / SET NULL rules so
// the local and server paths can't diverge. Safe to compose/test in isolation.

/** Delete a resource and its allocations + time off. PURE — returns a new AppData. */
export function deleteResourceCascade(data: AppData, resourceId: ID): AppData {
  return {
    ...data,
    resources: data.resources.filter((r) => r.id !== resourceId),
    allocations: data.allocations.filter((a) => a.resourceId !== resourceId),
    timeOff: data.timeOff.filter((t) => t.resourceId !== resourceId),
  }
}

/** Delete an activity and its allocations. PURE — returns a new AppData. */
export function deleteActivityCascade(data: AppData, activityId: ID): AppData {
  return {
    ...data,
    activities: data.activities.filter((t) => t.id !== activityId),
    allocations: data.allocations.filter((a) => a.activityId !== activityId),
  }
}

/** Deleting a phase is non-destructive to its activities — it just ungroups them. */
export function deletePhaseCascade(data: AppData, phaseId: ID, updatedAt?: string): AppData {
  return {
    ...data,
    phases: data.phases.filter((p) => p.id !== phaseId),
    activities: data.activities.map((t) =>
      t.phaseId === phaseId ? { ...t, phaseId: undefined, ...(updatedAt ? { updatedAt } : {}) } : t,
    ),
  }
}

/** Delete a project: drops its phases + activities + those activities' allocations, unbinds a surviving activity's phase and any placeholder bound to it. PURE — returns a new AppData. */
export function deleteProjectCascade(data: AppData, projectId: ID, updatedAt?: string): AppData {
  const removedActivityIds = new Set(
    data.activities.filter((t) => t.projectId === projectId).map((t) => t.id),
  )
  // Phases removed with the project. Any SURVIVING activity that pointed at one of them
  // (e.g. legacy/incoherent data) must have its phaseId unbound, never left dangling —
  // mirroring the server FK's ON DELETE SET NULL on activities.phaseId.
  const removedPhaseIds = new Set(
    data.phases.filter((p) => p.projectId === projectId).map((p) => p.id),
  )
  return {
    ...data,
    projects: data.projects.filter((p) => p.id !== projectId),
    phases: data.phases.filter((p) => p.projectId !== projectId),
    activities: data.activities
      .filter((t) => t.projectId !== projectId)
      .map((t) =>
        t.phaseId !== undefined && removedPhaseIds.has(t.phaseId)
          ? { ...t, phaseId: undefined, ...(updatedAt ? { updatedAt } : {}) }
          : t,
      ),
    allocations: data.allocations.filter((a) => !removedActivityIds.has(a.activityId)),
    // A placeholder bound to this project is unbound (not deleted).
    resources: data.resources.map((r) =>
      r.projectId === projectId
        ? { ...r, projectId: undefined, ...(updatedAt ? { updatedAt } : {}) }
        : r,
    ),
  }
}

/** Delete a client and everything beneath it (projects → phases → activities → allocations), unbinding
 *  surviving phases/placeholders as needed. PURE — returns a new AppData. */
export function deleteClientCascade(data: AppData, clientId: ID, updatedAt?: string): AppData {
  // Single pass: collect every id removed by this client's deletion FIRST, then filter each
  // table ONCE — rather than re-copying the whole tree per project (deleteProjectCascade × N).
  // Same cascade semantics as looping that helper: drop the client's projects + their phases +
  // their activities (and those activities' allocations), unbind a surviving activity's phaseId that pointed
  // at a removed phase, and unbind a placeholder bound to a removed project.
  const removedProjectIds = new Set(
    data.projects.filter((p) => p.clientId === clientId).map((p) => p.id),
  )
  const removedPhaseIds = new Set(
    data.phases.filter((p) => removedProjectIds.has(p.projectId)).map((p) => p.id),
  )
  const removedActivityIds = new Set(
    data.activities.filter((t) => t.projectId !== undefined && removedProjectIds.has(t.projectId)).map((t) => t.id),
  )
  return {
    ...data,
    clients: data.clients.filter((c) => c.id !== clientId),
    projects: data.projects.filter((p) => !removedProjectIds.has(p.id)),
    phases: data.phases.filter((p) => !removedPhaseIds.has(p.id)),
    activities: data.activities
      .filter((t) => !removedActivityIds.has(t.id))
      .map((t) =>
        t.phaseId !== undefined && removedPhaseIds.has(t.phaseId)
          ? { ...t, phaseId: undefined, ...(updatedAt ? { updatedAt } : {}) }
          : t,
      ),
    allocations: data.allocations.filter((a) => !removedActivityIds.has(a.activityId)),
    resources: data.resources.map((r) =>
      r.projectId !== undefined && removedProjectIds.has(r.projectId)
        ? { ...r, projectId: undefined, ...(updatedAt ? { updatedAt } : {}) }
        : r,
    ),
  }
}

/** Deleting a discipline ungroups its resources rather than deleting them. */
export function deleteDisciplineCascade(data: AppData, disciplineId: ID, updatedAt?: string): AppData {
  return {
    ...data,
    disciplines: data.disciplines.filter((d) => d.id !== disciplineId),
    resources: data.resources.map((r) =>
      r.disciplineId === disciplineId
        ? { ...r, disciplineId: undefined, ...(updatedAt ? { updatedAt } : {}) }
        : r,
    ),
  }
}
