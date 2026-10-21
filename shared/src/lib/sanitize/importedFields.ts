import type { AppData, ScopedEntityKey } from "../../types/entities";

const SCOPED_META_FIELDS = ["id", "accountId", "createdAt", "updatedAt"] as const;

// Project imports onto the exact portable fields before value repair so demo and SQLite modes
// discard undeclared properties consistently. Type coverage requires every domain field to be classified.
const IMPORTED_FIELDS = {
  disciplines: [...SCOPED_META_FIELDS, "name", "color", "sortOrder"],
  resources: [
    ...SCOPED_META_FIELDS,
    "kind",
    "name",
    "role",
    "avatarUrl",
    "disciplineId",
    "employmentType",
    "engagement",
    "workingHoursPerDay",
    "workingDays",
    "halfDays",
    "projectId",
    "color",
    "isFavourite",
    "firstAvailableDate",
    "lastAvailableDate",
    "archivedAt",
    "deletedAt",
  ],
  clients: [...SCOPED_META_FIELDS, "name", "color", "isPrivate", "codeName", "builtin", "archivedAt", "deletedAt"],
  projects: [...SCOPED_META_FIELDS, "name", "clientId", "color", "isPrivate", "codeName", "archivedAt", "deletedAt"],
  phases: [...SCOPED_META_FIELDS, "name", "projectId"],
  activities: [...SCOPED_META_FIELDS, "name", "kind", "projectId", "phaseId", "archivedAt", "deletedAt"],
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
    "task",
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

/** Delete every field the table's import contract does not name. Mutates `record`. */
export const stripUnknownFields = (key: ScopedEntityKey, record: Record<string, unknown>): void => {
  const allowed: readonly string[] = IMPORTED_FIELDS[key];
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) delete record[field];
  }
};
