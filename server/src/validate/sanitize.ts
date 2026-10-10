import { isLifecycleEntityKey } from "@capacitylens/shared/domain/lifecycle";
import { hasUsablePrivateCodeName } from "@capacitylens/shared/domain/privateNames";
import { snapToPresetColor } from "@capacitylens/shared/lib/color";
import { sanitizeAccount, sanitizeImportedRecord } from "@capacitylens/shared/lib/sanitizeImport";
import { cleanText } from "@capacitylens/shared/lib/strings";
import { parseResourceAvatarUrl } from "@capacitylens/shared/domain/resourceAvatarUrl";
import type { ScopedEntityKey } from "@capacitylens/shared/types/entities";
import {
  CAPACITY_OVERVIEW_ACCESS_VALUES,
  isScopedEntityKey,
  SCHEDULING_MODES,
} from "@capacitylens/shared/types/entities";
import { pinGatedFields } from "../fieldPolicy";
import type { SanitizeWriteOptions } from "../fieldPolicy";
import { TABLES } from "../tables";
import { assertIdPresent, ValidationError } from "./errors";
import { buildAcceptedWriteFields } from "./fields";
import { assertStrictWriteFields } from "./strict";
/** Account calendar/locale facts become immutable after their first valid stored value. */
export const IMMUTABLE_ACCOUNT_FIELDS = ["language", "weekStartsOn", "timezone"] as const;

/** Required domain values the import sanitiser is allowed to invent, but a direct API writer must
 * supply explicitly. Referential fields remain with validateWrite so callers retain its precise
 * domain error codes and messages. */
const DIRECT_WRITE_REQUIRED_FIELDS: Partial<Record<ScopedEntityKey, readonly string[]>> = {
  disciplines: ["name", "sortOrder"],
  resources: ["kind", "role", "employmentType", "workingHoursPerDay", "workingDays", "color"],
  clients: ["name", "color"],
  projects: ["name", "color"],
  phases: ["name"],
  activities: ["name", "kind"],
  allocations: ["hoursPerDay", "status"],
  timeOff: ["resourceId", "type"],
  closures: ["name"],
};

interface SanitizeWriteInput {
  table: string;
  row: Record<string, unknown>;
  existing?: Record<string, unknown> | undefined;
  options?: SanitizeWriteOptions | undefined;
  requested?: Record<string, unknown> | undefined;
}

function resolveStoredWeekStart(existing: Record<string, unknown> | undefined): 0 | 1 | undefined {
  if (existing?.weekStartsOn === 0) return 0;
  if (existing?.weekStartsOn === 1) return 1;
  return undefined;
}

type PreserveCapacityOverviewAccessOptions = {
  copy: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
  canChange: boolean | undefined;
};
function preserveCapacityOverviewAccess({ copy, existing, canChange }: PreserveCapacityOverviewAccessOptions): void {
  if (canChange === true) return;
  const storedAccess = existing?.capacityOverviewAccess;
  if (CAPACITY_OVERVIEW_ACCESS_VALUES.includes(storedAccess as never)) copy.capacityOverviewAccess = storedAccess;
  else delete copy.capacityOverviewAccess;
}

function sanitizeAccountWrite(
  copy: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
  options: SanitizeWriteOptions,
): Record<string, unknown> {
  const workingDaysRequested = Object.hasOwn(copy, "workingDays");
  // Keep historical stored colours on the preset palette; strict validation already rejected
  // malformed colours supplied by an ordinary writer.
  copy.color = snapToPresetColor(copy.color);
  if (typeof copy.name === "string") copy.name = cleanText(copy.name);
  // Legacy stored modes may need repair; ordinary supplied values were already validated.
  if (copy.schedulingMode !== undefined && !SCHEDULING_MODES.includes(copy.schedulingMode as never)) {
    delete copy.schedulingMode;
  }
  // The stored week start feeds the empty-workingDays repair: weekStartsOn is immutable and only
  // restored onto the copy after sanitisation (see the loop below), so without this a payload
  // omitting it would repair a Sunday-start account's week to the Monday-start default.
  sanitizeAccount(copy, resolveStoredWeekStart(existing));
  preserveCapacityOverviewAccess({
    copy: copy,
    existing: existing,
    canChange: options.canChangeCapacityOverviewAccess,
  });
  // A full PUT from a pre-v31 client cannot express this field. Preserve the stored selection
  // when it was omitted; strict validation rejects a malformed supplied value before this pass.
  if (!workingDaysRequested && existing?.workingDays !== undefined) {
    copy.workingDays = existing.workingDays;
  }
  // Frozen account values are write-once, but old/API-created rows may legitimately have no
  // value yet. Preserve an existing value when a PUT omits it; strict validation rejects a
  // malformed supplied value before this pass, and the route guard rejects a changed valid value.
  if (existing) {
    for (const field of IMMUTABLE_ACCOUNT_FIELDS) {
      if (copy[field] === undefined && existing[field] !== undefined) {
        copy[field] = existing[field];
      }
    }
  }
  return copy;
}

function pinLifecycleFields(
  table: ScopedEntityKey,
  cleaned: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
): void {
  if (!isLifecycleEntityKey(table)) return;
  if (typeof existing?.archivedAt === "string") cleaned.archivedAt = existing.archivedAt;
  else delete cleaned.archivedAt;
  if (typeof existing?.deletedAt === "string") cleaned.deletedAt = existing.deletedAt;
  else delete cleaned.deletedAt;
}

interface SanitizeScopedWriteInput {
  table: ScopedEntityKey;
  copy: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
  options: SanitizeWriteOptions;
}

// eslint-disable-next-line complexity -- required fields vary by scoped entity and privacy authority.
function assertScopedWriteFields(
  table: ScopedEntityKey,
  copy: Record<string, unknown>,
  options: SanitizeWriteOptions,
): void {
  const missingRequired = (DIRECT_WRITE_REQUIRED_FIELDS[table] ?? []).filter((field) => !Object.hasOwn(copy, field));
  if (missingRequired.length > 0) {
    throw new ValidationError(`Missing required field(s): ${missingRequired.join(", ")}.`);
  }
  if (table === "resources" && copy.kind !== "placeholder" && !Object.hasOwn(copy, "name")) {
    throw new ValidationError("A person or external company name is required.");
  }
  if (table === "closures" && (typeof copy.name !== "string" || cleanText(copy.name).trim().length === 0)) {
    throw new ValidationError("Closure name is required.");
  }
  // Imports repair malformed private rows, but an ordinary owner write must never manufacture a
  // cover name silently. Check before the import sanitiser applies its fail-closed fallback.
  if (
    (table === "clients" || table === "projects") &&
    options.canSeePrivateNames !== false &&
    !hasUsablePrivateCodeName(copy)
  ) {
    throw new ValidationError("A private client or project requires a code name.");
  }
}

// This is the central preservation/normalisation boundary for every scoped table.
// eslint-disable-next-line complexity, max-lines-per-function -- canonicalization and preservation share one scoped boundary.
function sanitizeScopedWrite({ table, copy, existing, options }: SanitizeScopedWriteInput): Record<string, unknown> {
  if (table === "resources" && existing) {
    const validKinds: ReadonlySet<unknown> = new Set(["person", "placeholder", "external"]);
    if (typeof existing.kind !== "string" || !validKinds.has(existing.kind)) {
      throw new ValidationError("The stored resource kind is invalid and must be repaired by import.", {
        code: "resource_kind_immutable",
      });
    }
    if (copy.kind !== existing.kind) {
      throw new ValidationError("A resource’s kind cannot change after creation.", { code: "resource_kind_immutable" });
    }
  }
  // Availability boundaries use explicit-null clears in full-row PUTs. Capture presence before
  // canonicalization so the preservation pass distinguishes a clear from an omitted legacy field.
  const availabilityRequested =
    table === "resources"
      ? {
          firstAvailableDate: Object.hasOwn(copy, "firstAvailableDate"),
          lastAvailableDate: Object.hasOwn(copy, "lastAvailableDate"),
        }
      : undefined;
  if (table === "resources" && Object.hasOwn(copy, "avatarUrl") && copy.avatarUrl != null) {
    const parsed = parseResourceAvatarUrl(copy.avatarUrl);
    if (parsed === null) {
      throw new ValidationError("Avatar URL must be an HTTPS URL without embedded credentials.", {
        code: "resource_avatar_url_invalid",
      });
    }
    const resourceKind = typeof copy.kind === "string" ? copy.kind : existing?.kind;
    if (parsed !== undefined && resourceKind !== "person") {
      throw new ValidationError("Only a person can have an avatar URL.", { code: "resource_avatar_url_forbidden" });
    }
    copy.avatarUrl = parsed;
  }
  assertScopedWriteFields(table, copy, options);
  if (isLifecycleEntityKey(table)) {
    for (const field of ["archivedAt", "deletedAt"] as const) {
      if (Object.hasOwn(copy, field) && copy[field] !== existing?.[field]) {
        throw new ValidationError(`${field} is managed by its lifecycle action.`);
      }
    }
  }
  if (table === "allocations" && existing && Object.hasOwn(copy, "seriesId") && copy.seriesId !== existing.seriesId) {
    throw new ValidationError("seriesId is fixed after creation.");
  }
  const opaqueAllocationIds =
    table === "allocations" ? { projectId: copy.projectId, seriesId: copy.seriesId } : undefined;
  const cleaned = sanitizeImportedRecord(table, copy);
  if (opaqueAllocationIds) {
    // The import repair path cleans identifiers as text and mutates its input. Ordinary writes
    // have already validated these opaque IDs, so retain their exact bytes for relationship checks.
    for (const field of ["projectId", "seriesId"] as const) {
      if (typeof opaqueAllocationIds[field] === "string") cleaned[field] = opaqueAllocationIds[field];
    }
  }
  // Lifecycle tombstones (archivedAt/deletedAt) are owned only by the dedicated
  // archive/unarchive/delete/purge routes, which build rows via the pure lifecycle transitions and
  // persist them through AccountStore.writeLifecycleRow without passing through sanitizeWrite. So
  // Across generic writes, changed supplied values are rejected above; exact stored echoes and
  // omissions retain `existing`. New rows start active. Imports remain untouched because they use
  // sanitizeImportedRecord directly and legitimately round-trip tombstones.
  pinLifecycleFields(table, cleaned, existing);
  // Repeat-series membership is assigned only when an allocation is created. Generic PUT/PATCH
  // edits may omit the hidden field or echo its exact value; changed supplied values are rejected
  // above, so a generic edit cannot move an occurrence between series.
  if (table === "allocations" && existing) {
    if (typeof existing.seriesId === "string") cleaned.seriesId = existing.seriesId;
    else delete cleaned.seriesId;
  }
  if (table === "resources" && existing && cleaned.kind === "person") {
    for (const field of ["firstAvailableDate", "lastAvailableDate"] as const) {
      if (!availabilityRequested?.[field] && typeof existing[field] === "string") cleaned[field] = existing[field];
    }
  }
  // Field-confidentiality pins (note-erasure guard + private-name guard): the fields are
  // single-sourced in GATED_FIELD_POLICIES. A writer who cannot see a gated field has it pinned to
  // the stored value on UPDATE and stripped on CREATE; a writer who can see it passes it through.
  pinGatedFields({ table, cleaned, existing, options });
  return cleaned;
}

/**
 * Validate supplied fields before applying the shared canonicalization and
 * compatibility rules to a copy of the write body. Import repair remains a
 * separate path; ordinary writes cannot rely on it to fix malformed input.
 *
 * Also rejects any row whose id is not a non-empty string, the single funnel all
 * write paths flow through, so no path can slip past the NULL-id guard.
 *
 * `existing` is the currently-stored row (from getRow) on an UPDATE, PUT/PATCH/batch pass it so
 * the lifecycle tombstones (and, for a note-blind writer, the time-off `note`) can be pinned to
 * what's on disk (see the scoped branch); it is undefined on a CREATE (POST), which is why a new
 * row always starts with its tombstones stripped (active).
 *
 * `options` carries writer-context facts (see {@link SanitizeWriteOptions}); omit it entirely for
 * tables the options don't apply to.
 */
// eslint-disable-next-line complexity -- all ordinary-write tables meet at this validation boundary.
export function sanitizeWrite({
  table,
  row,
  existing,
  options = {},
  requested = row,
}: SanitizeWriteInput): Record<string, unknown> {
  assertIdPresent(row);
  if (table === "resources" && existing && requested.kind !== undefined && requested.kind !== existing.kind) {
    throw new ValidationError("A resource’s kind cannot change after creation.", { code: "resource_kind_immutable" });
  }
  assertStrictWriteFields({ table, requested, candidate: row, existing, options });
  if (table === "closures" && Object.hasOwn(row, "resourceId")) {
    throw new ValidationError("Company closures cannot reference a resource.");
  }
  const copy = buildAcceptedWriteFields(table, row);
  const nullRequiredFields =
    TABLES[table]?.columns.filter((column) => column.optional !== true && copy[column.name] === null) ?? [];
  if (nullRequiredFields.length > 0) {
    throw new ValidationError(
      `Required field(s) cannot be null: ${nullRequiredFields.map((column) => column.name).join(", ")}.`,
    );
  }
  if (table === "accounts") {
    if (typeof copy.name !== "string" || cleanText(copy.name).length === 0) {
      throw new ValidationError("Company name is required.");
    }
    return sanitizeAccountWrite(copy, existing, options);
  }
  if (isScopedEntityKey(table)) {
    return sanitizeScopedWrite({ table, copy, existing, options });
  }
  return copy;
}
