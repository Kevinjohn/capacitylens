import {
  isUnknownRecord,
  readNumberArray,
  readOptionalBoolean,
  readOptionalString,
  readRequiredNumber,
  readRequiredString,
  requireModeledKeys,
  type ActivitySnapshot,
  type AllocationSnapshot,
  type DisciplineSnapshot,
  type PhaseSnapshot,
  type ProjectBinding,
  type ProjectSnapshot,
  type ResourceSnapshot,
} from "./appTestSnapshotCore";
export function readProjectBindings(rows: unknown[], table: string): ProjectBinding[] {
  return rows.map((row) => {
    if (typeof row !== "object" || row === null || !("id" in row) || typeof row.id !== "string") {
      throw new Error(`Expected every ${table} row to contain a string id.`);
    }
    if ("projectId" in row) {
      if (typeof row.projectId !== "string") {
        throw new Error(`Expected every present ${table} projectId to be a string.`);
      }
      return { id: row.id, projectId: row.projectId };
    }
    return { id: row.id };
  });
}

export function readActivitySnapshots(rows: unknown[]): ActivitySnapshot[] {
  return readProjectBindings(rows, "activity").map((binding, index) => {
    const source = rows[index];
    if (!isUnknownRecord(source)) throw new Error("Expected every activity row to be an object.");
    requireModeledKeys(
      source,
      ["accountId", "createdAt", "id", "kind", "name", "phaseId", "projectId", "updatedAt"],
      "activity row",
    );
    const phaseId = readOptionalString(source, "phaseId", "activity row");
    const snapshot: ActivitySnapshot = {
      ...binding,
      accountId: readRequiredString(source, "accountId", "activity row"),
      createdAt: readRequiredString(source, "createdAt", "activity row"),
      kind: readRequiredString(source, "kind", "activity row"),
      name: readRequiredString(source, "name", "activity row"),
      updatedAt: readRequiredString(source, "updatedAt", "activity row"),
    };
    if (phaseId !== undefined) snapshot.phaseId = phaseId;
    return snapshot;
  });
}

export function readDisciplineSnapshots(rows: unknown[]): DisciplineSnapshot[] {
  return rows.map((row) => {
    if (!isUnknownRecord(row)) throw new Error("Expected every discipline row to be an object.");
    requireModeledKeys(
      row,
      ["accountId", "color", "createdAt", "id", "name", "sortOrder", "updatedAt"],
      "discipline row",
    );
    const color = readOptionalString(row, "color", "discipline row");
    const snapshot: DisciplineSnapshot = {
      accountId: readRequiredString(row, "accountId", "discipline row"),
      createdAt: readRequiredString(row, "createdAt", "discipline row"),
      id: readRequiredString(row, "id", "discipline row"),
      name: readRequiredString(row, "name", "discipline row"),
      sortOrder: readRequiredNumber(row, "sortOrder", "discipline row"),
      updatedAt: readRequiredString(row, "updatedAt", "discipline row"),
    };
    if (color !== undefined) snapshot.color = color;
    return snapshot;
  });
}

export function readFirstDiscipline(disciplines: DisciplineSnapshot[]): DisciplineSnapshot {
  const disciplineRow = disciplines[0];
  if (!disciplineRow) throw new Error("Expected the state response to contain a discipline.");
  return disciplineRow;
}

export function readPhaseSnapshots(rows: unknown[]): PhaseSnapshot[] {
  return rows.map((row) => {
    if (!isUnknownRecord(row)) throw new Error("Expected every phase row to be an object.");
    requireModeledKeys(row, ["accountId", "createdAt", "id", "name", "projectId", "updatedAt"], "phase row");
    return {
      accountId: readRequiredString(row, "accountId", "phase row"),
      createdAt: readRequiredString(row, "createdAt", "phase row"),
      id: readRequiredString(row, "id", "phase row"),
      name: readRequiredString(row, "name", "phase row"),
      projectId: readRequiredString(row, "projectId", "phase row"),
      updatedAt: readRequiredString(row, "updatedAt", "phase row"),
    };
  });
}

export function readFirstPhase(phases: PhaseSnapshot[]): PhaseSnapshot {
  const phaseRow = phases[0];
  if (!phaseRow) throw new Error("Expected the state response to contain a phase.");
  return phaseRow;
}

export function readFirstActivity(activities: ActivitySnapshot[]): ActivitySnapshot {
  const activityRow = activities[0];
  if (!activityRow) throw new Error("Expected the state response to contain an activity.");
  return activityRow;
}

export function readActivity(activities: ActivitySnapshot[], id: string): ActivitySnapshot {
  const activityRow = activities.find((candidate) => candidate.id === id);
  if (!activityRow) throw new Error(`Expected the state response to contain activity ${id}.`);
  return activityRow;
}

export function readResourceSnapshot(source: Record<string, unknown>, binding: ProjectBinding): ResourceSnapshot {
  requireModeledKeys(
    source,
    [
      "accountId",
      "color",
      "createdAt",
      "disciplineId",
      "engagement",
      "employmentType",
      "halfDays",
      "id",
      "isFavourite",
      "kind",
      "firstAvailableDate",
      "lastAvailableDate",
      "name",
      "projectId",
      "role",
      "updatedAt",
      "workingDays",
      "workingHoursPerDay",
    ],
    "resource row",
  );
  const disciplineId = readOptionalString(source, "disciplineId", "resource row");
  const employmentType = readOptionalString(source, "employmentType", "resource row");
  const isFavourite = readOptionalBoolean(source, "isFavourite", "resource row");
  const firstAvailableDate = readOptionalString(source, "firstAvailableDate", "resource row");
  const lastAvailableDate = readOptionalString(source, "lastAvailableDate", "resource row");
  const name = readOptionalString(source, "name", "resource row");
  const snapshot: ResourceSnapshot = {
    ...binding,
    accountId: readRequiredString(source, "accountId", "resource row"),
    color: readRequiredString(source, "color", "resource row"),
    createdAt: readRequiredString(source, "createdAt", "resource row"),
    engagement: readRequiredString(source, "engagement", "resource row"),
    halfDays: readNumberArray(source, "halfDays", "resource row"),
    kind: readRequiredString(source, "kind", "resource row"),
    role: readRequiredString(source, "role", "resource row"),
    updatedAt: readRequiredString(source, "updatedAt", "resource row"),
    workingDays: readNumberArray(source, "workingDays", "resource row"),
    workingHoursPerDay: readRequiredNumber(source, "workingHoursPerDay", "resource row"),
  };
  if (disciplineId !== undefined) snapshot.disciplineId = disciplineId;
  if (employmentType !== undefined) snapshot.employmentType = employmentType;
  if (isFavourite !== undefined) snapshot.isFavourite = isFavourite;
  if (firstAvailableDate !== undefined) snapshot.firstAvailableDate = firstAvailableDate;
  if (lastAvailableDate !== undefined) snapshot.lastAvailableDate = lastAvailableDate;
  if (name !== undefined) snapshot.name = name;
  return snapshot;
}

export function readAllocationSnapshots(rows: unknown[]): AllocationSnapshot[] {
  return rows.map((row) => {
    if (!isUnknownRecord(row)) throw new Error("Expected every allocation row to be an object.");
    requireModeledKeys(
      row,
      [
        "accountId",
        "activityId",
        "createdAt",
        "endDate",
        "hoursPerDay",
        "id",
        "ignoreWeekends",
        "note",
        "projectId",
        "resourceId",
        "seriesId",
        "startDate",
        "status",
        "task",
        "updatedAt",
      ],
      "allocation row",
    );
    const ignoreWeekends = readOptionalBoolean(row, "ignoreWeekends", "allocation row");
    const note = readOptionalString(row, "note", "allocation row");
    const task = readOptionalString(row, "task", "allocation row");
    const projectId = readOptionalString(row, "projectId", "allocation row");
    const seriesId = readOptionalString(row, "seriesId", "allocation row");
    const snapshot: AllocationSnapshot = {
      accountId: readRequiredString(row, "accountId", "allocation row"),
      activityId: readRequiredString(row, "activityId", "allocation row"),
      createdAt: readRequiredString(row, "createdAt", "allocation row"),
      endDate: readRequiredString(row, "endDate", "allocation row"),
      hoursPerDay: readRequiredNumber(row, "hoursPerDay", "allocation row"),
      id: readRequiredString(row, "id", "allocation row"),
      resourceId: readRequiredString(row, "resourceId", "allocation row"),
      startDate: readRequiredString(row, "startDate", "allocation row"),
      status: readRequiredString(row, "status", "allocation row"),
      updatedAt: readRequiredString(row, "updatedAt", "allocation row"),
    };
    if (ignoreWeekends !== undefined) snapshot.ignoreWeekends = ignoreWeekends;
    if (note !== undefined) snapshot.note = note;
    if (task !== undefined) snapshot.task = task;
    if (projectId !== undefined) snapshot.projectId = projectId;
    if (seriesId !== undefined) snapshot.seriesId = seriesId;
    return snapshot;
  });
}

export function readFirstAllocation(allocations: AllocationSnapshot[]): AllocationSnapshot {
  const allocationRow = allocations[0];
  if (!allocationRow) throw new Error("Expected the state response to contain an allocation.");
  return allocationRow;
}

export function readAllocation(allocations: AllocationSnapshot[], id: string): AllocationSnapshot {
  const allocationRow = allocations.find((candidate) => candidate.id === id);
  if (!allocationRow) throw new Error(`Expected the state response to contain allocation ${id}.`);
  return allocationRow;
}

export function readProjectSnapshots(rows: unknown[]): ProjectSnapshot[] {
  return rows.map((row) => {
    if (!isUnknownRecord(row)) throw new Error("Expected every project row to be an object.");
    requireModeledKeys(
      row,
      [
        "accountId",
        "archivedAt",
        "clientId",
        "codeName",
        "color",
        "createdAt",
        "deletedAt",
        "id",
        "isPrivate",
        "name",
        "updatedAt",
      ],
      "project row",
    );
    const archivedAt = readOptionalString(row, "archivedAt", "project row");
    const codeName = readOptionalString(row, "codeName", "project row");
    const deletedAt = readOptionalString(row, "deletedAt", "project row");
    const isPrivate = readOptionalBoolean(row, "isPrivate", "project row");
    const snapshot: ProjectSnapshot = {
      accountId: readRequiredString(row, "accountId", "project row"),
      clientId: readRequiredString(row, "clientId", "project row"),
      color: readRequiredString(row, "color", "project row"),
      createdAt: readRequiredString(row, "createdAt", "project row"),
      id: readRequiredString(row, "id", "project row"),
      name: readRequiredString(row, "name", "project row"),
      updatedAt: readRequiredString(row, "updatedAt", "project row"),
    };
    if (archivedAt !== undefined) snapshot.archivedAt = archivedAt;
    if (codeName !== undefined) snapshot.codeName = codeName;
    if (deletedAt !== undefined) snapshot.deletedAt = deletedAt;
    if (isPrivate !== undefined) snapshot.isPrivate = isPrivate;
    return snapshot;
  });
}

export function readFirstProject(projects: ProjectSnapshot[]): ProjectSnapshot {
  const projectRow = projects[0];
  if (!projectRow) throw new Error("Expected the state response to contain a project.");
  return projectRow;
}
