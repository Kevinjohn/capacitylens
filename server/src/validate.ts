import {
  INTERNAL_CLIENT_COLOR,
  INTERNAL_CLIENT_NAME,
  wouldAddSecondBuiltin,
} from "@capacitylens/shared/data/internalClient";
import { DomainError } from "@capacitylens/shared/domain/errors";
import {
  inspectLifecycleAncestry,
  isLifecycleEntityKey,
  type LifecycleAncestryLookup,
  type LifecycleAncestryRow,
} from "@capacitylens/shared/domain/lifecycle";
import {
  assertActivityProjectAllowsDependents,
  assertAllocationWithinResourceAvailability,
  assertAllocationRefs,
  assertDateRange,
  assertResourceExists,
  assertResourceKindAllowsDependents,
  assertResourceProjectAllowsDependents,
  validateResourceAvailabilityPair,
  assertScopedRefs,
  type ValidationDataLookup,
} from "@capacitylens/shared/domain/mutations";
import {
  APP_DATA_KEYS,
  isScopedEntityKey,
  type Activity,
  type Allocation,
  type AppData,
  type AppDataKey,
  type Resource,
  type TimeOff,
} from "@capacitylens/shared/types/entities";
import { normalizeAccountWorkingDays } from "@capacitylens/shared/lib/accountWorkingDays";
import { ValidationError } from "./validate/errors";
export { assertIdPresent, ValidationError } from "./validate/errors";
export { listAcceptedFieldNames, buildAcceptedWriteFields, listAppliedRequestedFieldNames } from "./validate/fields";
export { IMMUTABLE_ACCOUNT_FIELDS, sanitizeWrite } from "./validate/sanitize";
export type { SanitizeWriteOptions } from "./fieldPolicy";

interface AssertValidWriteInput {
  state: AppData;
  table: string;
  row: Record<string, unknown>;
  existing?: Record<string, unknown> | undefined;
  lookup?: ValidationDataLookup | undefined;
}

function isAppDataKey(table: string): table is AppDataKey {
  return APP_DATA_KEYS.some((key) => key === table);
}

function requireString(row: Record<string, unknown>, field: string): string {
  const value = row[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new ValidationError(`${field} must be a non-empty string.`);
  }
  return value;
}

function requireNumber(row: Record<string, unknown>, field: string): number {
  const value = row[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ValidationError(`${field} must be a finite number.`);
  }
  return value;
}

function optionalString(row: Record<string, unknown>, field: string): string | undefined {
  const value = row[field];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ValidationError(`${field} must be a string when supplied.`);
  return value;
}

function optionalStringOrEmpty(row: Record<string, unknown>, field: string): string {
  return optionalString(row, field) ?? "";
}

function parseAncestryRow(row: Record<string, unknown>): LifecycleAncestryRow {
  const id = requireString(row, "id");
  const accountId = optionalString(row, "accountId");
  return { ...row, id, ...(accountId === undefined ? {} : { accountId }) };
}

function findAncestryRow(state: AppData, table: AppDataKey, id: string): LifecycleAncestryRow | undefined {
  for (const row of state[table]) {
    if (row.id === id) return { ...row };
  }
  return undefined;
}

function createAncestryLookup(state: AppData, lookup: ValidationDataLookup | undefined): LifecycleAncestryLookup {
  return (table, id) => {
    const row = lookup?.row(table, id);
    return row ? parseAncestryRow(row) : findAncestryRow(state, table, id);
  };
}

function parseActivity(row: Record<string, unknown>): Activity {
  const kind = row.kind;
  if (kind !== "project" && kind !== "internal" && kind !== "repeatable") {
    throw new ValidationError("kind must identify a valid activity type.");
  }
  const projectId = optionalString(row, "projectId");
  const phaseId = optionalString(row, "phaseId");
  return {
    id: requireString(row, "id"),
    accountId: requireString(row, "accountId"),
    createdAt: requireString(row, "createdAt"),
    updatedAt: requireString(row, "updatedAt"),
    name: requireString(row, "name"),
    kind,
    ...(projectId === undefined ? {} : { projectId }),
    ...(phaseId === undefined ? {} : { phaseId }),
  };
}

function isWeekday(value: unknown): value is Resource["workingDays"][number] {
  return value === 0 || value === 1 || value === 2 || value === 3 || value === 4 || value === 5 || value === 6;
}

function requireWorkingDays(row: Record<string, unknown>, field: "workingDays" | "halfDays"): Resource[typeof field] {
  const value = row[field];
  if (!Array.isArray(value) || !value.every(isWeekday)) {
    throw new ValidationError(`${field} must contain valid weekdays.`);
  }
  return value;
}

function parseResource(row: Record<string, unknown>): Resource {
  const kind = row.kind;
  if (kind !== "person" && kind !== "placeholder" && kind !== "external") {
    throw new ValidationError("kind must identify a valid resource type.");
  }
  const employmentType = row.employmentType;
  if (employmentType !== "permanent" && employmentType !== "freelancer" && employmentType !== "contractor") {
    throw new ValidationError("employmentType must identify a valid employment type.");
  }
  const engagement = row.engagement;
  if (engagement !== "studio" && engagement !== "supplementary") {
    throw new ValidationError("engagement must identify a valid resource engagement.");
  }
  const name = optionalString(row, "name");
  const disciplineId = optionalString(row, "disciplineId");
  const projectId = optionalString(row, "projectId");
  const availability = parseResourceAvailability(row);
  return {
    id: requireString(row, "id"),
    accountId: requireString(row, "accountId"),
    createdAt: requireString(row, "createdAt"),
    updatedAt: requireString(row, "updatedAt"),
    kind,
    // Role is an optional descriptor in the resource form and in the shared entity contract.
    // Keep the property on every row for the NOT NULL column, but accept the empty string the
    // form sends when the manager leaves Role blank.
    role: optionalStringOrEmpty(row, "role"),
    employmentType,
    engagement,
    workingHoursPerDay: requireNumber(row, "workingHoursPerDay"),
    workingDays: requireWorkingDays(row, "workingDays"),
    halfDays: requireWorkingDays(row, "halfDays"),
    color: requireString(row, "color"),
    ...(name === undefined ? {} : { name }),
    ...(disciplineId === undefined ? {} : { disciplineId }),
    ...(projectId === undefined ? {} : { projectId }),
    ...availability,
  };
}

function parseResourceAvailability(
  row: Record<string, unknown>,
): Pick<Resource, "firstAvailableDate" | "lastAvailableDate"> {
  const firstAvailableDate = optionalString(row, "firstAvailableDate");
  const lastAvailableDate = optionalString(row, "lastAvailableDate");
  return {
    ...(firstAvailableDate === undefined ? {} : { firstAvailableDate }),
    ...(lastAvailableDate === undefined ? {} : { lastAvailableDate }),
  };
}

function parseAllocationExisting(
  row: Record<string, unknown> | undefined,
): Pick<Allocation, "resourceId" | "activityId" | "projectId"> | undefined {
  if (!row) return undefined;
  const projectId = optionalString(row, "projectId");
  return {
    resourceId: requireString(row, "resourceId"),
    activityId: requireString(row, "activityId"),
    ...(projectId === undefined ? {} : { projectId }),
  };
}

function parseTimeOffExisting(row: Record<string, unknown> | undefined): Pick<TimeOff, "resourceId"> | undefined {
  return row ? { resourceId: requireString(row, "resourceId") } : undefined;
}

interface ClientWriteInput {
  state: AppData;
  row: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
  lookup: ValidationDataLookup | undefined;
}

function assertClientWrite({ state, row, existing, lookup }: ClientWriteInput): void {
  const id = requireString(row, "id");
  const accountId = requireString(row, "accountId");
  const currentClient = existing ?? lookup?.row("clients", id) ?? state.clients.find((client) => client.id === id);
  if (currentClient?.builtin === true && !isBuiltinClientRow(row)) {
    throw new ValidationError("The built-in Internal client cannot be modified.");
  }
  if (row.builtin === true && !hasBuiltinClientPresentation(row)) {
    throw new ValidationError("The built-in Internal client has a fixed name and colour.");
  }
  if (row.builtin === true && wouldAddSecondBuiltin(state.clients, accountId, id)) {
    throw new ValidationError("This company already has its built-in Internal client.");
  }
}

function hasBuiltinClientPresentation(row: Record<string, unknown>): boolean {
  return row.name === INTERNAL_CLIENT_NAME && row.color === INTERNAL_CLIENT_COLOR;
}

function isBuiltinClientRow(row: Record<string, unknown>): boolean {
  return row.builtin === true && hasBuiltinClientPresentation(row);
}

function assertResourceWrite(input: AssertValidWriteInput, accountId: string): void {
  const { state, row, existing, lookup } = input;
  const resource = parseResource(row);
  const previous = existing ? parseResource(existing) : undefined;
  assertResourceProjectAllowsDependents(state, accountId, resource.id, resource, previous, lookup);
  assertResourceKindAllowsDependents(state, accountId, resource.id, resource.kind, lookup);
  const availability = validateResourceAvailabilityPair(resource.firstAvailableDate, resource.lastAvailableDate);
  if (!availability.ok) {
    throw new ValidationError(
      availability.code === "date_reversed"
        ? "First available date cannot be after last available date."
        : "Availability dates must be valid calendar dates (YYYY-MM-DD).",
    );
  }
}

function assertAllocationWrite(input: AssertValidWriteInput, accountId: string): void {
  const { state, row, existing, lookup } = input;
  const resourceId = requireString(row, "resourceId");
  const startDate = requireString(row, "startDate");
  const endDate = requireString(row, "endDate");
  assertAllocationRefs(
    state,
    accountId,
    resourceId,
    requireString(row, "activityId"),
    requireNumber(row, "hoursPerDay"),
    optionalString(row, "projectId"),
    parseAllocationExisting(existing),
    lookup,
  );
  assertDateRange(startDate, endDate);
  const placementChanged =
    existing === undefined ||
    existing.resourceId !== resourceId ||
    existing.startDate !== startDate ||
    existing.endDate !== endDate ||
    (existing.ignoreWeekends === true) !== (row.ignoreWeekends === true);
  if (!placementChanged) return;
  const resourceRow =
    lookup?.row("resources", resourceId) ?? state.resources.find((resource) => resource.id === resourceId);
  if (!resourceRow) return;
  const resource = parseResource(resourceRow as Record<string, unknown>);
  const accountWorkingDays = resolveAccountWorkingDays(state, accountId, lookup);
  assertAllocationWithinResourceAvailability({
    allocation: {
      startDate,
      endDate,
      ...(row.ignoreWeekends === true ? { ignoreWeekends: true } : {}),
    },
    resource,
    accountWorkingDays,
  });
}

function resolveAccountWorkingDays(state: AppData, accountId: string, lookup: ValidationDataLookup | undefined) {
  if (lookup) return lookup.accountWorkingDays(accountId);
  const account = state.accounts.find((candidate) => candidate.id === accountId);
  return normalizeAccountWorkingDays(account?.workingDays, account?.weekStartsOn === 0 ? 0 : 1);
}

function assertEntityWrite(input: AssertValidWriteInput, accountId: string): void {
  const { state, table, row, existing, lookup } = input;
  if (isScopedEntityKey(table) && table !== "allocations" && table !== "timeOff" && table !== "closures") {
    assertScopedRefs(state, accountId, table, row, existing, lookup, { fullRow: true });
  }
  if (table === "resources") {
    assertResourceWrite(input, accountId);
  } else if (table === "activities") {
    const activity = parseActivity(row);
    const previous = existing ? parseActivity(existing) : undefined;
    assertActivityProjectAllowsDependents(state, accountId, activity.id, activity, previous, lookup);
  } else if (table === "allocations") {
    assertAllocationWrite(input, accountId);
  }
  if (table === "timeOff") {
    assertResourceExists(state, accountId, requireString(row, "resourceId"), parseTimeOffExisting(existing), lookup);
    assertDateRange(requireString(row, "startDate"), requireString(row, "endDate"));
  }
  if (table === "closures") assertDateRange(requireString(row, "startDate"), requireString(row, "endDate"));
}

/**
 * Enforce referential integrity and date ranges for a full, sanitised server write.
 *
 * @throws {ValidationError} When the write violates a domain invariant or its runtime shape does
 * not match the full-row contract. Import repair remains separate and does not call this boundary.
 */
export function assertValidWrite(input: AssertValidWriteInput): void {
  const { state, table, row, existing, lookup } = input;
  assertLifecycleWrite(table, row, existing);
  assertActiveAncestry({ state, table, row, lookup });
  if (table === "clients") {
    assertClientWrite({ state, row, existing, lookup });
    return;
  }
  if (table === "accounts") {
    assertAccountWrite(row);
    return;
  }
  if (table === "disciplines" || !isScopedEntityKey(table)) return;
  assertDomainWrite(input, requireString(row, "accountId"));
}

function assertLifecycleWrite(
  table: string,
  row: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
): void {
  if (
    table === "clients" &&
    row.builtin === true &&
    [row.archivedAt, row.deletedAt, existing?.archivedAt, existing?.deletedAt].some(
      (value) => typeof value === "string",
    )
  ) {
    throw new ValidationError("The built-in Internal client must remain active.");
  }
  if (isLifecycleEntityKey(table) && typeof existing?.deletedAt === "string") {
    throw new ValidationError("Soft-deleted records can only be changed through lifecycle endpoints.");
  }
}

function assertActiveAncestry({ state, table, row, lookup }: AssertValidWriteInput): void {
  if (isAppDataKey(table)) {
    const ancestry = inspectLifecycleAncestry(table, parseAncestryRow(row), createAncestryLookup(state, lookup));
    if (ancestry.inactiveAncestor) {
      throw new ValidationError(
        "Records beneath an archived or soft-deleted ancestor cannot be changed through generic endpoints.",
      );
    }
  }
}

function assertAccountWrite(row: Record<string, unknown>): void {
  if (typeof row.name !== "string" || row.name.trim().length === 0) {
    throw new ValidationError("Company name is required.");
  }
}

function assertDomainWrite(input: AssertValidWriteInput, accountId: string): void {
  try {
    assertEntityWrite(input, accountId);
  } catch (e) {
    throw new ValidationError(e instanceof Error ? e.message : String(e), {
      cause: e,
      ...(e instanceof DomainError ? { code: e.code } : {}),
    });
  }
}
