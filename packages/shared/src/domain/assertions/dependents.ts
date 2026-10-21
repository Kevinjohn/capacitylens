import {
  allocationAttributionAllowed,
  effectiveProjectId,
  withoutAllocationAttribution,
  validateAllocationAssignment,
  validateDateRange,
} from "../../lib/integrity.js";
import type { ValidationResult } from "../../lib/integrity.js";
import { isExternalResource } from "../../types/entities.js";
import type { Activity, Allocation, AppData, ID, ISODate, Resource, TimeOff } from "../../types/entities.js";
import { belongsToAccount } from "../tenancy.js";
import { throwDomainError } from "../errors.js";
import type { DomainErrorCode } from "../errors.js";
import { resolveOwnedRow, listValidationAllocations, assertValid, isEffectivelyActive } from "../validationLookup.js";
import type { ValidationDataLookup } from "../validationLookup.js";

interface AssertAllocationPairStaysValidOptions {
  data: AppData;
  accountId: ID;
  id: ID;
  edit:
    | { side: "resource"; merged: Resource; existing?: Resource }
    | { side: "activity"; merged: Activity; existing?: Activity };
  code: DomainErrorCode;
  message: string;
  lookup?: ValidationDataLookup;
}

interface AssertResourceKindAllowsDependentsOptions {
  data: AppData;
  accountId: ID;
  resourceId: ID;
  mergedKind: unknown;
  lookup?: ValidationDataLookup;
}

interface AssertResourceProjectAllowsDependentsOptions {
  data: AppData;
  accountId: ID;
  resourceId: ID;
  merged: Resource;
  existing?: Resource;
  lookup?: ValidationDataLookup;
}

interface AssertActivityProjectAllowsDependentsOptions {
  data: AppData;
  accountId: ID;
  activityId: ID;
  merged: Activity;
  existing?: Activity;
  lookup?: ValidationDataLookup;
}

interface AssertResourceExistsOptions {
  data: AppData;
  accountId: ID;
  resourceId: ID;
  existing?: Pick<TimeOff, "resourceId">;
  lookup?: ValidationDataLookup;
}

// Converting a resource to external must not hide existing loaded allocations or time off.
// Reject the interactive edit until dependents are reassigned; imports use their separate repair contract.
function assertResourceKindAllowsDependentsWithOptions({
  data,
  accountId,
  resourceId,
  mergedKind,
  lookup,
}: AssertResourceKindAllowsDependentsOptions): void {
  if (!isExternalResource({ kind: mergedKind as Resource["kind"] })) return;
  // A loaded allocation or any time-off both vanish from the scheduler once the resource is external.
  // hoursPerDay !== 0 mirrors assertAllocationRefs' "externals carry no load" rule (a zero-load
  // allocation is allowed on an external, so it doesn't block the flip).
  const owns = (entity: Allocation | TimeOff) =>
    entity.resourceId === resourceId && belongsToAccount(entity, accountId);
  const hasLoadedAllocation = lookup
    ? lookup.resourceHasLoadedAllocation(accountId, resourceId)
    : data.allocations.some((allocation) => owns(allocation) && allocation.hoursPerDay !== 0);
  const hasTimeOff = lookup
    ? lookup.resourceHasTimeOff(accountId, resourceId)
    : data.timeOff.some((timeOff) => owns(timeOff));
  if (hasLoadedAllocation || hasTimeOff) {
    throwDomainError(
      "resource_external_dependents",
      "Reassign or remove this resource’s work and time off before making it external.",
    );
  }
}

/** Reject a conversion to external while loaded allocations or time off remain.
 * @throws DomainError; the caller must leave the resource unchanged. */
const assertResourceKindAllowsDependents = function assertResourceKindAllowsDependents(
  ...[data, accountId, resourceId, mergedKind, lookup]: [
    data: AppData,
    accountId: ID,
    resourceId: ID,
    mergedKind: unknown,
    lookup?: ValidationDataLookup,
  ]
): void {
  assertResourceKindAllowsDependentsWithOptions({
    data,
    accountId,
    resourceId,
    mergedKind,
    ...(lookup === undefined ? {} : { lookup }),
  });
};

Object.defineProperty(assertResourceKindAllowsDependents, "length", { value: 5 });

// A resource edit must not turn an allocation that is valid for the stored resource into one that
// violates the placeholder project rule. This covers both rebinding an existing placeholder and
// converting another resource kind into a placeholder after work has already been assigned.
// Only newly introduced invalidity is rejected. Legacy/corrupt assignments therefore do not make
// an unrelated edit the repair boundary, while a project/kind edit that repairs them remains
// available. Import retains its separate reconciling contract.
function assertResourceProjectAllowsDependentsWithOptions({
  data,
  accountId,
  resourceId,
  merged,
  existing,
  lookup,
}: AssertResourceProjectAllowsDependentsOptions): void {
  // The resource side short-circuits only when neither kind nor projectId moved: both feed the
  // placeholder rule, so either one changing can newly invalidate an allocation.
  if (existing !== undefined && merged.kind === existing.kind && merged.projectId === existing.projectId) return;
  assertAllocationPairStaysValid({
    data,
    accountId,
    id: resourceId,
    edit: { side: "resource", merged, ...(existing === undefined ? {} : { existing }) },
    code: "placeholder_project_dependents",
    message: "Reassign or remove this placeholder’s work before changing its bound project.",
    ...(lookup === undefined ? {} : { lookup }),
  });
}

/** Reject a resource project/kind edit that newly invalidates an existing allocation’s placeholder assignment.
 * @throws DomainError; unrelated pre-existing invalidity is tolerated. */
const assertResourceProjectAllowsDependents = function assertResourceProjectAllowsDependents(
  ...[data, accountId, resourceId, merged, existing, lookup]: [
    data: AppData,
    accountId: ID,
    resourceId: ID,
    merged: Resource,
    existing?: Resource,
    lookup?: ValidationDataLookup,
  ]
): void {
  assertResourceProjectAllowsDependentsWithOptions({
    data,
    accountId,
    resourceId,
    merged,
    ...(existing === undefined ? {} : { existing }),
    ...(lookup === undefined ? {} : { lookup }),
  });
};

Object.defineProperty(assertResourceProjectAllowsDependents, "length", { value: 6 });

// Compare the edited endpoint before and after against each allocation’s unchanged endpoint.
// Reject only newly invalid assignments so unrelated edits do not become a repair boundary.
function assertAllocationPairStaysValid({
  data,
  accountId,
  id,
  edit,
  code,
  message,
  lookup,
}: AssertAllocationPairStaysValidOptions): void {
  const lookupOptions = lookup === undefined ? {} : { lookup };
  for (const allocation of listValidationAllocations({ data, accountId, side: edit.side, id, ...lookupOptions })) {
    let before: ValidationResult | undefined;
    let after: ValidationResult;
    if (edit.side === "resource") {
      const activity = resolveOwnedRow<Activity>({
        data,
        table: "activities",
        id: allocation.activityId,
        accountId,
        ...lookupOptions,
      });
      if (!activity) continue;
      const projectId = effectiveProjectId(allocation, activity);
      before = edit.existing && validateAllocationAssignment(edit.existing, projectId);
      after = validateAllocationAssignment(edit.merged, projectId);
    } else {
      const resource = resolveOwnedRow<Resource>({
        data,
        table: "resources",
        id: allocation.resourceId,
        accountId,
        ...lookupOptions,
      });
      if (!resource) continue;
      before = edit.existing && validateAllocationAssignment(resource, effectiveProjectId(allocation, edit.existing));
      const allocationAfter = allocationAttributionAllowed(edit.merged.kind)
        ? allocation
        : withoutAllocationAttribution(allocation);
      after = validateAllocationAssignment(resource, effectiveProjectId(allocationAfter, edit.merged));
    }
    // With no existing endpoint, treat the prior assignment as valid so new invalidity is rejected.
    if ((before === undefined || before.ok) && !after.ok) throwDomainError(code, message);
  }
}

// The mirror of assertResourceProjectAllowsDependents for activity project edits: moving a project
// activity (or turning project-less work into project work) must not retroactively invalidate a
// placeholder allocation. Existing corrupt rows do not block unrelated activity edits.
function assertActivityProjectAllowsDependentsWithOptions({
  data,
  accountId,
  activityId,
  merged,
  existing,
  lookup,
}: AssertActivityProjectAllowsDependentsOptions): void {
  // Kind changes can change whether allocation-level attribution is effective, so both fields feed
  // the placeholder rule on this side.
  if (existing !== undefined && merged.kind === existing.kind && merged.projectId === existing.projectId) return;
  assertAllocationPairStaysValid({
    data,
    accountId,
    id: activityId,
    edit: { side: "activity", merged, ...(existing === undefined ? {} : { existing }) },
    code: "activity_project_dependents",
    message: "Reassign placeholder work before changing this activity’s project.",
    ...(lookup === undefined ? {} : { lookup }),
  });
}

/** Reject an activity project/kind edit that newly invalidates an existing placeholder allocation.
 * @throws DomainError; unrelated pre-existing invalidity is tolerated. */
const assertActivityProjectAllowsDependents = function assertActivityProjectAllowsDependents(
  ...[data, accountId, activityId, merged, existing, lookup]: [
    data: AppData,
    accountId: ID,
    activityId: ID,
    merged: Activity,
    existing?: Activity,
    lookup?: ValidationDataLookup,
  ]
): void {
  assertActivityProjectAllowsDependentsWithOptions({
    data,
    accountId,
    activityId,
    merged,
    ...(existing === undefined ? {} : { existing }),
    ...(lookup === undefined ? {} : { lookup }),
  });
};

Object.defineProperty(assertActivityProjectAllowsDependents, "length", { value: 6 });

/** Reject absent, malformed, reversed or overlong scheduled ranges.
 * @throws DomainError; callers must not persist the invalid range. */
export function assertDateRange(startDate?: ISODate, endDate?: ISODate): void {
  assertValid(validateDateRange(startDate, endDate));
}

// Time off references a resource in the active account, exactly as an allocation does,
// and that resource must be capacity-tracked. An external / 3rd party has no capacity, so
// time off is meaningless for it (the scheduler hides external time-off entirely): the form
// omits externals from the picker and rejects a crafted pick, so enforce the same rule here
// so a direct store / API write can't persist an invisible orphan.
function assertResourceExistsWithOptions({
  data,
  accountId,
  resourceId,
  existing,
  lookup,
}: AssertResourceExistsOptions): void {
  const lookupOptions = lookup === undefined ? {} : { lookup };
  const resource = resolveOwnedRow<Resource>({ data, table: "resources", id: resourceId, accountId, ...lookupOptions });
  if (!resource) {
    throwDomainError("time_off_resource_invalid", "Time off must reference an existing resource in this company.");
  }
  if (
    existing?.resourceId !== resourceId &&
    !isEffectivelyActive({ data, table: "resources", row: resource, ...lookupOptions })
  ) {
    throwDomainError("time_off_resource_inactive", "Time off must reference an active resource in this company.");
  }
  if (isExternalResource(resource)) {
    throwDomainError("time_off_external_resource", "Time off can’t be recorded for an external / 3rd-party resource.");
  }
}

/** Require a same-account, capacity-tracked resource for time off; a changed reference must also be active.
 * @throws DomainError; callers must not persist the reference. */
const assertResourceExists = function assertResourceExists(
  ...[data, accountId, resourceId, existing, lookup]: [
    data: AppData,
    accountId: ID,
    resourceId: ID,
    existing?: Pick<TimeOff, "resourceId">,
    lookup?: ValidationDataLookup,
  ]
): void {
  assertResourceExistsWithOptions({
    data,
    accountId,
    resourceId,
    ...(existing === undefined ? {} : { existing }),
    ...(lookup === undefined ? {} : { lookup }),
  });
};

Object.defineProperty(assertResourceExists, "length", { value: 5 });

export {
  assertActivityProjectAllowsDependents,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
};
