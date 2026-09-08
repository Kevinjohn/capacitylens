import { allocationAttributionAllowed, effectiveProjectId, validateAllocationAssignment } from "../../lib/integrity";
import { isExternalResource } from "../../types/entities";
import type { Activity, Allocation, AppData, ID, Resource, ScopedEntity, ScopedEntityKey } from "../../types/entities";
import { belongsToAccount } from "../tenancy";
import { domainError } from "../errors";
import {
  resolveValidationRow,
  resolveOwnedRow,
  assertValid,
  isEffectivelyActive,
  type ValidationDataLookup,
} from "../validationLookup";

/**
 * Strict tenancy at the WRITE boundary. An update/delete must own its target:
 *   - ABSENT row  → return null; the caller no-ops (preserves the silent-no-op
 *     contract for a stale id, e.g. a drag committed after an undo).
 *   - CROSS-ACCOUNT row → throw; a real integrity violation no legitimate flow
 *     produces. Returns the owned row so callers can read its current values.
 */
export function findOwned<K extends ScopedEntityKey>(
  ...[data, accountId, key, id]: [data: AppData, accountId: ID, key: K, id: ID]
): AppData[K][number] | null {
  const row = (data[key] as ScopedEntity[]).find((entity) => entity.id === id);
  if (!row) return null;
  if (!belongsToAccount(row, accountId)) {
    domainError("record_wrong_account", "That record does not belong to the active company.");
  }
  return row as AppData[K][number];
}

type ScopedRefsArgs = [
  data: AppData,
  accountId: ID,
  key: ScopedEntityKey,
  record: Record<string, unknown>,
  existing?: ScopedEntity | Record<string, unknown>,
  lookup?: ValidationDataLookup,
  options?: { fullRow?: boolean },
];

type ScopedRefsContext = {
  data: AppData;
  accountId: ID;
  record: Record<string, unknown>;
  previous: Record<string, unknown> | undefined;
  lookupOptions: { lookup?: ValidationDataLookup };
  present: (field: string) => boolean;
  supplied: (field: string) => boolean;
  unchanged: (field: string) => boolean;
  need: (field: string, table: ScopedEntityKey, message: string) => void;
};

function createScopedRefsContext(
  ...[data, accountId, record, existing, lookup]: [
    AppData,
    ID,
    Record<string, unknown>,
    ScopedEntity | Record<string, unknown> | undefined,
    ValidationDataLookup | undefined,
  ]
): ScopedRefsContext {
  const lookupOptions = lookup === undefined ? {} : { lookup };
  const present = (field: string) => record[field] !== undefined && record[field] !== null;
  const supplied = (field: string) => Object.prototype.hasOwnProperty.call(record, field);
  // Reading loose field names off the stored row is safe: an absent field is undefined and can
  // only equal an equally absent patch field, which is an unchanged no-op.
  const previous = existing as Record<string, unknown> | undefined;
  // An unchanged id was already proven in-account when it was written.
  const unchanged = (field: string) => previous !== undefined && record[field] === previous[field];
  const need = (field: string, table: ScopedEntityKey, message: string) => {
    if (!present(field)) return;
    const resolved =
      typeof record[field] === "string"
        ? (resolveValidationRow({ data, table, id: record[field], ...lookupOptions }) as ScopedEntity | undefined)
        : undefined;
    if (unchanged(field) && (resolved === undefined || belongsToAccount(resolved, accountId))) return;
    if (
      resolved === undefined ||
      !belongsToAccount(resolved, accountId) ||
      !isEffectivelyActive({ data, table, row: resolved, ...lookupOptions })
    ) {
      domainError("reference_wrong_account", message);
    }
  };
  return { data, accountId, record, previous, lookupOptions, present, supplied, unchanged, need };
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
  if (context.present(field)) {
    context.need(field, table, message);
    return;
  }
  if (existing === undefined || fullRow === true || context.supplied(field)) {
    domainError("reference_wrong_account", message);
  }
}

function assertActivityKind(context: ScopedRefsContext): void {
  if (!context.present("kind")) return;
  const { record, present } = context;
  if (record.kind === "project" && !present("projectId")) {
    domainError("activity_project_required", "A project-specific activity must be assigned to a project.");
  }
  if (record.kind !== "internal" && record.kind !== "repeatable") return;
  if (present("projectId")) {
    domainError("activity_project_forbidden", "An internal or all-projects activity cannot belong to a project.");
  }
  if (present("phaseId")) {
    domainError("activity_phase_forbidden", "An internal or all-projects activity cannot belong to a phase.");
  }
}

function assertActivityPhase(context: ScopedRefsContext): void {
  const { data, accountId, record, lookupOptions, present, unchanged } = context;
  if (!present("phaseId")) return;
  const phase =
    typeof record.phaseId === "string"
      ? (resolveValidationRow({ data, table: "phases", id: record.phaseId, ...lookupOptions }) as
          AppData["phases"][number] | undefined)
      : undefined;
  const ownedPhase = phase && belongsToAccount(phase, accountId) ? phase : undefined;
  if (unchanged("phaseId") && unchanged("projectId")) {
    if (phase && !ownedPhase)
      domainError("activity_phase_wrong_account", "Activity phase must belong to this company.");
    return;
  }
  if (!ownedPhase) domainError("activity_phase_wrong_account", "Activity phase must belong to this company.");
  if (!present("projectId")) {
    domainError(
      "activity_phase_project_required",
      "An activity with a phase must also belong to that phase’s project.",
    );
  }
  if (ownedPhase.projectId !== record.projectId) {
    domainError("activity_phase_project_mismatch", "Activity phase must belong to the activity’s project.");
  }
}

function assertActivityRefs(context: ScopedRefsContext): void {
  assertActivityKind(context);
  context.need("projectId", "projects", "Activity must reference a project in this company.");
  assertActivityPhase(context);
}

function assertResourceRefs(context: ScopedRefsContext): void {
  const { record, previous, supplied, need } = context;
  const mergedKind = supplied("kind") ? record.kind : previous?.kind;
  const mergedProjectId = supplied("projectId") ? record.projectId : previous?.projectId;
  const projectBindingChanged = supplied("kind") || supplied("projectId");
  const hasProject = mergedProjectId !== undefined && mergedProjectId !== null;
  const hasKind = mergedKind !== undefined && mergedKind !== null;
  if (projectBindingChanged && hasProject && hasKind && mergedKind !== "placeholder") {
    domainError("resource_project_forbidden", "Only a placeholder can be assigned to a project.");
  }
  need("disciplineId", "disciplines", "Resource discipline must belong to this company.");
  need("projectId", "projects", "Placeholder project must belong to this company.");
}

/**
 * Every foreign key on a new/updated scoped record must point at a row in the
 * SAME account. Optional FKs are checked only when present. A project/phase create or full row must
 * carry its required parent; a partial update may omit that field but may not explicitly clear it.
 *
 * `existing` (updates only) is the currently-stored row the write targets — pass the
 * `findOwned` result so its tenancy is already proven. When a checked FK field equals
 * the existing row's value, its EXISTENCE check is skipped: the reference was validated
 * when it was written, and in SERVER mode the client's hydrated slice is ACTIVE-ONLY
 * (readSlice strips archived/soft-deleted clients/projects), so re-checking an unchanged
 * parent id against the slice would falsely reject every UNRELATED edit (a rename, a
 * colour change) of a row whose parent is archived. A CHANGED id is still validated
 * strictly, so this never weakens tenancy — you can't MOVE a record onto a parent the
 * slice can't prove is yours. (The server needs no such relaxation: its validateWrite
 * runs against the full DB, where an archived parent still exists.)
 */
export function assertScopedRefs(
  ...[data, accountId, key, record, existing, lookup, options = {}]: ScopedRefsArgs
): void {
  const context = createScopedRefsContext(data, accountId, record, existing, lookup);
  switch (key) {
    case "projects":
      assertRequiredRef(
        context,
        "clientId",
        "clients",
        "Project must reference a client in this company.",
        existing,
        options.fullRow,
      );
      break;
    case "phases":
      assertRequiredRef(
        context,
        "projectId",
        "projects",
        "Phase must reference a project in this company.",
        existing,
        options.fullRow,
      );
      break;
    case "activities":
      assertActivityRefs(context);
      break;
    case "resources":
      assertResourceRefs(context);
      break;
    case "clients":
    case "disciplines":
      break;
    case "allocations":
    case "timeOff":
      // Their refs are checked by assertAllocationRefs / assertResourceExists below.
      break;
    case "closures":
      break;
    default: {
      const exhaustive: never = key;
      return exhaustive;
    }
  }
}

/**
 * An allocation must reference a real resource + activity IN THE ACTIVE ACCOUNT, a
 * repeatable attribution may only reference a live project when changed, a placeholder may only
 * take allocations effective under its bound project, and an external /
 * 3rd-party resource (which has no capacity) may only carry a zero load. `hoursPerDay`
 * is REQUIRED — every allocation write knows its load, and making the parameter
 * mandatory forces the compiler to surface it so the capacity-free rule below can never
 * be silently skipped by a future caller (the old optional arg made that invariant
 * opt-in per call site).
 */
type AllocationRefsArgs = [
  data: AppData,
  accountId: ID,
  resourceId: ID,
  activityId: ID,
  hoursPerDay: number,
  projectId?: ID,
  existing?: Pick<Allocation, "resourceId" | "activityId" | "projectId">,
  lookup?: ValidationDataLookup,
];

type AllocationRefsContext = {
  data: AppData;
  accountId: ID;
  projectId: ID | undefined;
  existing: Pick<Allocation, "resourceId" | "activityId" | "projectId"> | undefined;
  lookupOptions: { lookup?: ValidationDataLookup };
};

function assertAllocationProject(context: AllocationRefsContext, activity: Activity): ID | undefined {
  const { data, accountId, projectId, existing, lookupOptions } = context;
  if (projectId !== undefined && !allocationAttributionAllowed(activity.kind)) {
    domainError(
      "allocation_project_forbidden",
      "Only an all-projects activity allocation can be attributed to a project.",
    );
  }
  const resolvedProjectId = effectiveProjectId(projectId === undefined ? {} : { projectId }, activity);
  const project = resolvedProjectId
    ? resolveOwnedRow<AppData["projects"][number]>({
        data,
        table: "projects",
        id: resolvedProjectId,
        accountId,
        ...lookupOptions,
      })
    : undefined;
  const projectMissing = resolvedProjectId !== undefined && project === undefined;
  const projectChanged = existing?.projectId !== projectId;
  const projectInactive =
    projectChanged &&
    project !== undefined &&
    !isEffectivelyActive({ data, table: "projects", row: project, ...lookupOptions });
  if (projectMissing || projectInactive) {
    domainError(
      "allocation_project_inactive",
      "Allocation must reference an activity under an active project in this company.",
    );
  }
  return resolvedProjectId;
}

export function assertAllocationRefs(
  ...[data, accountId, resourceId, activityId, hoursPerDay, projectId, existing, lookup]: AllocationRefsArgs
): void {
  const lookupOptions = lookup === undefined ? {} : { lookup };
  const resource = resolveOwnedRow<Resource>({ data, table: "resources", id: resourceId, accountId, ...lookupOptions });
  const activity = resolveOwnedRow<Activity>({
    data,
    table: "activities",
    id: activityId,
    accountId,
    ...lookupOptions,
  });
  if (!resource || !activity) {
    domainError(
      "allocation_references_invalid",
      "Allocation must reference an existing resource and activity in this company.",
    );
  }
  if (
    existing?.resourceId !== resourceId &&
    !isEffectivelyActive({ data, table: "resources", row: resource, ...lookupOptions })
  ) {
    domainError("allocation_resource_inactive", "Allocation must reference an active resource in this company.");
  }
  // A project-bound activity must resolve to a project in this account. Normally assertScopedRefs
  // and the database FK make this impossible, but this validator is also the last line of defence
  // for legacy/corrupt state. Treat a missing or cross-account project exactly like an inactive
  // one instead of silently accepting the allocation because `project` resolved to undefined.
  const resolvedProjectId = assertAllocationProject({ data, accountId, projectId, existing, lookupOptions }, activity);
  if (
    existing?.activityId !== activityId &&
    !isEffectivelyActive({ data, table: "activities", row: activity, ...lookupOptions })
  ) {
    domainError("allocation_activity_inactive", "Allocation must reference an activity under an active project.");
  }
  assertValid(validateAllocationAssignment(resource, resolvedProjectId));
  // External / 3rd parties have NO capacity: their allocations carry no load (hoursPerDay 0). The
  // form forces 0 and a drag-reassign reconciles to 0, but those are UI-only — enforce it at the
  // write boundary too so a direct store / API write can't land a phantom load on a capacity-free
  // resource (the scheduler hides it, so it would persist invisibly). Import coerces the same value
  // to 0 instead of dropping the booking, which is still valid. Always checked: `hoursPerDay` is a
  // required parameter, so no caller can opt out of the rule.
  if (hoursPerDay !== 0 && isExternalResource(resource)) {
    domainError("external_allocation_hours", "An external / 3rd-party resource’s allocation can’t carry hours.");
  }
}
