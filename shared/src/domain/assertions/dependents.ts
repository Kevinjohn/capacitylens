import {
  allocationAttributionAllowed,
  effectiveProjectId,
  withoutAllocationAttribution,
  validateAllocationAssignment,
  validateDateRange,
  type ValidationResult,
} from "../../lib/integrity";
import { isExternalResource } from "../../types/entities";
import type { Activity, Allocation, AppData, ID, ISODate, Resource, TimeOff } from "../../types/entities";
import { belongsToAccount } from "../tenancy";
import { domainError, type DomainErrorCode } from "../errors";
import {
  ownedRow,
  validationAllocationsFor,
  throwIfInvalid,
  isEffectivelyActive,
  type ValidationDataLookup,
} from "../validationLookup";

/**
 * A resource may only BE external if it carries no disallowed dependents. The v0.8.1 rule
 * ("an external / 3rd-party resource has no capacity, so no loaded allocation and no time off")
 * is enforced at the allocation/time-off write boundary by assertAllocationRefs /
 * assertResourceExists — but a resource's `kind` can be flipped to external AFTER it already owns
 * those dependents, which nothing re-validates: the scheduler then HIDES the now-external capacity
 * and time-off, recreating the invisible-orphan state v0.8.1 closed.
 *
 * The store and server are the integrity boundary, so we REJECT the flip rather than silently
 * zeroing hours / dropping time-off (surprising data loss as a side effect of a name/colour-style
 * edit). The owner must reassign or remove the work + time off FIRST. Symmetric with
 * assertAllocationRefs / assertResourceExists, which reject the inverse write. Only fires on the
 * external case (a person/placeholder write is unaffected). `mergedKind` is the kind the resource
 * WILL have after the write (`patch.kind ?? existing.kind` in the store, the merged row's kind on
 * the server); when it's not external this is a pure no-op. Import keeps RECONCILING instead
 * (remapAndValidateImport coerces the load to 0 and drops the time-off) — a bulk file is a
 * different contract from an interactive edit, so don't route it here.
 */
export function assertResourceKindAllowsDependents(
  data: AppData,
  accountId: ID,
  resourceId: ID,
  mergedKind: unknown,
  lookup?: ValidationDataLookup,
): void {
  if (!isExternalResource({ kind: mergedKind as Resource["kind"] })) return;
  // A loaded allocation OR any time-off both vanish from the scheduler once the resource is external.
  // hoursPerDay !== 0 mirrors assertAllocationRefs' "externals carry no load" rule (a zero-load
  // allocation is allowed on an external, so it doesn't block the flip).
  const owns = (e: Allocation | TimeOff) => e.resourceId === resourceId && belongsToAccount(e, accountId);
  const hasLoadedAllocation = lookup
    ? lookup.resourceHasLoadedAllocation(accountId, resourceId)
    : data.allocations.some((a) => owns(a) && a.hoursPerDay !== 0);
  const hasTimeOff = lookup ? lookup.resourceHasTimeOff(accountId, resourceId) : data.timeOff.some((t) => owns(t));
  if (hasLoadedAllocation || hasTimeOff) {
    domainError(
      "resource_external_dependents",
      "Reassign or remove this resource’s work and time off before making it external.",
    );
  }
}

/**
 * A resource edit must not turn an allocation that is valid for the stored resource into one that
 * violates the placeholder project rule. This covers both rebinding an existing placeholder and
 * converting another resource kind into a placeholder after work has already been assigned.
 *
 * Only newly introduced invalidity is rejected. Legacy/corrupt assignments therefore do not make
 * an unrelated edit the repair boundary, while a project/kind edit that repairs them remains
 * available. Import retains its separate reconciling contract.
 */
export function assertResourceProjectAllowsDependents(
  data: AppData,
  accountId: ID,
  resourceId: ID,
  merged: Resource,
  existing?: Resource,
  lookup?: ValidationDataLookup,
): void {
  // The resource side short-circuits only when NEITHER kind nor projectId moved: both feed the
  // placeholder rule, so either one changing can newly invalidate an allocation.
  if (existing !== undefined && merged.kind === existing.kind && merged.projectId === existing.projectId) return;
  assertAllocationPairStaysValid(
    data,
    accountId,
    resourceId,
    { side: "resource", merged, existing },
    "placeholder_project_dependents",
    "Reassign or remove this placeholder’s work before changing its bound project.",
    lookup,
  );
}

/** The shared body of the two mirrored "did this edit retroactively invalidate an existing
 * allocation?" guards. `edit` says which END of the allocation is being written: that end is held
 * fixed at its before/after values while the OTHER end is resolved per allocation, and
 * validateAllocationAssignment is always fed (resource, effective project id). Only NEWLY introduced
 * invalidity is rejected, so a legacy/corrupt pair never makes an unrelated edit the repair
 * boundary. Each caller keeps its own early-return guard — the two sides deliberately differ. */
function assertAllocationPairStaysValid(
  data: AppData,
  accountId: ID,
  id: ID,
  edit:
    | { side: "resource"; merged: Resource; existing?: Resource }
    | { side: "activity"; merged: Activity; existing?: Activity },
  code: DomainErrorCode,
  message: string,
  lookup?: ValidationDataLookup,
): void {
  for (const allocation of validationAllocationsFor(data, accountId, edit.side, id, lookup)) {
    let before: ValidationResult | undefined;
    let after: ValidationResult;
    if (edit.side === "resource") {
      const activity = ownedRow<Activity>(data, "activities", allocation.activityId, accountId, lookup);
      if (!activity) continue;
      const projectId = effectiveProjectId(allocation, activity);
      before = edit.existing && validateAllocationAssignment(edit.existing, projectId);
      after = validateAllocationAssignment(edit.merged, projectId);
    } else {
      const resource = ownedRow<Resource>(data, "resources", allocation.resourceId, accountId, lookup);
      if (!resource) continue;
      before = edit.existing && validateAllocationAssignment(resource, effectiveProjectId(allocation, edit.existing));
      const allocationAfter = allocationAttributionAllowed(edit.merged.kind)
        ? allocation
        : withoutAllocationAttribution(allocation);
      after = validateAllocationAssignment(resource, effectiveProjectId(allocationAfter, edit.merged));
    }
    // An absent `existing` (a create) counts as "was valid", exactly as each caller's own check did.
    if ((before === undefined || before.ok) && !after.ok) domainError(code, message);
  }
}

/**
 * The mirror of assertResourceProjectAllowsDependents for activity project edits: moving a project
 * activity (or turning project-less work into project work) must not retroactively invalidate a
 * placeholder allocation. Existing corrupt rows do not block unrelated activity edits.
 */
export function assertActivityProjectAllowsDependents(
  data: AppData,
  accountId: ID,
  activityId: ID,
  merged: Activity,
  existing?: Activity,
  lookup?: ValidationDataLookup,
): void {
  // Kind changes can change whether allocation-level attribution is effective, so both fields feed
  // the placeholder rule on this side.
  if (existing !== undefined && merged.kind === existing.kind && merged.projectId === existing.projectId) return;
  assertAllocationPairStaysValid(
    data,
    accountId,
    activityId,
    { side: "activity", merged, existing },
    "activity_project_dependents",
    "Reassign placeholder work before changing this activity’s project.",
    lookup,
  );
}

/** No allocation or time-off may persist an empty, malformed, or reversed range. */
export function assertDateRange(startDate?: ISODate, endDate?: ISODate): void {
  throwIfInvalid(validateDateRange(startDate, endDate));
}

/**
 * Time off references a resource in the active account, exactly as an allocation does —
 * and that resource must be capacity-tracked. An external / 3rd party has no capacity, so
 * time off is meaningless for it (the scheduler hides external time-off entirely): the form
 * omits externals from the picker AND rejects a crafted pick, so enforce the SAME rule here
 * so a direct store / API write can't persist an invisible orphan.
 *
 */
export function assertResourceExists(
  data: AppData,
  accountId: ID,
  resourceId: ID,
  existing?: Pick<TimeOff, "resourceId">,
  lookup?: ValidationDataLookup,
): void {
  const resource = ownedRow<Resource>(data, "resources", resourceId, accountId, lookup);
  if (!resource) {
    domainError("time_off_resource_invalid", "Time off must reference an existing resource in this company.");
  }
  if (existing?.resourceId !== resourceId && !isEffectivelyActive(data, "resources", resource, lookup)) {
    domainError("time_off_resource_inactive", "Time off must reference an active resource in this company.");
  }
  if (isExternalResource(resource)) {
    domainError("time_off_external_resource", "Time off can’t be recorded for an external / 3rd-party resource.");
  }
}
