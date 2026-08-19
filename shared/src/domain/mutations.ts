import { newId } from "../lib/id";
import {
  allocationAttributionAllowed,
  effectiveProjectId,
  validateAllocationAssignment,
  validateDateRange,
  type ValidationResult,
} from "../lib/integrity";
import { sanitizeImportedRecord } from "../lib/sanitizeImport";
import {
  buildInternalClient,
  internalClientFor,
  INTERNAL_CLIENT_COLOR,
  INTERNAL_CLIENT_NAME,
} from "../data/internalClient";
import { belongsToAccount, notInAccount } from "./tenancy";
import { domainError, type DomainErrorCode } from "./errors";
import {
  inspectLifecycleAncestry,
  lifecycleStatus,
  obfuscateResource,
  type LifecycleAncestryRow,
  type LifecycleFields,
} from "./lifecycle";
import { isExternalResource, SCOPED_KEYS, scopedTables } from "../types/entities";
import type {
  Allocation,
  AppData,
  AppDataKey,
  ID,
  ISODate,
  ISOTimestamp,
  Resource,
  ScopedEntity,
  ScopedEntityKey,
  Activity,
  TimeOff,
} from "../types/entities";

/**
 * Optional indexed view used by server batch validation. The browser/store callers keep using the
 * AppData arrays directly; a large transaction can supply these point/reverse lookups so applying
 * many operations does not repeatedly scan the same account slice.
 */
export interface ValidationDataLookup {
  row(table: AppDataKey, id: ID): (Record<string, unknown> & { id: ID }) | undefined;
  allocationsForResource(accountId: ID, resourceId: ID): readonly Allocation[];
  allocationsForActivity(accountId: ID, activityId: ID): readonly Allocation[];
  resourceHasLoadedAllocation(accountId: ID, resourceId: ID): boolean;
  resourceHasTimeOff(accountId: ID, resourceId: ID): boolean;
}

const validationRow = (
  data: AppData,
  table: AppDataKey,
  id: ID,
  lookup?: ValidationDataLookup,
): (Record<string, unknown> & { id: ID }) | undefined => {
  if (lookup) return lookup.row(table, id);
  return (data[table] as unknown as (Record<string, unknown> & { id: ID })[]).find((row) => row.id === id);
};

/** Fetch a row and narrow it to THIS account in one step. An ABSENT row and a CROSS-ACCOUNT row both
 * read as `undefined`, so every caller keeps its own domain-specific rejection message. */
const ownedRow = <T extends ScopedEntity>(
  data: AppData,
  table: AppDataKey,
  id: ID,
  accountId: ID,
  lookup?: ValidationDataLookup,
): T | undefined => {
  const row = validationRow(data, table, id, lookup) as T | undefined;
  return row && belongsToAccount(row, accountId) ? row : undefined;
};

/** The account's allocations on ONE end of the pair, beside {@link validationRow}: the indexed
 * server-batch lookup when a large transaction supplies one, otherwise a scan of the local array. */
const validationAllocationsFor = (
  data: AppData,
  accountId: ID,
  side: "resource" | "activity",
  id: ID,
  lookup?: ValidationDataLookup,
): readonly Allocation[] => {
  if (lookup) {
    return side === "resource"
      ? lookup.allocationsForResource(accountId, id)
      : lookup.allocationsForActivity(accountId, id);
  }
  return data.allocations.filter(
    (allocation) =>
      belongsToAccount(allocation, accountId) &&
      (side === "resource" ? allocation.resourceId : allocation.activityId) === id,
  );
};

/** `codes[0]`/`errors[0]` are guaranteed present: every validator sets ok=false and pushes a message
 * in the same step, so `!v.ok` always implies non-empty arrays. (Documented coupling between
 * ValidationResult.ok and errors — don't split the two without revisiting this read.) */
const throwIfInvalid = (v: ValidationResult): void => {
  if (!v.ok) domainError(v.codes[0], v.errors[0]);
};

/** Match normal-read lifecycle closure at the shared active-write boundary. Indexed server batch
 * callers retain O(depth) point lookups; browser/store callers traverse the same bounded graph over
 * their local arrays. Missing/cross-account parents return false and keep each caller's existing
 * domain-specific validation message. */
const isEffectivelyActive = (
  data: AppData,
  table: AppDataKey,
  row: LifecycleFields & { id: ID },
  lookup?: ValidationDataLookup,
): boolean =>
  lifecycleStatus(row) === "active" &&
  inspectLifecycleAncestry(
    table,
    // The ONE named seam for the single cast the ancestry walk needs: an interface-typed entity
    // carries no implicit index signature, so TypeScript can't see it as the loose
    // LifecycleAncestryRow the walk reads by field name. Every field the walk touches
    // (id / accountId / tombstones / FK ids) is present on these rows.
    row as unknown as LifecycleAncestryRow,
    (parentTable, id) => validationRow(data, parentTable, id, lookup) as LifecycleAncestryRow | undefined,
  ).visible;

// Pure, environment-agnostic domain mutations + integrity assertions extracted
// from the Zustand store so the SAME logic can run on a future server (and be
// unit-tested once, against both). Nothing here touches React / Zustand / DOM /
// browser persistence. The store stays the orchestrator: it resolves the active account
// and owns the clock (id/createdAt/updatedAt); these functions validate refs and
// compute the next AppData. All cascade/transform helpers return a NEW AppData.
//
// Account resolution itself (the "no active account" guard) deliberately stays in
// the store — it reads live UI state. Every function here takes `accountId`
// explicitly so it has no ambient dependency.

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
  const row = (data[key] as ScopedEntity[]).find((e) => e.id === id);
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
  rec: Record<string, unknown>,
  existing?: ScopedEntity | Record<string, unknown>,
  lookup?: ValidationDataLookup,
  options: { fullRow?: boolean } = {},
): void {
  const present = (field: string) => rec[field] !== undefined && rec[field] !== null;
  const supplied = (field: string) => Object.prototype.hasOwnProperty.call(rec, field);
  // Reading loose field names off the stored row is safe — an absent field is undefined, which can
  // only ever equal an equally-absent patch field (a no-op skip). The widened accepted type lets
  // call sites pass a typed entity (interfaces lack the implicit index signature) without a copy.
  const prev = existing as Record<string, unknown> | undefined;
  // Unchanged-on-update: see the doc comment — an id identical to the stored row's was
  // already proven in-account at its own write time.
  const unchanged = (field: string) => prev !== undefined && rec[field] === prev[field];
  const inAccount = (table: ScopedEntityKey, id: unknown): boolean => {
    if (typeof id !== "string") return false;
    const entity = validationRow(data, table, id, lookup) as ScopedEntity | undefined;
    return (
      entity !== undefined && belongsToAccount(entity, accountId) && isEffectivelyActive(data, table, entity, lookup)
    );
  };
  const need = (field: string, table: ScopedEntityKey, msg: string) => {
    if (!present(field)) return;
    if (unchanged(field)) {
      const id = rec[field];
      const resolved = typeof id === "string" ? validationRow(data, table, id, lookup) : undefined;
      if (resolved === undefined || belongsToAccount(resolved as unknown as ScopedEntity, accountId)) return;
      domainError("reference_wrong_account", msg);
    }
    if (!inAccount(table, rec[field])) domainError("reference_wrong_account", msg);
  };
  const needRequired = (field: string, table: ScopedEntityKey, msg: string) => {
    if (!present(field)) {
      // Only an omitted field on a genuine partial update inherits its stored parent. Creates and
      // full server rows must be self-contained; an explicitly supplied null/undefined is a clear
      // attempt and must not flow down to a database NOT NULL diagnostic.
      if (existing === undefined || options.fullRow === true || supplied(field)) {
        domainError("reference_wrong_account", msg);
      }
      return;
    }
    need(field, table, msg);
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
        const kind = rec.kind;
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
        typeof rec.phaseId === "string"
          ? (validationRow(data, "phases", rec.phaseId, lookup) as AppData["phases"][number] | undefined)
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
        if (ownedPhase.projectId !== rec.projectId) {
          domainError("activity_phase_project_mismatch", "Activity phase must belong to the activity’s project.");
        }
      }
      break;
    }
    case "resources": {
      // A project binding belongs only to placeholders. Check the merged pair whenever this write
      // touches either side, so converting a bound placeholder or assigning a project to a person /
      // external resource is rejected, while an unrelated edit can still repair legacy corruption.
      const mergedKind = supplied("kind") ? rec.kind : prev?.kind;
      const mergedProjectId = supplied("projectId") ? rec.projectId : prev?.projectId;
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
  const resource = ownedRow<Resource>(data, "resources", resourceId, accountId, lookup);
  const activity = ownedRow<Activity>(data, "activities", activityId, accountId, lookup);
  if (!resource || !activity) {
    domainError(
      "allocation_references_invalid",
      "Allocation must reference an existing resource and activity in this company.",
    );
  }
  if (existing?.resourceId !== resourceId && !isEffectivelyActive(data, "resources", resource, lookup)) {
    domainError("allocation_resource_inactive", "Allocation must reference an active resource in this company.");
  }
  if (projectId !== undefined && !allocationAttributionAllowed(activity.kind)) {
    domainError(
      "allocation_project_forbidden",
      "Only an all-projects activity allocation can be attributed to a project.",
    );
  }
  const resolvedProjectId = effectiveProjectId({ projectId }, activity);
  const project = resolvedProjectId
    ? ownedRow<AppData["projects"][number]>(data, "projects", resolvedProjectId, accountId, lookup)
    : undefined;
  // A project-bound activity must resolve to a project in this account. Normally assertScopedRefs
  // and the database FK make this impossible, but this validator is also the last line of defence
  // for legacy/corrupt state. Treat a missing or cross-account project exactly like an inactive
  // one instead of silently accepting the allocation because `project` resolved to undefined.
  if (
    (resolvedProjectId !== undefined && project === undefined) ||
    (existing?.projectId !== projectId &&
      project !== undefined &&
      !isEffectivelyActive(data, "projects", project, lookup))
  ) {
    domainError(
      "allocation_project_inactive",
      "Allocation must reference an activity under an active project in this company.",
    );
  }
  if (existing?.activityId !== activityId && !isEffectivelyActive(data, "activities", activity, lookup)) {
    domainError("allocation_activity_inactive", "Allocation must reference an activity under an active project.");
  }
  throwIfInvalid(validateAllocationAssignment(resource, resolvedProjectId));
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
        : { ...allocation, projectId: undefined };
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

/**
 * Cascade-drop an account and every scoped entity belonging to it. Returns a new
 * AppData (mutating a fresh copy in place — scopedTables returns the same ref).
 */
export function deleteAccountCascade(data: AppData, accountId: ID): AppData {
  const next: AppData = {
    ...data,
    accounts: data.accounts.filter((a) => a.id !== accountId),
  };
  const src = scopedTables(data);
  const dst = scopedTables(next);
  for (const key of SCOPED_KEYS) {
    dst[key] = src[key].filter(notInAccount(accountId));
  }
  return next;
}

/**
 * Replace the active account's slice with an imported dataset. Imported entities
 * keep their relationships but are given FRESH ids (an exported file carries the
 * source account's ids; the store matches entities by id GLOBALLY, so a shared id
 * would let an edit in one account silently rewrite another's row). Value-level
 * fields are repaired (the import path bypasses the form validators) and every
 * referential rule the store/server enforce is applied: a record whose REQUIRED
 * foreign key dangles after remap is dropped, a dangling OPTIONAL key is unbound,
 * and allocations / time-off with a broken range or placeholder-rule violation are
 * dropped. This matters doubly for the server import path — a leftover dangling ref
 * would be rejected by SQLite's foreign keys and fail the whole import. Returns the
 * next AppData plus how many records landed vs. were skipped. `incoming` must be a structurally
 * complete AppData produced by the transfer parser/migrator; a non-array scoped table fails loudly
 * here as defence in depth instead of disappearing from both counters.
 */
export function remapAndValidateImport(
  data: AppData,
  accountId: ID,
  incoming: AppData,
  now: ISOTimestamp,
): { data: AppData; imported: number; skipped: number } {
  for (const key of SCOPED_KEYS) {
    if (!Array.isArray(incoming[key])) throw new TypeError(`Imported ${key} table must be a list.`);
  }
  const incomingRows = Object.fromEntries(
    SCOPED_KEYS.map((key) => {
      const rows = incoming[key] as unknown[];
      return [
        key,
        rows.filter((row): row is Record<string, unknown> => !!row && typeof row === "object" && !Array.isArray(row)),
      ];
    }),
  ) as Record<ScopedEntityKey, Array<Record<string, unknown>>>;
  const malformedIncoming = SCOPED_KEYS.reduce(
    (count, key) => count + (incoming[key].length - incomingRows[key].length),
    0,
  );
  // FK remap tables, ONE PER ENTITY TYPE. A source id is only meaningful within its own
  // table, so a single GLOBAL map keyed on the bare id string would let a CROSS-TABLE id
  // collision (two records in different tables that corruptly share an id) misroute every
  // FK pointing at one of them — silently dropping the referencing record and its subtree.
  // Per-table maps resolve each FK against the table it actually references. FIRST
  // occurrence within a table wins; a record with a missing/non-string id is NOT keyed
  // (keying on `undefined` would collapse them all) — it gets a fresh id below.
  const idMaps = Object.fromEntries(SCOPED_KEYS.map((k) => [k, new Map<ID, ID>()])) as Record<
    ScopedEntityKey,
    Map<ID, ID>
  >;
  for (const key of SCOPED_KEYS) {
    for (const e of incomingRows[key]) {
      if (typeof e.id === "string" && !idMaps[key].has(e.id)) idMaps[key].set(e.id, newId());
    }
  }
  // Each foreign-key field points at exactly one table, so a ref is remapped via THAT
  // table's id map (a dangling ref — absent from the map — is left as-is, repaired below).
  // Type annotation ensures every value is a valid ScopedEntityKey — a typo or a
  // renamed table fails the type-check here rather than silently remapping to undefined.
  const FK_TARGET: Record<string, ScopedEntityKey> = {
    disciplineId: "disciplines",
    projectId: "projects",
    clientId: "clients",
    phaseId: "phases",
    resourceId: "resources",
    activityId: "activities",
  };
  const FK_FIELDS = Object.keys(FK_TARGET);
  const remap = (field: string, ref: unknown): unknown => {
    const m = idMaps[FK_TARGET[field]];
    return typeof ref === "string" && m.has(ref) ? m.get(ref) : ref;
  };

  // Remap every incoming scoped entity into the active account, then repair its
  // value-level fields (enums / numerics / colour). Keep them as loose records so
  // the referential pass below can null a dangling optional FK in place. Each record
  // gets its OWN fresh id: the first record bearing a given source id reuses the
  // FK-map's id (so references land on it), but a later DUPLICATE gets a brand-new id
  // so two rows can never collide on one primary key. Timestamps are stamped fresh
  // (`now`) — these records are newly created in this account, and a file missing
  // createdAt/updatedAt must not reach a server whose columns are NOT NULL.
  const usedIds = new Set<ID>();
  const brought: Record<string, Array<Record<string, unknown>>> = {};
  for (const key of SCOPED_KEYS) {
    const ownIds = idMaps[key];
    brought[key] = incomingRows[key].map((e) => {
      // `ownIds.get(e.id) as ID` is sound: the FIRST loop above seeded this table's map with a
      // fresh id for EVERY record bearing a string id, so any record reaching here with a string
      // id is guaranteed to have an entry. A missing/non-string id falls to a fresh newId().
      const mapped = typeof e.id === "string" ? (ownIds.get(e.id) as ID) : newId();
      const newRecordId = usedIds.has(mapped) ? newId() : mapped;
      usedIds.add(newRecordId);
      const copy: Record<string, unknown> = {
        ...e,
        id: newRecordId,
        accountId,
        createdAt: now,
        updatedAt: now,
      };
      for (const f of FK_FIELDS) {
        if (copy[f] !== undefined) copy[f] = remap(f, copy[f]);
      }
      const sanitized = sanitizeImportedRecord(key, copy);
      if (key === "resources" && sanitized.deletedAt !== undefined) {
        return obfuscateResource(sanitized as unknown as Resource) as unknown as Record<string, unknown>;
      }
      return sanitized;
    });
  }

  // Referential repair, parent-before-child so a child sees the SURVIVING parent set
  // (a parent dropped here drops its now-orphaned children too). Generally, a required FK that
  // dangles drops the record and an optional FK is unbound so the record survives. Import is a
  // recovery boundary rather than a database delete, so one deliberate exception preserves more
  // user data than the schema's CASCADE: a project activity whose project is absent survives as a
  // project-less repeatable activity (and loses its phase), as documented again in that pass below.
  // Every repair keeps a hand-edited file from reaching SQLite with an invalid reference.
  const idSet = (rows: Array<Record<string, unknown>>) => new Set(rows.map((r) => r.id as string));
  const has = (set: Set<string>, v: unknown): boolean => typeof v === "string" && set.has(v);

  // Built-in "Internal" client: every account must have EXACTLY ONE (seed / addAccount / migrate
  // guarantee it). This is the IMPORT-FOLD enforcement point (2) of the single-Internal invariant —
  // see the canonical doc in ../data/internalClient.ts (the other two points are store strip + server
  // reject). Import REPLACES the account's whole slice (the kept-existing rows are filtered out
  // below), so we can't just keep the pre-existing Internal — it would be wiped, and a bulk replace
  // can't reject. Normalise the imported builtins to AT MOST one here (keep-first + fold-the-rest),
  // then `ensureInternalClients` (a post-step, after counting)
  // synthesises one if the file carried none — so an auto-added Internal is never counted toward
  // `imported`. The normalisation:
  //   • keep the FIRST imported builtin (the per-record sanitizer re-stamps its name/colour and
  //     clears impossible lifecycle tombstones), and remap every OTHER imported builtin's id to
  //     that kept one (so anything they owned re-points at the single Internal).
  const remappedBuiltinId = new Map<string, string>();
  let keptInternalId: string | undefined;
  brought.clients = brought.clients.filter((c) => {
    if (c.builtin !== true) return true;
    if (keptInternalId === undefined) {
      keptInternalId = c.id as string;
      c.name = INTERNAL_CLIENT_NAME;
      c.color = INTERNAL_CLIENT_COLOR;
      return true; // this row becomes the account's single Internal
    }
    remappedBuiltinId.set(c.id as string, keptInternalId); // a duplicate builtin → fold into the kept one
    return false;
  });
  // Re-point any FK that pointed at a folded-away imported builtin client at the single kept Internal
  // (projects.clientId is the only client FK). Done before the required-FK drop so the project keeps a
  // valid client and survives.
  const rewireBuiltin = (v: unknown): unknown =>
    typeof v === "string" && remappedBuiltinId.has(v) ? remappedBuiltinId.get(v) : v;
  for (const p of brought.projects) p.clientId = rewireBuiltin(p.clientId);

  const clientIds = idSet(brought.clients);
  const disciplineIds = idSet(brought.disciplines);

  // projects.clientId is REQUIRED → drop a project whose client didn't survive.
  brought.projects = brought.projects.filter((p) => has(clientIds, p.clientId));
  const projectIds = idSet(brought.projects);

  // phases.projectId is REQUIRED → drop a phase whose project didn't survive.
  brought.phases = brought.phases.filter((ph) => has(projectIds, ph.projectId));
  const phaseIds = idSet(brought.phases);

  // resources: disciplineId / placeholder projectId are OPTIONAL → unbind if dangling.
  for (const r of brought.resources) {
    if (r.disciplineId !== undefined && !has(disciplineIds, r.disciplineId)) r.disciplineId = undefined;
    if (r.projectId !== undefined && !has(projectIds, r.projectId)) r.projectId = undefined;
  }

  // activities: keep kind ⇆ projectId/phaseId coherent (assertScopedRefs throws on a mismatch, and
  // import bypasses it). An internal/all-projects activity is project-less — strip any project/phase it
  // carries. A project-specific activity whose project didn't survive can no longer BE project-specific, so it
  // becomes 'repeatable' (and loses its now-orphaned phase). A surviving phase that belongs to a
  // DIFFERENT project is unbound — an activity's phase must be a phase of the activity's own project.
  const phaseProject = new Map(brought.phases.map((p) => [p.id as string, p.projectId]));
  for (const act of brought.activities) {
    if (act.kind === "internal" || act.kind === "repeatable") {
      act.projectId = undefined;
      act.phaseId = undefined;
      continue;
    }
    if (act.projectId !== undefined && !has(projectIds, act.projectId)) act.projectId = undefined;
    if (act.projectId === undefined) {
      act.phaseId = undefined;
      act.kind = "repeatable";
    } else if (
      act.phaseId !== undefined &&
      (!has(phaseIds, act.phaseId) || phaseProject.get(act.phaseId as string) !== act.projectId)
    ) {
      act.phaseId = undefined;
    }
  }

  // allocations / time-off: resource + activity are REQUIRED. Repair invalid optional attribution
  // before enforcing the effective-project placeholder rule; a booking is dropped only when an
  // independent required-reference, range or assignment invariant still fails.
  // The `as unknown as <Entity>[]` casts in this block are sound: every row in `brought[*]` was
  // just produced by sanitizeImportedRecord (value-level fields coerced to their typed shape) and
  // stamped with id/accountId/timestamps, so reading them as typed entities for the referential
  // checks below is safe. Results are cast back to loose records afterwards so a dangling optional
  // FK can still be nulled in place. Field-level safety lives in sanitize/validate — NOT the cast.
  const resources = new Map((brought.resources as unknown as Resource[]).map((r) => [r.id, r]));
  const activities = new Map((brought.activities as unknown as Activity[]).map((act) => [act.id, act]));
  const projectById = new Map(brought.projects.map((project) => [project.id, project]));
  // Single pass: resolve the owning resource ONCE per allocation and use it for BOTH the keep/drop
  // decision (date range + resource/activity existence + placeholder rule) AND the external-load
  // coercion below, so the two can never diverge.
  brought.allocations = (brought.allocations as unknown as Allocation[]).reduce<Allocation[]>((kept, a) => {
    if (!validateDateRange(a.startDate, a.endDate).ok) return kept;
    const resource = resources.get(a.resourceId);
    const activity = activities.get(a.activityId);
    if (!resource || !activity) return kept;
    let repaired = a;
    const attributedProject = a.projectId === undefined ? undefined : projectById.get(a.projectId);
    const invalidAttribution =
      a.projectId !== undefined &&
      (!allocationAttributionAllowed(activity.kind) ||
        attributedProject === undefined ||
        attributedProject.accountId !== accountId ||
        !validateAllocationAssignment(resource, a.projectId).ok);
    if (invalidAttribution) repaired = { ...a, projectId: undefined };
    if (!validateAllocationAssignment(resource, effectiveProjectId(repaired, activity)).ok) return kept;
    // An external resource's allocations carry NO load (the form forces hoursPerDay 0). Import is
    // the one write path that bypasses the form, and sanitizeImportedRecord is per-record so it
    // can't see the owning resource's kind — coerce it here, where the whole resource set is in
    // scope, so a hand-edited/legacy file can't land a non-zero load on a capacity-free resource.
    repaired = isExternalResource(resource) && repaired.hoursPerDay !== 0 ? { ...repaired, hoursPerDay: 0 } : repaired;
    // Resource deletion is an erasure boundary, not only a display-name transition. The normal
    // lifecycle route clears dependent free text; apply the same repair to legacy, restored or
    // hand-edited imports so a tombstone cannot reintroduce private project context.
    if (resource.deletedAt !== undefined && repaired.note !== undefined) {
      repaired = { ...repaired, note: undefined };
    }
    kept.push(repaired);
    return kept;
  }, []) as unknown as Array<Record<string, unknown>>;
  brought.timeOff = (brought.timeOff as unknown as TimeOff[]).reduce<TimeOff[]>((kept, t) => {
    if (!validateDateRange(t.startDate, t.endDate).ok) return kept;
    // Drop time off on an external / 3rd-party resource: they have no capacity, so the store / server
    // reject it at the write boundary (assertResourceExists) and the scheduler hides it. Applying the
    // same rule here keeps import from landing an invisible orphan a hand-edited file could carry.
    const resource = resources.get(t.resourceId);
    if (resource === undefined || isExternalResource(resource)) return kept;
    // Medical/absence detail is the most sensitive dependent free text. Match the lifecycle delete
    // path by retaining the valid scheduling record while removing its note for a deleted person.
    kept.push(resource.deletedAt !== undefined && t.note !== undefined ? { ...t, note: undefined } : t);
    return kept;
  }, []) as unknown as Array<Record<string, unknown>>;
  brought.closures = (brought.closures as unknown as AppData["closures"]).filter(
    (closure) => validateDateRange(closure.startDate, closure.endDate).ok,
  ) as unknown as Array<Record<string, unknown>>;

  const next: AppData = { ...data };
  const srcKept = scopedTables(data);
  const dst = scopedTables(next);
  // Count only NON-builtin clients toward `imported`: the built-in Internal is infrastructure (every
  // account has exactly one regardless of the file), so a kept/folded/synthesised Internal must never
  // inflate "imported N". This also fixes the over-report when a pre-v6 FULL export was given a builtin
  // by migrate (run before this import) — that auto-added row reaches here as a kept builtin, and must
  // still not count. The matching `totalIncoming` below excludes incoming builtins for the same reason.
  const countable = (key: ScopedEntityKey, rows: ReadonlyArray<Record<string, unknown>>): number =>
    key === "clients" ? rows.filter((c) => c.builtin !== true).length : rows.length;
  let imported = 0;
  for (const key of SCOPED_KEYS) {
    const kept = srcKept[key].filter(notInAccount(accountId));
    dst[key] = [...kept, ...(brought[key] as unknown as ScopedEntity[])];
    imported += countable(key, brought[key]);
  }
  // Post-step (AFTER counting): guarantee the ACTIVE account ends with exactly one built-in Internal.
  // Import only replaces the active account's slice, so scope the ensure to it (every OTHER account
  // keeps its own Internal untouched — and import must not mint Internals for accounts it didn't
  // touch). Idempotent — a no-op when the kept-first path above already left a builtin for this
  // account; it only synthesises one when the file carried none. Counting is already done, so a
  // synthesised Internal is never counted. This is `ensureInternalClients` (the canonical "exactly one
  // Internal per account" algorithm) narrowed to a single account.
  const result = internalClientFor(next.clients, accountId)
    ? next
    : {
        ...next,
        clients: [...next.clients, buildInternalClient(accountId, now)],
      };
  // Everything that didn't land — a dropped parent, child, allocation or time-off — counts as skipped
  // (records merely unbound from a dangling optional FK still land). Incoming builtins are excluded
  // from BOTH sides so the auto-added Internal never shows up as imported or skipped.
  const totalIncoming = SCOPED_KEYS.reduce((n, key) => n + countable(key, incomingRows[key]), malformedIncoming);
  return { data: result, imported, skipped: totalIncoming - imported };
}
