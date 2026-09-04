import type { AppData, ScopedEntityKey } from "../../types/entities";

const SCOPED_META_FIELDS = ["id", "accountId", "createdAt", "updatedAt"] as const;

/** Exact portable fields accepted for each scoped entity. Import runs in both the in-memory demo
 * and SQLite modes, so project onto the shared domain schema before value repair rather than rely
 * on SQLite's column list to discard undeclared properties later. The type checks below make a
 * domain-field addition fail compilation until this boundary is updated deliberately. */
const IMPORTED_FIELDS = {
  disciplines: [...SCOPED_META_FIELDS, "name", "color", "sortOrder"],
  resources: [
    ...SCOPED_META_FIELDS,
    "kind",
    "name",
    "role",
    "disciplineId",
    "employmentType",
    "engagement",
    "workingHoursPerDay",
    "workingDays",
    "halfDays",
    "projectId",
    "color",
    "isFavourite",
    "archivedAt",
    "deletedAt",
  ],
  clients: [...SCOPED_META_FIELDS, "name", "color", "isPrivate", "codeName", "builtin", "archivedAt", "deletedAt"],
  projects: [...SCOPED_META_FIELDS, "name", "clientId", "color", "isPrivate", "codeName", "archivedAt", "deletedAt"],
  phases: [...SCOPED_META_FIELDS, "name", "projectId"],
  activities: [...SCOPED_META_FIELDS, "name", "kind", "projectId", "phaseId"],
  allocations: [
    ...SCOPED_META_FIELDS,
    "resourceId",
    "activityId",
    "projectId",
    "seriesId",
    "startDate",
    "endDate",
    "hoursPerDay",
    "status",
    "note",
    "ignoreWeekends",
  ],
  timeOff: [...SCOPED_META_FIELDS, "resourceId", "startDate", "endDate", "type", "note"],
  closures: [...SCOPED_META_FIELDS, "name", "startDate", "endDate"],
} as const satisfies {
  [K in ScopedEntityKey]: readonly (keyof AppData[K][number])[];
};

type MissingImportedField = {
  [K in ScopedEntityKey]: Exclude<keyof AppData[K][number], (typeof IMPORTED_FIELDS)[K][number]>;
}[ScopedEntityKey];
const importedFieldsAreComplete: MissingImportedField extends never ? true : never = true;
void importedFieldsAreComplete;

export const stripUnknownFields = (key: ScopedEntityKey, rec: Record<string, unknown>): void => {
  const allowed: readonly string[] = IMPORTED_FIELDS[key];
  for (const field of Object.keys(rec)) {
    if (!allowed.includes(field)) delete rec[field];
  }
};
