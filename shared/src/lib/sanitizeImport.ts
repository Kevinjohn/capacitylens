import { NEUTRAL_COLOR, snapToPresetColor } from "./color";
import { INTERNAL_CLIENT_COLOR } from "../data/internalClient";
import { cleanText } from "./strings";
import {
  externalCapacityDefaults,
  FULL_DAY_HOURS,
  isPlaceholderResource,
  placeholderCapacityDefaults,
  type ScopedEntityKey,
  type Weekday,
} from "../types/entities";
import {
  VALID_STATUS,
  VALID_KIND,
  VALID_ACTIVITY_KIND,
  VALID_EMPLOYMENT,
  VALID_ENGAGEMENT,
  VALID_TIMEOFF,
  oneOf,
  clampHours,
  clampAllocHours,
  safeInt,
  normalizeISODate,
  safeWorkingDays,
  safeHalfDays,
  cleanField,
  cleanRequiredField,
  repairPrivateNameFieldsInPlace,
  repairLifecycleFieldsInPlace,
} from "./sanitize/coerce";
import { stripUnknownFields } from "./sanitize/importedFields";

export { sanitizeAccount } from "./sanitize/account";

// Import is the one write path that bypasses the form validators (a hand-edited or
// corrupt file never went through them). The store already drops allocations/time-off
// with broken ranges or dangling refs; this repairs the *value*-level fields the forms
// would otherwise have guarded — so a negative/NaN hoursPerDay, a junk status enum, or
// a non-hex colour can't land in the store and render as broken geometry.

function sanitizeResource(record: Record<string, unknown>): void {
  const kind = oneOf(record.kind, VALID_KIND, "person");
  const isPlaceholder = isPlaceholderResource({ kind });
  record.kind = kind;
  if (kind === "external") {
    Object.assign(record, externalCapacityDefaults());
    record.color = NEUTRAL_COLOR;
    delete record.disciplineId;
    delete record.projectId;
  } else {
    record.employmentType = oneOf(record.employmentType, VALID_EMPLOYMENT, "permanent");
    record.engagement = isPlaceholder ? "studio" : oneOf(record.engagement, VALID_ENGAGEMENT, "studio");
    record.workingHoursPerDay = clampHours(record.workingHoursPerDay);
    if (isPlaceholder) Object.assign(record, placeholderCapacityDefaults());
    else {
      record.workingDays = safeWorkingDays(record.workingDays);
      record.halfDays = safeHalfDays(record.halfDays, record.workingDays as Weekday[]);
      delete record.projectId;
    }
    record.color = snapToPresetColor(record.color);
  }
  if (isPlaceholder) cleanField({ record, field: "name" });
  else cleanRequiredField(record, "name", kind === "external" ? "Unnamed company" : "Unnamed person");
  // Optional roles persist as blank strings; only absent or malformed roles need a default.
  if (typeof record.role === "string") cleanField({ record, field: "role" });
  else record.role = "Team member";
  if (record.isFavourite !== undefined && typeof record.isFavourite !== "boolean") delete record.isFavourite;
  repairLifecycleFieldsInPlace(record);
}

function sanitizeAllocation(record: Record<string, unknown>): void {
  record.status = oneOf(record.status, VALID_STATUS, "confirmed");
  record.hoursPerDay = clampAllocHours(record.hoursPerDay, FULL_DAY_HOURS);
  for (const field of ["projectId", "seriesId"] as const) {
    if (record[field] === undefined) continue;
    const value = typeof record[field] === "string" ? cleanText(record[field]) : "";
    if (value) record[field] = value;
    else delete record[field];
  }
  if (typeof record.ignoreWeekends !== "boolean") delete record.ignoreWeekends;
  record.startDate = normalizeISODate(record.startDate);
  record.endDate = normalizeISODate(record.endDate);
  cleanField({ record, field: "note", multiline: true });
}

function sanitizeClient(record: Record<string, unknown>): void {
  record.color = record.builtin === true ? INTERNAL_CLIENT_COLOR : snapToPresetColor(record.color);
  cleanRequiredField(record, "name", "Untitled");
  if (record.builtin !== true) delete record.builtin;
  if (record.builtin === true) {
    delete record.isPrivate;
    delete record.codeName;
    delete record.archivedAt;
    delete record.deletedAt;
    return;
  }
  repairPrivateNameFieldsInPlace(record);
  repairLifecycleFieldsInPlace(record);
}

function sanitizeDiscipline(record: Record<string, unknown>): void {
  record.sortOrder = safeInt(record.sortOrder, 0);
  if (record.color === null) delete record.color;
  else if (record.color !== undefined) record.color = snapToPresetColor(record.color);
  cleanRequiredField(record, "name", "Untitled");
}

function sanitizeActivity(record: Record<string, unknown>): void {
  cleanRequiredField(record, "name", "Untitled");
  const defaultKind = record.projectId !== undefined ? "project" : "repeatable";
  record.kind = oneOf(record.kind, VALID_ACTIVITY_KIND, defaultKind);
}

/** Project one imported scoped record onto its declared schema, then repair constrained values in
 * place. The record has already had its id remapped + accountId stamped. */
export function sanitizeImportedRecord(key: ScopedEntityKey, record: Record<string, unknown>): Record<string, unknown> {
  stripUnknownFields(key, record);
  switch (key) {
    case "resources":
      sanitizeResource(record);
      break;
    case "allocations":
      sanitizeAllocation(record);
      break;
    case "timeOff":
      record.type = oneOf(record.type, VALID_TIMEOFF, "other");
      record.startDate = normalizeISODate(record.startDate);
      record.endDate = normalizeISODate(record.endDate);
      cleanField({ record, field: "note", multiline: true });
      break;
    case "closures":
      cleanRequiredField(record, "name", "Untitled closure");
      record.startDate = normalizeISODate(record.startDate);
      record.endDate = normalizeISODate(record.endDate);
      break;
    case "disciplines":
      sanitizeDiscipline(record);
      break;
    case "clients":
      sanitizeClient(record);
      break;
    case "projects":
      record.color = snapToPresetColor(record.color);
      cleanRequiredField(record, "name", "Untitled"); // name is NOT NULL
      repairPrivateNameFieldsInPlace(record);
      repairLifecycleFieldsInPlace(record);
      break;
    case "phases":
      cleanRequiredField(record, "name", "Untitled"); // name is NOT NULL
      break;
    case "activities":
      sanitizeActivity(record);
      break;
    default: {
      // Exhaustiveness check: if a new ScopedEntityKey is added to the union without
      // a corresponding case above, this line will fail to compile.
      const _exhaustive: never = key;
      void _exhaustive;
      break;
    }
  }
  return record;
}
