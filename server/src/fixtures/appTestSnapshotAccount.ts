import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { patch } from "./appTestHttp";
import {
  isUnknownRecord,
  readOptionalBoolean,
  readOptionalNumber,
  readOptionalNumberArray,
  readOptionalString,
  readRequiredString,
  requireModeledKeys,
  type AccountSnapshot,
  type ClosureSnapshot,
  type ResourceSnapshot,
  type TimeOffSnapshot,
} from "./appTestSnapshotCore";
import { readProjectBindings, readResourceSnapshot } from "./appTestSnapshotSchedule";
export function addAccountDisplayOptions(snapshot: AccountSnapshot, row: Record<string, unknown>): void {
  const disciplinesEnabled = readOptionalBoolean(row, "disciplinesEnabled", "account row");
  const externalEnabled = readOptionalBoolean(row, "externalEnabled", "account row");
  const groupResourcesByEngagement = readOptionalBoolean(row, "groupResourcesByEngagement", "account row");
  const placeholdersEnabled = readOptionalBoolean(row, "placeholdersEnabled", "account row");
  if (disciplinesEnabled !== undefined) snapshot.disciplinesEnabled = disciplinesEnabled;
  if (externalEnabled !== undefined) snapshot.externalEnabled = externalEnabled;
  if (groupResourcesByEngagement !== undefined) snapshot.groupResourcesByEngagement = groupResourcesByEngagement;
  if (placeholdersEnabled !== undefined) snapshot.placeholdersEnabled = placeholdersEnabled;
}

export function addAccountWorkflowOptions(snapshot: AccountSnapshot, row: Record<string, unknown>): void {
  const capacityOverviewAccess = readOptionalString(row, "capacityOverviewAccess", "account row");
  const dateStyle = readOptionalString(row, "dateStyle", "account row");
  const inlineActivityCreateEnabled = readOptionalBoolean(row, "inlineActivityCreateEnabled", "account row");
  const showInternalActivities = readOptionalBoolean(row, "showInternalActivities", "account row");
  const showInternalProjects = readOptionalBoolean(row, "showInternalProjects", "account row");
  const showTaskFieldInSchedule = readOptionalBoolean(row, "showTaskFieldInSchedule", "account row");
  if (capacityOverviewAccess !== undefined) snapshot.capacityOverviewAccess = capacityOverviewAccess;
  if (dateStyle !== undefined) snapshot.dateStyle = dateStyle;
  if (inlineActivityCreateEnabled !== undefined) snapshot.inlineActivityCreateEnabled = inlineActivityCreateEnabled;
  if (showInternalActivities !== undefined) snapshot.showInternalActivities = showInternalActivities;
  if (showInternalProjects !== undefined) snapshot.showInternalProjects = showInternalProjects;
  if (showTaskFieldInSchedule !== undefined) snapshot.showTaskFieldInSchedule = showTaskFieldInSchedule;
}

export function readAccountSnapshot(row: Record<string, unknown>): AccountSnapshot {
  requireModeledKeys(
    row,
    [
      "color",
      "capacityOverviewAccess",
      "createdAt",
      "dateStyle",
      "disciplinesEnabled",
      "externalEnabled",
      "groupResourcesByEngagement",
      "id",
      "inlineActivityCreateEnabled",
      "internalColourMode",
      "language",
      "name",
      "placeholdersEnabled",
      "schedulingMode",
      "showInternalActivities",
      "showInternalProjects",
      "showTaskFieldInSchedule",
      "timezone",
      "updatedAt",
      "weekStartsOn",
      "workingDays",
    ],
    "account row",
  );
  const internalColourMode = readOptionalString(row, "internalColourMode", "account row");
  const language = readOptionalString(row, "language", "account row");
  const schedulingMode = readOptionalString(row, "schedulingMode", "account row");
  const timezone = readOptionalString(row, "timezone", "account row");
  const weekStartsOn = readOptionalNumber(row, "weekStartsOn", "account row");
  const workingDays = readOptionalNumberArray(row, "workingDays", "account row");
  const snapshot: AccountSnapshot = {
    color: readRequiredString(row, "color", "account row"),
    createdAt: readRequiredString(row, "createdAt", "account row"),
    id: readRequiredString(row, "id", "account row"),
    name: readRequiredString(row, "name", "account row"),
    updatedAt: readRequiredString(row, "updatedAt", "account row"),
  };
  if (internalColourMode !== undefined) snapshot.internalColourMode = internalColourMode;
  if (language !== undefined) snapshot.language = language;
  if (schedulingMode !== undefined) snapshot.schedulingMode = schedulingMode;
  if (timezone !== undefined) snapshot.timezone = timezone;
  if (weekStartsOn !== undefined) snapshot.weekStartsOn = weekStartsOn;
  if (workingDays !== undefined) snapshot.workingDays = workingDays;
  addAccountDisplayOptions(snapshot, row);
  addAccountWorkflowOptions(snapshot, row);
  return snapshot;
}

export function readAccountSnapshots(rows: unknown[]): AccountSnapshot[] {
  return rows.map((row) => {
    if (!isUnknownRecord(row)) throw new Error("Expected every account row to be an object.");
    return readAccountSnapshot(row);
  });
}

export function readFirstAccount(accounts: AccountSnapshot[]): AccountSnapshot {
  const accountRow = accounts[0];
  if (!accountRow) throw new Error("Expected the state response to contain an account.");
  return accountRow;
}

export function readAccount(accounts: AccountSnapshot[], id: string): AccountSnapshot {
  const accountRow = accounts.find((candidate) => candidate.id === id);
  if (!accountRow) throw new Error(`Expected the state response to contain account ${id}.`);
  return accountRow;
}

export function readClosureSnapshots(rows: unknown[]): ClosureSnapshot[] {
  return rows.map((row) => {
    if (!isUnknownRecord(row)) throw new Error("Expected every closure row to be an object.");
    requireModeledKeys(
      row,
      ["accountId", "createdAt", "endDate", "id", "name", "startDate", "updatedAt"],
      "closure row",
    );
    return {
      accountId: readRequiredString(row, "accountId", "closure row"),
      createdAt: readRequiredString(row, "createdAt", "closure row"),
      endDate: readRequiredString(row, "endDate", "closure row"),
      id: readRequiredString(row, "id", "closure row"),
      name: readRequiredString(row, "name", "closure row"),
      startDate: readRequiredString(row, "startDate", "closure row"),
      updatedAt: readRequiredString(row, "updatedAt", "closure row"),
    };
  });
}

export function readTimeOffSnapshots(rows: unknown[]): TimeOffSnapshot[] {
  return rows.map((row) => {
    if (!isUnknownRecord(row)) throw new Error("Expected every time-off row to be an object.");
    requireModeledKeys(
      row,
      ["accountId", "createdAt", "endDate", "id", "note", "resourceId", "startDate", "type", "updatedAt"],
      "time-off row",
    );
    const note = readOptionalString(row, "note", "time-off row");
    const snapshot: TimeOffSnapshot = {
      accountId: readRequiredString(row, "accountId", "time-off row"),
      createdAt: readRequiredString(row, "createdAt", "time-off row"),
      endDate: readRequiredString(row, "endDate", "time-off row"),
      id: readRequiredString(row, "id", "time-off row"),
      resourceId: readRequiredString(row, "resourceId", "time-off row"),
      startDate: readRequiredString(row, "startDate", "time-off row"),
      type: readRequiredString(row, "type", "time-off row"),
      updatedAt: readRequiredString(row, "updatedAt", "time-off row"),
    };
    if (note !== undefined) snapshot.note = note;
    return snapshot;
  });
}

export function readOnlyTimeOff(rows: TimeOffSnapshot[]): TimeOffSnapshot {
  if (rows.length !== 1) throw new Error("Expected the state response to contain exactly one time-off row.");
  const row = rows[0];
  if (!row) throw new Error("Expected the state response to contain a time-off row.");
  return row;
}

export function readResourceSnapshots(rows: unknown[]): ResourceSnapshot[] {
  return readProjectBindings(rows, "resource").map((binding, index) => {
    const source = rows[index];
    if (!isUnknownRecord(source)) throw new Error("Expected every resource row to be an object.");
    return readResourceSnapshot(source, binding);
  });
}

export function readFirstResource(resources: ResourceSnapshot[]): ResourceSnapshot {
  const resource = resources[0];
  if (!resource) throw new Error("Expected the state response to contain a resource.");
  return resource;
}

export function readResource(resources: ResourceSnapshot[], id: string): ResourceSnapshot {
  const resource = resources.find((candidate) => candidate.id === id);
  if (!resource) throw new Error(`Expected the state response to contain resource ${id}.`);
  return resource;
}

export function readResourceResponse(response: LightMyRequestResponse): ResourceSnapshot {
  return readFirstResource(readResourceSnapshots([response.json()]));
}

export async function patchResourceFavourite(app: FastifyInstance, isFavourite: boolean): Promise<ResourceSnapshot> {
  return readResourceResponse(await patch({ app, entity: "resources", id: "r1", payload: { isFavourite } }));
}
