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
  data: AppData,
  accountId: ID,
  key: K,
  id: ID,
): AppData[K][number] | null {
  const row = (data[key] as ScopedEntity[]).find((entity) => entity.id === id);
  if (!row) return null;
  if (!belongsToAccount(row, accountId)) {
    domainError("record_wrong_account", "That record does not belong to the active company.");
  }
  return row as AppData[K][number];
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
  data: AppData,
  accountId: ID,
  key: ScopedEntityKey,
  record: Record<string, unknown>,
  existing?: ScopedEntity | Record<string, unknown>,
  lookup?: ValidationDataLookup,
  options: { fullRow?: boolean } = {},
): void {
  const lookupOptions = lookup === undefined ? {} : { lookup };
  const present = (field: string) => record[field] !== undefined && record[field] !== null;
  const supplied = (field: string) => Object.prototype.hasOwnProperty.call(record, field);
  // Reading loose field names off the stored row is safe — an absent field is undefined, which can
  // only ever equal an equally-absent patch field (a no-op skip). The widened accepted type lets
  // call sites pass a typed entity (interfaces lack the implicit index signature) without a copy.
  const previous = existing as Record<string, unknown> | undefined;
  // Unchanged-on-update: see the doc comment — an id identical to the stored row's was
  // already proven in-account at its own write time.
  const unchanged = (field: string) => previous !== undefined && record[field] === previous[field];
  const inAccount = (table: ScopedEntityKey, id: unknown): boolean => {
    if (typeof id !== "string") return false;
    const entity = resolveValidationRow({ data, table, id, ...lookupOptions }) as ScopedEntity | undefined;
    return (
      entity !== undefined &&
      belongsToAccount(entity, accountId) &&
      isEffectivelyActive({ data, table, row: entity, ...lookupOptions })
    );
  };
  const need = (field: string, table: ScopedEntityKey, message: string) => {
    if (!present(field)) return;
    if (unchanged(field)) {
      const id = record[field];
      const resolved = typeof id === "string" ? resolveValidationRow({ data, table, id, ...lookupOptions }) : undefined;
      if (resolved === undefined || belongsToAccount(resolved as unknown as ScopedEntity, accountId)) return;
      domainError("reference_wrong_account", message);
    }
    if (!inAccount(table, record[field])) domainError("reference_wrong_account", message);
  };
  const needRequired = (field: string, table: ScopedEntityKey, message: string) => {
    if (!present(field)) {
      // Only an omitted field on a genuine partial update inherits its stored parent. Creates and
      // full server rows must be self-contained; an explicitly supplied null/undefined is a clear
      // attempt and must not flow down to a database NOT NULL diagnostic.
      if (existing === undefined || options.fullRow === true || supplied(field)) {
        domainError("reference_wrong_account", message);
      }
      return;
    }
    need(field, table, message);
  };
  switch (key) {
    case "projects":
      needRequired("clientId", "clients", "Project must reference a client in this company.");
      break;
    case "phases":
      needRequired("projectId", "projects", "Phase must reference a project in this company.");
      break;
    case "activities": {
      // Activity.kind coherence, checked first: a project-specific ('project') activity MUST carry a project; an
      // internal/all-projects ('repeatable') activity is project-less by definition, so it may carry NEITHER a
      // project nor a phase. (Only enforced when kind is present — a partial patch that doesn't
      // touch kind is validated against the merged row by the store, which always has it.)
      if (present("kind")) {
        const kind = record.kind;
        if (kind === "project") {
          if (!present("projectId")) {
            domainError("activity_project_required", "A project-specific activity must be assigned to a project.");
          }
        } else if (kind === "internal" || kind === "repeatable") {
          if (present("projectId")) {
            domainError(
              "activity_project_forbidden",
              "An internal or all-projects activity cannot belong to a project.",
            );
          }
          if (present("phaseId")) {
            domainError("activity_phase_forbidden", "An internal or all-projects activity cannot belong to a phase.");
          }
        }
      }
      need("projectId", "projects", "Activity must reference a project in this company.");
      // A phase belongs to exactly one project, so an activity's phase must be a phase OF
      // the activity's own project — otherwise the activity is silently double-bound to two
      // projects, and deleting the phase's project orphans the activity's phaseId.
      // Skipped when BOTH ids are unchanged from the stored row: the pair was proven coherent
      // at its own write time, and in server mode a phase under an archived project may be
      // absent from the active-only slice (same rationale as `unchanged` above). Touching
      // EITHER id re-runs the full coherence check.
      const phasePairUnchanged = unchanged("phaseId") && unchanged("projectId");
      // Resolve the phase ONCE for BOTH arms below: whether it resolves in-account is the "belong to
      // this company" failure (the same check `need` would do), and its projectId feeds the coherence
      // check — no second scan of data.phases. An absent/null phaseId resolves to undefined without
      // any lookup, so hoisting costs a non-phase write nothing.
      const phase =
        typeof record.phaseId === "string"
          ? (resolveValidationRow({ data, table: "phases", id: record.phaseId, ...lookupOptions }) as
              AppData["phases"][number] | undefined)
          : undefined;
      const ownedPhase = phase && belongsToAccount(phase, accountId) ? phase : undefined;
      if (present("phaseId") && phasePairUnchanged) {
        // An archived phase may be absent from an active-only client slice, but a phase that DOES
        // resolve must still belong to this account. Legacy cross-account state is not trusted merely
        // because both stored ids are unchanged.
        if (phase && !ownedPhase) {
          domainError("activity_phase_wrong_account", "Activity phase must belong to this company.");
        }
      } else if (present("phaseId")) {
        if (!ownedPhase) {
          domainError("activity_phase_wrong_account", "Activity phase must belong to this company.");
        }
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
      break;
    }
    case "resources": {
      // A project binding belongs only to placeholders. Check the merged pair whenever this write
      // touches either side, so converting a bound placeholder or assigning a project to a person /
      // external resource is rejected, while an unrelated edit can still repair legacy corruption.
      const mergedKind = supplied("kind") ? record.kind : previous?.kind;
      const mergedProjectId = supplied("projectId") ? record.projectId : previous?.projectId;
      if (
        (supplied("kind") || supplied("projectId")) &&
        mergedProjectId !== undefined &&
        mergedProjectId !== null &&
        mergedKind !== undefined &&
        mergedKind !== null &&
        mergedKind !== "placeholder"
      ) {
        domainError("resource_project_forbidden", "Only a placeholder can be assigned to a project.");
      }
      // disciplineId applies to any resource; projectId is the placeholder-only binding FK (see
      // Resource.projectId) — both optional, so need() only fires when present.
      need("disciplineId", "disciplines", "Resource discipline must belong to this company.");
      need("projectId", "projects", "Placeholder project must belong to this company.");
      break;
    }
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
export function assertAllocationRefs(
  data: AppData,
  accountId: ID,
  resourceId: ID,
  activityId: ID,
  hoursPerDay: number,
  projectId?: ID,
  existing?: Pick<Allocation, "resourceId" | "activityId" | "projectId">,
  lookup?: ValidationDataLookup,
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
  // A project-bound activity must resolve to a project in this account. Normally assertScopedRefs
  // and the database FK make this impossible, but this validator is also the last line of defence
  // for legacy/corrupt state. Treat a missing or cross-account project exactly like an inactive
  // one instead of silently accepting the allocation because `project` resolved to undefined.
  if (
    (resolvedProjectId !== undefined && project === undefined) ||
    (existing?.projectId !== projectId &&
      project !== undefined &&
      !isEffectivelyActive({ data, table: "projects", row: project, ...lookupOptions }))
  ) {
    domainError(
      "allocation_project_inactive",
      "Allocation must reference an activity under an active project in this company.",
    );
  }
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
