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

/** Project one imported scoped record onto its declared schema, then repair constrained values in
 * place. The record has already had its id remapped + accountId stamped. */
export function sanitizeImportedRecord(key: ScopedEntityKey, record: Record<string, unknown>): Record<string, unknown> {
  stripUnknownFields(key, record);
  switch (key) {
    case "resources": {
      const kind = oneOf(record.kind, VALID_KIND, "person");
      record.kind = kind;
      if (record.kind === "external") {
        Object.assign(record, externalCapacityDefaults());
        record.color = NEUTRAL_COLOR;
        delete record.disciplineId;
        delete record.projectId;
      } else {
        record.employmentType = oneOf(record.employmentType, VALID_EMPLOYMENT, "permanent");
        record.engagement = isPlaceholderResource({ kind })
          ? "studio"
          : oneOf(record.engagement, VALID_ENGAGEMENT, "studio");
        record.workingHoursPerDay = clampHours(record.workingHoursPerDay);
        if (isPlaceholderResource({ kind })) {
          Object.assign(record, placeholderCapacityDefaults());
        } else {
          record.workingDays = safeWorkingDays(record.workingDays);
          record.halfDays = safeHalfDays(record.halfDays, record.workingDays as Weekday[]);
        }
        record.color = snapToPresetColor(record.color);
        if (!isPlaceholderResource({ kind })) delete record.projectId;
      }
      if (isPlaceholderResource({ kind })) {
        cleanField(record, "name");
      } else {
        cleanRequiredField(record, "name", record.kind === "external" ? "Unnamed company" : "Unnamed person");
      }
      // Role is optional in both resource forms, but the storage column is NOT NULL. Preserve an
      // intentionally blank (or cleaning-to-blank) string; only synthesize a value when no string
      // was supplied at all.
      if (typeof record.role === "string") cleanField(record, "role");
      else record.role = "Team member";
      // Favourites are an optional binary flag. Preserve explicit true/false; absence is the
      // default-off representation and malformed hand-edited values must not become truthy.
      if (record.isFavourite !== undefined && typeof record.isFavourite !== "boolean") delete record.isFavourite;
      repairLifecycleFieldsInPlace(record);
      break;
    }
    case "allocations":
      record.status = oneOf(record.status, VALID_STATUS, "confirmed");
      record.hoursPerDay = clampAllocHours(record.hoursPerDay, FULL_DAY_HOURS);
      if (record.projectId !== undefined) {
        const projectId = typeof record.projectId === "string" ? cleanText(record.projectId) : "";
        if (projectId) record.projectId = projectId;
        else delete record.projectId;
      }
      if (typeof record.ignoreWeekends !== "boolean") delete record.ignoreWeekends;
      if (record.seriesId !== undefined) {
        const seriesId = typeof record.seriesId === "string" ? cleanText(record.seriesId) : "";
        if (seriesId) record.seriesId = seriesId;
        else delete record.seriesId;
      }
      record.startDate = normalizeISODate(record.startDate);
      record.endDate = normalizeISODate(record.endDate);
      cleanField(record, "note", true);
      break;
    case "timeOff":
      record.type = oneOf(record.type, VALID_TIMEOFF, "other");
      record.startDate = normalizeISODate(record.startDate);
      record.endDate = normalizeISODate(record.endDate);
      cleanField(record, "note", true);
      break;
    case "closures":
      cleanRequiredField(record, "name", "Untitled closure");
      record.startDate = normalizeISODate(record.startDate);
      record.endDate = normalizeISODate(record.endDate);
      break;
    case "disciplines":
      record.sortOrder = safeInt(record.sortOrder, 0);
      if (record.color === null) delete record.color;
      else if (record.color !== undefined) record.color = snapToPresetColor(record.color);
      cleanRequiredField(record, "name", "Untitled"); // name is NOT NULL
      break;
    case "clients":
      record.color = record.builtin === true ? INTERNAL_CLIENT_COLOR : snapToPresetColor(record.color);
      cleanRequiredField(record, "name", "Untitled"); // name is NOT NULL
      // `builtin` is an OPTIONAL boolean (true only for the Internal pseudo-client). This is
      // DEFENSIVE NORMALISATION for a hand-edited / legacy file: drop anything that isn't strictly
      // `true` so junk (a string, 0, or an explicit `false`) can't persist — its absence reads back
      // as a normal client, and the round-trip omits the column rather than writing a NULL. (The code
      // itself never writes `false`; absent and false mean the same thing.) The import path
      // (remapAndValidateImport) does NOT remove imported builtins — it normalises them to exactly
      // one per account (keeps the FIRST, re-stamping its name/colour, and folds any duplicates into
      // it). This sanitiser still runs per-record there, so a kept builtin's flag survives untouched.
      if (record.builtin !== true) delete record.builtin;
      // The built-in Internal bucket is never embargoed. A normal client keeps a coherent optional
      // privacy pair (isPrivate:true + non-empty codeName), defaulting to public when absent/junk.
      if (record.builtin === true) {
        delete record.isPrivate;
        delete record.codeName;
        // Supported mutation paths never allow the protected singleton to enter the lifecycle
        // state machine. Imports repair hand-edited or legacy tombstones back to active.
        delete record.archivedAt;
        delete record.deletedAt;
      } else {
        repairPrivateNameFieldsInPlace(record);
        repairLifecycleFieldsInPlace(record);
      }
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
      cleanRequiredField(record, "name", "Untitled"); // name is NOT NULL
      // kind is NOT NULL. Default a missing/junk value from the only signal a legacy (pre-kind)
      // record carried: a project-bound activity is 'project', a project-less one is 'repeatable'
      // (the rename of "general"). The referential repair pass then strips any project/phase an
      // internal/repeatable activity carries, keeping kind ⇆ projectId coherent.
      record.kind = oneOf(record.kind, VALID_ACTIVITY_KIND, record.projectId !== undefined ? "project" : "repeatable");
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
