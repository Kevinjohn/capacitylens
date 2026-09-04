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
  normalizePrivateNameFields,
  normalizeLifecycleFields,
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
export function sanitizeImportedRecord(key: ScopedEntityKey, rec: Record<string, unknown>): Record<string, unknown> {
  stripUnknownFields(key, rec);
  switch (key) {
    case "resources": {
      const kind = oneOf(rec.kind, VALID_KIND, "person");
      rec.kind = kind;
      if (rec.kind === "external") {
        Object.assign(rec, externalCapacityDefaults());
        rec.color = NEUTRAL_COLOR;
        delete rec.disciplineId;
        delete rec.projectId;
      } else {
        rec.employmentType = oneOf(rec.employmentType, VALID_EMPLOYMENT, "permanent");
        rec.engagement = isPlaceholderResource({ kind }) ? "studio" : oneOf(rec.engagement, VALID_ENGAGEMENT, "studio");
        rec.workingHoursPerDay = clampHours(rec.workingHoursPerDay);
        if (isPlaceholderResource({ kind })) {
          Object.assign(rec, placeholderCapacityDefaults());
        } else {
          rec.workingDays = safeWorkingDays(rec.workingDays);
          rec.halfDays = safeHalfDays(rec.halfDays, rec.workingDays as Weekday[]);
        }
        rec.color = snapToPresetColor(rec.color);
        if (!isPlaceholderResource({ kind })) delete rec.projectId;
      }
      if (isPlaceholderResource({ kind })) {
        cleanField(rec, "name");
      } else {
        cleanRequiredField(rec, "name", rec.kind === "external" ? "Unnamed company" : "Unnamed person");
      }
      // Role is optional in both resource forms, but the storage column is NOT NULL. Preserve an
      // intentionally blank (or cleaning-to-blank) string; only synthesize a value when no string
      // was supplied at all.
      if (typeof rec.role === "string") cleanField(rec, "role");
      else rec.role = "Team member";
      // Favourites are an optional binary flag. Preserve explicit true/false; absence is the
      // default-off representation and malformed hand-edited values must not become truthy.
      if (rec.isFavourite !== undefined && typeof rec.isFavourite !== "boolean") delete rec.isFavourite;
      normalizeLifecycleFields(rec);
      break;
    }
    case "allocations":
      rec.status = oneOf(rec.status, VALID_STATUS, "confirmed");
      rec.hoursPerDay = clampAllocHours(rec.hoursPerDay, FULL_DAY_HOURS);
      if (rec.projectId !== undefined) {
        const projectId = typeof rec.projectId === "string" ? cleanText(rec.projectId) : "";
        if (projectId) rec.projectId = projectId;
        else delete rec.projectId;
      }
      if (typeof rec.ignoreWeekends !== "boolean") delete rec.ignoreWeekends;
      if (rec.seriesId !== undefined) {
        const seriesId = typeof rec.seriesId === "string" ? cleanText(rec.seriesId) : "";
        if (seriesId) rec.seriesId = seriesId;
        else delete rec.seriesId;
      }
      rec.startDate = normalizeISODate(rec.startDate);
      rec.endDate = normalizeISODate(rec.endDate);
      cleanField(rec, "note", true);
      break;
    case "timeOff":
      rec.type = oneOf(rec.type, VALID_TIMEOFF, "other");
      rec.startDate = normalizeISODate(rec.startDate);
      rec.endDate = normalizeISODate(rec.endDate);
      cleanField(rec, "note", true);
      break;
    case "closures":
      cleanRequiredField(rec, "name", "Untitled closure");
      rec.startDate = normalizeISODate(rec.startDate);
      rec.endDate = normalizeISODate(rec.endDate);
      break;
    case "disciplines":
      rec.sortOrder = safeInt(rec.sortOrder, 0);
      if (rec.color === null) delete rec.color;
      else if (rec.color !== undefined) rec.color = snapToPresetColor(rec.color);
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      break;
    case "clients":
      rec.color = rec.builtin === true ? INTERNAL_CLIENT_COLOR : snapToPresetColor(rec.color);
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      // `builtin` is an OPTIONAL boolean (true only for the Internal pseudo-client). This is
      // DEFENSIVE NORMALISATION for a hand-edited / legacy file: drop anything that isn't strictly
      // `true` so junk (a string, 0, or an explicit `false`) can't persist — its absence reads back
      // as a normal client, and the round-trip omits the column rather than writing a NULL. (The code
      // itself never writes `false`; absent and false mean the same thing.) The import path
      // (remapAndValidateImport) does NOT remove imported builtins — it normalises them to exactly
      // one per account (keeps the FIRST, re-stamping its name/colour, and folds any duplicates into
      // it). This sanitiser still runs per-record there, so a kept builtin's flag survives untouched.
      if (rec.builtin !== true) delete rec.builtin;
      // The built-in Internal bucket is never embargoed. A normal client keeps a coherent optional
      // privacy pair (isPrivate:true + non-empty codeName), defaulting to public when absent/junk.
      if (rec.builtin === true) {
        delete rec.isPrivate;
        delete rec.codeName;
        // Supported mutation paths never allow the protected singleton to enter the lifecycle
        // state machine. Imports repair hand-edited or legacy tombstones back to active.
        delete rec.archivedAt;
        delete rec.deletedAt;
      } else {
        normalizePrivateNameFields(rec);
        normalizeLifecycleFields(rec);
      }
      break;
    case "projects":
      rec.color = snapToPresetColor(rec.color);
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      normalizePrivateNameFields(rec);
      normalizeLifecycleFields(rec);
      break;
    case "phases":
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      break;
    case "activities":
      cleanRequiredField(rec, "name", "Untitled"); // name is NOT NULL
      // kind is NOT NULL. Default a missing/junk value from the only signal a legacy (pre-kind)
      // record carried: a project-bound activity is 'project', a project-less one is 'repeatable'
      // (the rename of "general"). The referential repair pass then strips any project/phase an
      // internal/repeatable activity carries, keeping kind ⇆ projectId coherent.
      rec.kind = oneOf(rec.kind, VALID_ACTIVITY_KIND, rec.projectId !== undefined ? "project" : "repeatable");
      break;
    default: {
      // Exhaustiveness check: if a new ScopedEntityKey is added to the union without
      // a corresponding case above, this line will fail to compile.
      const _exhaustive: never = key;
      void _exhaustive;
      break;
    }
  }
  return rec;
}
