import { describe, it, expect, vi } from "vitest";
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from "fastify";
import { createApp, resolveErrorStatus, MAX_BATCH_OPS, type AppOptions } from "./app";
import { ValidationError } from "./validate";
import { getRow, insertRow, openDb, upsertRow, type Db } from "./db";
import { tx } from "./txn";
import {
  FIXTURE_ACCOUNT,
  FIXTURE_CLIENT,
  FIXTURE_DISCIPLINE,
  FIXTURE_PROJECT,
  FIXTURE_PHASE,
  FIXTURE_RESOURCE,
  FIXTURE_RESOURCE_PERSON,
  FIXTURE_RESOURCE_EXTERNAL,
  FIXTURE_ACTIVITY,
  FIXTURE_ACTIVITY_INTERNAL,
  FIXTURE_ACTIVITY_REPEATABLE,
  FIXTURE_ALLOCATION,
  FIXTURE_ALLOCATION_ATTRIBUTED,
  FIXTURE_TIMEOFF,
} from "@capacitylens/shared/data/fixtures";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { addDaysISO } from "@capacitylens/shared/lib/dateMath";
import { MAX_SPAN_DAYS } from "@capacitylens/shared/lib/schedulingDays";
import { isIsoInstant } from "@capacitylens/shared/account/types";
import { runImportWorker } from "./runImportWorker";
import type { AuditEntry } from "./audit";
import { WorkQueueFullError } from "./workQueue";
import { emptyAppData, EXPORT_SCHEMA_VERSION } from "@capacitylens/shared/types/entities";

// API integration tests: drive the real Fastify app + a real (in-memory) node:sqlite
// DB via inject(). Covers CRUD, whole-state read, cascade deletes, import round-trip,
// migration reuse, and the validation rules — which run the SAME shared domain-core
// the client uses, so passing here proves "server validation == client validation".

const TS = "2026-01-01T00:00:00.000Z";
const MAX_BATCH_HANDLER_BUDGET_MS = 4_000;
const CROSS_ACCOUNT_ACTIVITY_ERROR = "Allocation must reference an activity under an active project in this company.";
const meta = () => ({ createdAt: TS, updatedAt: TS });
const withoutRevision = <T extends object>(row: T) => {
  const copy = { ...row } as Record<string, unknown>;
  delete copy.createdAt;
  delete copy.updatedAt;
  return copy;
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function freshApp(allowReset = true, extra: Partial<AppOptions> = {}) {
  const db = openDb(":memory:");
  return {
    app: createApp(db, { allowReset, optimisticConcurrency: false, ...extra }),
    db,
  };
}

const FULL_APP_TABLE_SELECT =
  /^\s*SELECT \* FROM (accounts|disciplines|resources|clients|projects|phases|activities|allocations|timeOff)\s*$/;

function dbTrackingFullTableSelects(): {
  db: Db;
  raw: Db;
  fullTableSelects: string[];
} {
  const raw = openDb(":memory:");
  const fullTableSelects: string[] = [];
  const db = new Proxy(raw, {
    get(target, property) {
      if (property === "prepare") {
        return (sql: string) => {
          if (FULL_APP_TABLE_SELECT.test(sql)) fullTableSelects.push(sql);
          return target.prepare(sql);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as Db;
  return { db, raw, fullTableSelects };
}

const account = (id: string) => ({
  id,
  name: "Studio",
  color: "#5c34d4",
  ...meta(),
});
const client = (id: string, accountId: string) => ({
  id,
  accountId,
  name: "Acme",
  color: "#5c34d4",
  ...meta(),
});
const project = (id: string, accountId: string, clientId: string) => ({
  id,
  accountId,
  name: "Web",
  clientId,
  color: "#5c34d4",
  ...meta(),
});

interface ActivityInput {
  id: string;
  accountId: string;
  projectId: string;
  phaseId?: string | undefined;
}

const activity = ({ id, accountId, projectId, phaseId }: ActivityInput) => ({
  id,
  accountId,
  name: "Activity",
  kind: "project",
  projectId,
  phaseId,
  ...meta(),
});
const person = (id: string, accountId: string) => ({
  id,
  accountId,
  kind: "person",
  role: "Designer",
  employmentType: "permanent",
  engagement: "studio" as const,
  workingHoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  halfDays: [],
  color: "#5c34d4",
  ...meta(),
});
const placeholder = (id: string, accountId: string, projectId?: string) => ({
  ...person(id, accountId),
  kind: "placeholder",
  projectId,
});

interface AllocationInput {
  id: string;
  accountId: string;
  resourceId: string;
  activityId: string;
  o?: Record<string, unknown> | undefined;
}

const allocation = ({ id, accountId, resourceId, activityId, o = {} }: AllocationInput) =>
  // Object.assign (rather than `{ ...base, ...o }`) so overriding well-known keys via
  // `o` doesn't trip TS2783 on the literal's explicit startDate/endDate/etc.
  Object.assign(
    {
      id,
      accountId,
      resourceId,
      activityId,
      startDate: "2026-01-01",
      endDate: "2026-01-05",
      hoursPerDay: 8,
      status: "confirmed",
      ...meta(),
    },
    o,
  );

interface TimeOffInput {
  id: string;
  accountId: string;
  resourceId: string;
  type?: string | undefined;
}

const timeOff = ({ id, accountId, resourceId, type = "holiday" }: TimeOffInput) => ({
  id,
  accountId,
  resourceId,
  startDate: "2026-06-03",
  endDate: "2026-06-03",
  type,
  ...meta(),
});
const closure = (id: string, accountId: string, name = "Christmas shutdown") => ({
  id,
  accountId,
  name,
  startDate: "2026-12-24",
  endDate: "2026-12-27",
  ...meta(),
});

// app.inject's overloads resolve to a union that hides statusCode/json; this wrapper
// pins the single Promise-returning shape so call sites stay terse.
const call = (app: FastifyInstance, opts: InjectOptions): Promise<LightMyRequestResponse> =>
  app.inject(opts) as unknown as Promise<LightMyRequestResponse>;

interface ErrorResponse {
  error: string;
  code?: string;
}

function readErrorResponse(response: LightMyRequestResponse): ErrorResponse {
  const value: unknown = response.json();
  if (typeof value !== "object" || value === null || !("error" in value) || typeof value.error !== "string") {
    throw new Error("Expected an error response with a string error.");
  }
  if ("code" in value) {
    if (typeof value.code !== "string") {
      throw new Error("Expected an error response code to be a string.");
    }
    return { error: value.error, code: value.code };
  }
  return { error: value.error };
}

const body = (payload: unknown) => payload as NonNullable<InjectOptions["payload"]>;

const post = (app: FastifyInstance, entity: string, payload: unknown) =>
  call(app, { method: "POST", url: `/api/${entity}`, payload: body(payload) });

interface PutInput {
  app: FastifyInstance;
  entity: string;
  id: string;
  payload: unknown;
}

const put = ({ app, entity, id, payload }: PutInput) =>
  call(app, {
    method: "PUT",
    url: `/api/${entity}/${id}`,
    payload: body(payload),
  });

interface PatchInput {
  app: FastifyInstance;
  entity: string;
  id: string;
  payload: unknown;
}

const patch = ({ app, entity, id, payload }: PatchInput) =>
  call(app, {
    method: "PATCH",
    url: `/api/${entity}/${id}`,
    payload: body(payload),
  });

interface DelInput {
  app: FastifyInstance;
  entity: string;
  id: string;
  accountId?: string | undefined;
}

// Scoped tables now REQUIRE an asserted owning account on DELETE; pass accountId for them.
// accounts (top-level) carry none, so accountId is omitted there.
const del = ({ app, entity, id, accountId }: DelInput) =>
  call(app, {
    method: "DELETE",
    url: accountId ? `/api/${entity}/${id}?accountId=${accountId}` : `/api/${entity}/${id}`,
  });
const batch = (app: FastifyInstance, ops: unknown[]) =>
  call(app, { method: "POST", url: "/api/batch", payload: body({ ops }) });

interface OrderedBatchInput {
  app: FastifyInstance;
  sessionId: string;
  sequence: number;
  ops: unknown[];
}

const orderedBatch = ({ app, sessionId, sequence, ops }: OrderedBatchInput) =>
  call(app, {
    method: "POST",
    url: "/api/batch",
    headers: {
      "x-capacitylens-sync-session": sessionId,
      "x-capacitylens-sync-sequence": String(sequence),
    },
    payload: body({ ops }),
  });
const state = async (app: FastifyInstance) => {
  // Generic account creation now guarantees its required Internal client. Most legacy CRUD tests
  // predate that invariant and reason about the regular clients they explicitly create. The exact
  // state validator retains that view by filtering rows whose validated builtin flag is true.
  return readValidatedStateValue((await call(app, { method: "GET", url: "/api/state" })).json());
};

interface ProjectBinding {
  id: string;
  projectId?: string;
}

interface ActivitySnapshot extends ProjectBinding {
  accountId: string;
  createdAt: string;
  kind: string;
  name: string;
  phaseId?: string;
  updatedAt: string;
}

interface DisciplineSnapshot {
  accountId: string;
  color?: string;
  createdAt: string;
  id: string;
  name: string;
  sortOrder: number;
  updatedAt: string;
}

interface PhaseSnapshot {
  accountId: string;
  createdAt: string;
  id: string;
  name: string;
  projectId: string;
  updatedAt: string;
}

interface ResourceSnapshot extends ProjectBinding {
  accountId: string;
  color: string;
  createdAt: string;
  disciplineId?: string;
  firstAvailableDate?: string;
  engagement: string;
  employmentType?: string;
  halfDays: number[];
  isFavourite?: boolean;
  kind: string;
  lastAvailableDate?: string;
  name?: string;
  role: string;
  updatedAt: string;
  workingDays: number[];
  workingHoursPerDay: number;
}

interface AllocationSnapshot {
  accountId: string;
  activityId: string;
  createdAt: string;
  endDate: string;
  hoursPerDay: number;
  id: string;
  ignoreWeekends?: boolean;
  note?: string;
  task?: string;
  projectId?: string;
  resourceId: string;
  seriesId?: string;
  startDate: string;
  status: string;
  updatedAt: string;
}

interface ProjectSnapshot {
  accountId: string;
  archivedAt?: string;
  clientId: string;
  codeName?: string;
  color: string;
  createdAt: string;
  deletedAt?: string;
  id: string;
  isPrivate?: boolean;
  name: string;
  updatedAt: string;
}

interface ClosureSnapshot {
  accountId: string;
  createdAt: string;
  endDate: string;
  id: string;
  name: string;
  startDate: string;
  updatedAt: string;
}

interface TimeOffSnapshot {
  accountId: string;
  createdAt: string;
  endDate: string;
  id: string;
  note?: string;
  resourceId: string;
  startDate: string;
  type: string;
  updatedAt: string;
}

interface AccountSnapshot {
  color: string;
  createdAt: string;
  disciplinesEnabled?: boolean;
  externalEnabled?: boolean;
  groupResourcesByEngagement?: boolean;
  id: string;
  inlineActivityCreateEnabled?: boolean;
  internalColourMode?: string;
  language?: string;
  name: string;
  placeholdersEnabled?: boolean;
  schedulingMode?: string;
  showInternalActivities?: boolean;
  showInternalProjects?: boolean;
  showTaskFieldInSchedule?: boolean;
  timezone?: string;
  updatedAt: string;
  weekStartsOn?: number;
  workingDays?: number[];
}

interface ImportSummary {
  auditWarning: boolean;
  imported: number;
  maxRecords: number;
  skipped: number;
}

interface BatchRevisionSnapshot {
  createdAt: string;
  id: string;
  rewrite?: true;
  table: string;
  updatedAt: string;
}

interface BatchArchiveSnapshot {
  archived: boolean;
  id: string;
  table: string;
}

interface BatchReceipt {
  applied: number;
  archives: BatchArchiveSnapshot[];
  auditWarning: boolean;
  changed: number;
  ok: boolean;
  revisions: BatchRevisionSnapshot[];
  superseded?: boolean;
}

interface RewrittenAllocationSnapshot {
  createdAt: string;
  id: string;
  updatedAt: string;
}

interface ActivityWriteResponse extends ActivitySnapshot {
  rewrittenAllocations: RewrittenAllocationSnapshot[];
}

interface ClientSnapshot {
  accountId: string;
  archivedAt?: string;
  builtin?: boolean;
  codeName?: string;
  color: string;
  createdAt: string;
  deletedAt?: string;
  id: string;
  isPrivate?: boolean;
  name: string;
  updatedAt: string;
}

type ClientResponse = ClientSnapshot;

interface ValidatedStateResponse {
  accounts: AccountSnapshot[];
  activities: ActivitySnapshot[];
  allocations: AllocationSnapshot[];
  clients: ClientSnapshot[];
  closures: ClosureSnapshot[];
  disciplines: DisciplineSnapshot[];
  phases: PhaseSnapshot[];
  projects: ProjectSnapshot[];
  resources: ResourceSnapshot[];
  timeOff: TimeOffSnapshot[];
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readRequiredString(value: Record<string, unknown>, key: string, context: string): string {
  const field = value[key];
  if (typeof field !== "string") throw new Error(`Expected ${context} ${key} to be a string.`);
  return field;
}

function readRequiredNumber(value: Record<string, unknown>, key: string, context: string): number {
  const field = value[key];
  if (typeof field !== "number") throw new Error(`Expected ${context} ${key} to be a number.`);
  return field;
}

function readOptionalString(value: Record<string, unknown>, key: string, context: string): string | undefined {
  if (!(key in value)) return undefined;
  return readRequiredString(value, key, context);
}

function readOptionalBoolean(value: Record<string, unknown>, key: string, context: string): boolean | undefined {
  if (!(key in value)) return undefined;
  const field = value[key];
  if (typeof field !== "boolean") throw new Error(`Expected ${context} ${key} to be boolean.`);
  return field;
}

function readRequiredBoolean(value: Record<string, unknown>, key: string, context: string): boolean {
  const field = value[key];
  if (typeof field !== "boolean") throw new Error(`Expected ${context} ${key} to be boolean.`);
  return field;
}

function readOptionalNumber(value: Record<string, unknown>, key: string, context: string): number | undefined {
  if (!(key in value)) return undefined;
  return readRequiredNumber(value, key, context);
}

function readNumberArray(value: Record<string, unknown>, key: string, context: string): number[] {
  const field = value[key];
  if (!Array.isArray(field) || !field.every((item): item is number => typeof item === "number")) {
    throw new Error(`Expected ${context} ${key} to contain numbers.`);
  }
  return field;
}

function readOptionalNumberArray(value: Record<string, unknown>, key: string, context: string): number[] | undefined {
  if (!(key in value)) return undefined;
  return readNumberArray(value, key, context);
}

function requireModeledKeys(value: Record<string, unknown>, keys: readonly string[], context: string): void {
  const unexpectedKey = Object.keys(value).find((key) => !keys.includes(key));
  if (unexpectedKey) throw new Error(`Expected ${context} to omit unexpected key ${unexpectedKey}.`);
}

function readStateArray(value: Record<string, unknown>, key: string): unknown[] {
  if (!(key in value) || !Array.isArray(value[key])) {
    throw new Error(`Expected the state response to contain a ${key} array.`);
  }
  return value[key];
}

function readProjectBindings(rows: unknown[], table: string): ProjectBinding[] {
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

function readActivitySnapshots(rows: unknown[]): ActivitySnapshot[] {
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

function readDisciplineSnapshots(rows: unknown[]): DisciplineSnapshot[] {
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

function readFirstDiscipline(disciplines: DisciplineSnapshot[]): DisciplineSnapshot {
  const disciplineRow = disciplines[0];
  if (!disciplineRow) throw new Error("Expected the state response to contain a discipline.");
  return disciplineRow;
}

function readPhaseSnapshots(rows: unknown[]): PhaseSnapshot[] {
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

function readFirstPhase(phases: PhaseSnapshot[]): PhaseSnapshot {
  const phaseRow = phases[0];
  if (!phaseRow) throw new Error("Expected the state response to contain a phase.");
  return phaseRow;
}

function readFirstActivity(activities: ActivitySnapshot[]): ActivitySnapshot {
  const activityRow = activities[0];
  if (!activityRow) throw new Error("Expected the state response to contain an activity.");
  return activityRow;
}

function readActivity(activities: ActivitySnapshot[], id: string): ActivitySnapshot {
  const activityRow = activities.find((candidate) => candidate.id === id);
  if (!activityRow) throw new Error(`Expected the state response to contain activity ${id}.`);
  return activityRow;
}

function readResourceSnapshot(source: Record<string, unknown>, binding: ProjectBinding): ResourceSnapshot {
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

function readAllocationSnapshots(rows: unknown[]): AllocationSnapshot[] {
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

function readFirstAllocation(allocations: AllocationSnapshot[]): AllocationSnapshot {
  const allocationRow = allocations[0];
  if (!allocationRow) throw new Error("Expected the state response to contain an allocation.");
  return allocationRow;
}

function readAllocation(allocations: AllocationSnapshot[], id: string): AllocationSnapshot {
  const allocationRow = allocations.find((candidate) => candidate.id === id);
  if (!allocationRow) throw new Error(`Expected the state response to contain allocation ${id}.`);
  return allocationRow;
}

function readProjectSnapshots(rows: unknown[]): ProjectSnapshot[] {
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

function readFirstProject(projects: ProjectSnapshot[]): ProjectSnapshot {
  const projectRow = projects[0];
  if (!projectRow) throw new Error("Expected the state response to contain a project.");
  return projectRow;
}

function addAccountDisplayOptions(snapshot: AccountSnapshot, row: Record<string, unknown>): void {
  const disciplinesEnabled = readOptionalBoolean(row, "disciplinesEnabled", "account row");
  const externalEnabled = readOptionalBoolean(row, "externalEnabled", "account row");
  const groupResourcesByEngagement = readOptionalBoolean(row, "groupResourcesByEngagement", "account row");
  const placeholdersEnabled = readOptionalBoolean(row, "placeholdersEnabled", "account row");
  if (disciplinesEnabled !== undefined) snapshot.disciplinesEnabled = disciplinesEnabled;
  if (externalEnabled !== undefined) snapshot.externalEnabled = externalEnabled;
  if (groupResourcesByEngagement !== undefined) snapshot.groupResourcesByEngagement = groupResourcesByEngagement;
  if (placeholdersEnabled !== undefined) snapshot.placeholdersEnabled = placeholdersEnabled;
}

function addAccountWorkflowOptions(snapshot: AccountSnapshot, row: Record<string, unknown>): void {
  const inlineActivityCreateEnabled = readOptionalBoolean(row, "inlineActivityCreateEnabled", "account row");
  const showInternalActivities = readOptionalBoolean(row, "showInternalActivities", "account row");
  const showInternalProjects = readOptionalBoolean(row, "showInternalProjects", "account row");
  const showTaskFieldInSchedule = readOptionalBoolean(row, "showTaskFieldInSchedule", "account row");
  if (inlineActivityCreateEnabled !== undefined) snapshot.inlineActivityCreateEnabled = inlineActivityCreateEnabled;
  if (showInternalActivities !== undefined) snapshot.showInternalActivities = showInternalActivities;
  if (showInternalProjects !== undefined) snapshot.showInternalProjects = showInternalProjects;
  if (showTaskFieldInSchedule !== undefined) snapshot.showTaskFieldInSchedule = showTaskFieldInSchedule;
}

function readAccountSnapshot(row: Record<string, unknown>): AccountSnapshot {
  requireModeledKeys(
    row,
    [
      "color",
      "createdAt",
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

function readAccountSnapshots(rows: unknown[]): AccountSnapshot[] {
  return rows.map((row) => {
    if (!isUnknownRecord(row)) throw new Error("Expected every account row to be an object.");
    return readAccountSnapshot(row);
  });
}

function readFirstAccount(accounts: AccountSnapshot[]): AccountSnapshot {
  const accountRow = accounts[0];
  if (!accountRow) throw new Error("Expected the state response to contain an account.");
  return accountRow;
}

function readAccount(accounts: AccountSnapshot[], id: string): AccountSnapshot {
  const accountRow = accounts.find((candidate) => candidate.id === id);
  if (!accountRow) throw new Error(`Expected the state response to contain account ${id}.`);
  return accountRow;
}

function readClosureSnapshots(rows: unknown[]): ClosureSnapshot[] {
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

function readTimeOffSnapshots(rows: unknown[]): TimeOffSnapshot[] {
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

function readOnlyTimeOff(rows: TimeOffSnapshot[]): TimeOffSnapshot {
  if (rows.length !== 1) throw new Error("Expected the state response to contain exactly one time-off row.");
  const row = rows[0];
  if (!row) throw new Error("Expected the state response to contain a time-off row.");
  return row;
}

function readResourceSnapshots(rows: unknown[]): ResourceSnapshot[] {
  return readProjectBindings(rows, "resource").map((binding, index) => {
    const source = rows[index];
    if (!isUnknownRecord(source)) throw new Error("Expected every resource row to be an object.");
    return readResourceSnapshot(source, binding);
  });
}

function readFirstResource(resources: ResourceSnapshot[]): ResourceSnapshot {
  const resource = resources[0];
  if (!resource) throw new Error("Expected the state response to contain a resource.");
  return resource;
}

function readResource(resources: ResourceSnapshot[], id: string): ResourceSnapshot {
  const resource = resources.find((candidate) => candidate.id === id);
  if (!resource) throw new Error(`Expected the state response to contain resource ${id}.`);
  return resource;
}

function readResourceResponse(response: LightMyRequestResponse): ResourceSnapshot {
  return readFirstResource(readResourceSnapshots([response.json()]));
}

async function patchResourceFavourite(app: FastifyInstance, isFavourite: boolean): Promise<ResourceSnapshot> {
  return readResourceResponse(await patch({ app, entity: "resources", id: "r1", payload: { isFavourite } }));
}

function readAllClientSnapshots(rows: unknown[]): ClientSnapshot[] {
  return rows.map((row) => {
    if (!isUnknownRecord(row)) throw new Error("Expected every client row to be an object.");
    requireModeledKeys(
      row,
      [
        "accountId",
        "archivedAt",
        "builtin",
        "codeName",
        "color",
        "createdAt",
        "deletedAt",
        "id",
        "isPrivate",
        "name",
        "updatedAt",
      ],
      "client row",
    );
    const clientRow: ClientSnapshot = {
      accountId: readRequiredString(row, "accountId", "client row"),
      color: readRequiredString(row, "color", "client row"),
      createdAt: readRequiredString(row, "createdAt", "client row"),
      id: readRequiredString(row, "id", "client row"),
      name: readRequiredString(row, "name", "client row"),
      updatedAt: readRequiredString(row, "updatedAt", "client row"),
    };
    const archivedAt = readOptionalString(row, "archivedAt", "client row");
    const builtin = readOptionalBoolean(row, "builtin", "client row");
    const codeName = readOptionalString(row, "codeName", "client row");
    const deletedAt = readOptionalString(row, "deletedAt", "client row");
    const isPrivate = readOptionalBoolean(row, "isPrivate", "client row");
    if (archivedAt !== undefined) clientRow.archivedAt = archivedAt;
    if (builtin !== undefined) clientRow.builtin = builtin;
    if (codeName !== undefined) clientRow.codeName = codeName;
    if (deletedAt !== undefined) clientRow.deletedAt = deletedAt;
    if (isPrivate !== undefined) clientRow.isPrivate = isPrivate;
    return clientRow;
  });
}

function readClientSnapshots(rows: unknown[]): ClientSnapshot[] {
  return readAllClientSnapshots(rows).filter((clientRow) => clientRow.builtin !== true);
}

function readAllStateClients(response: LightMyRequestResponse): ClientSnapshot[] {
  const value: unknown = response.json();
  if (!isUnknownRecord(value)) throw new Error("Expected the state response to be an object.");
  return readAllClientSnapshots(readStateArray(value, "clients"));
}

function readFirstClient(clients: ClientSnapshot[]): ClientSnapshot {
  const clientRow = clients[0];
  if (!clientRow) throw new Error("Expected the state response to contain a client.");
  return clientRow;
}

function readFirstClientName(clients: ClientSnapshot[]): string {
  return readFirstClient(clients).name;
}

function readClientIds(clients: ClientSnapshot[]): string[] {
  return clients.map(({ id }) => id);
}

function readClientResponseValue(value: unknown): ClientResponse {
  if (!isUnknownRecord(value)) throw new Error("Expected the client response to be an object.");
  return {
    accountId: readRequiredString(value, "accountId", "client response"),
    color: readRequiredString(value, "color", "client response"),
    createdAt: readRequiredString(value, "createdAt", "client response"),
    id: readRequiredString(value, "id", "client response"),
    name: readRequiredString(value, "name", "client response"),
    updatedAt: readRequiredString(value, "updatedAt", "client response"),
  };
}

function readClientResponse(response: LightMyRequestResponse): ClientResponse {
  return readClientResponseValue(response.json());
}

interface ConflictResponse {
  error: string;
  current: ClientResponse;
}

function readConflictResponse(response: LightMyRequestResponse): ConflictResponse {
  const value: unknown = response.json();
  if (!isUnknownRecord(value) || typeof value.error !== "string" || !("current" in value)) {
    throw new Error("Expected a conflict response with an error and current row.");
  }
  return { error: value.error, current: readClientResponseValue(value.current) };
}

function readBatchSuperseded(response: LightMyRequestResponse): boolean | undefined {
  const value: unknown = response.json();
  if (!isUnknownRecord(value)) throw new Error("Expected the batch response to be an object.");
  if (!("superseded" in value)) return undefined;
  if (typeof value.superseded !== "boolean") {
    throw new Error("Expected a present batch superseded field to be boolean.");
  }
  return value.superseded;
}

function readBatchReceipt(response: LightMyRequestResponse): BatchReceipt {
  const value: unknown = response.json();
  if (!isUnknownRecord(value)) throw new Error("Expected the batch response to be an object.");
  requireModeledKeys(
    value,
    ["applied", "archives", "auditWarning", "changed", "ok", "revisions", "superseded"],
    "batch response",
  );
  const revisions = readStateArray(value, "revisions").map((revision) => {
    if (!isUnknownRecord(revision)) throw new Error("Expected every batch revision to be an object.");
    requireModeledKeys(revision, ["createdAt", "id", "rewrite", "table", "updatedAt"], "batch revision");
    const rewrite = revision.rewrite;
    if (rewrite !== undefined && rewrite !== true) {
      throw new Error("Expected a present batch revision rewrite field to be true.");
    }
    const snapshot: BatchRevisionSnapshot = {
      createdAt: readRequiredString(revision, "createdAt", "batch revision"),
      id: readRequiredString(revision, "id", "batch revision"),
      table: readRequiredString(revision, "table", "batch revision"),
      updatedAt: readRequiredString(revision, "updatedAt", "batch revision"),
    };
    if (rewrite === true) snapshot.rewrite = true;
    return snapshot;
  });
  const archives = readStateArray(value, "archives").map((archive) => {
    if (!isUnknownRecord(archive)) throw new Error("Expected every batch archive to be an object.");
    requireModeledKeys(archive, ["archived", "id", "table"], "batch archive");
    return {
      archived: readRequiredBoolean(archive, "archived", "batch archive"),
      id: readRequiredString(archive, "id", "batch archive"),
      table: readRequiredString(archive, "table", "batch archive"),
    };
  });
  const receipt: BatchReceipt = {
    applied: readRequiredNumber(value, "applied", "batch response"),
    archives,
    auditWarning: readRequiredBoolean(value, "auditWarning", "batch response"),
    changed: readRequiredNumber(value, "changed", "batch response"),
    ok: readRequiredBoolean(value, "ok", "batch response"),
    revisions,
  };
  const superseded = readOptionalBoolean(value, "superseded", "batch response");
  if (superseded !== undefined) receipt.superseded = superseded;
  return receipt;
}

function readActivityWriteResponse(response: LightMyRequestResponse): ActivityWriteResponse {
  const value: unknown = response.json();
  if (!isUnknownRecord(value)) throw new Error("Expected the activity response to be an object.");
  requireModeledKeys(
    value,
    ["accountId", "createdAt", "id", "kind", "name", "phaseId", "projectId", "rewrittenAllocations", "updatedAt"],
    "activity response",
  );
  const phaseId = readOptionalString(value, "phaseId", "activity response");
  const projectId = readOptionalString(value, "projectId", "activity response");
  const activity: ActivitySnapshot = {
    accountId: readRequiredString(value, "accountId", "activity response"),
    createdAt: readRequiredString(value, "createdAt", "activity response"),
    id: readRequiredString(value, "id", "activity response"),
    kind: readRequiredString(value, "kind", "activity response"),
    name: readRequiredString(value, "name", "activity response"),
    updatedAt: readRequiredString(value, "updatedAt", "activity response"),
  };
  if (phaseId !== undefined) activity.phaseId = phaseId;
  if (projectId !== undefined) activity.projectId = projectId;
  const rewrittenAllocations = readStateArray(value, "rewrittenAllocations").map((revision) => {
    if (!isUnknownRecord(revision)) throw new Error("Expected every rewritten allocation to be an object.");
    requireModeledKeys(revision, ["createdAt", "id", "updatedAt"], "rewritten allocation");
    return {
      createdAt: readRequiredString(revision, "createdAt", "rewritten allocation"),
      id: readRequiredString(revision, "id", "rewritten allocation"),
      updatedAt: readRequiredString(revision, "updatedAt", "rewritten allocation"),
    };
  });
  return { ...activity, rewrittenAllocations };
}

function readProjectId(rows: ProjectBinding[], id: string): string | undefined {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Expected the state response to contain row ${id}.`);
  return row.projectId;
}

function readFirstProjectId(rows: ProjectBinding[]): string | undefined {
  const row = rows[0];
  if (!row) throw new Error("Expected the state response to contain a project-bound row.");
  return row.projectId;
}

function readValidatedStateValue(value: unknown): ValidatedStateResponse {
  if (!isUnknownRecord(value)) {
    throw new Error("Expected the state response to be an object.");
  }
  return {
    accounts: readAccountSnapshots(readStateArray(value, "accounts")),
    activities: readActivitySnapshots(readStateArray(value, "activities")),
    allocations: readAllocationSnapshots(readStateArray(value, "allocations")),
    clients: readClientSnapshots(readStateArray(value, "clients")),
    closures: readClosureSnapshots(readStateArray(value, "closures")),
    disciplines: readDisciplineSnapshots(readStateArray(value, "disciplines")),
    phases: readPhaseSnapshots(readStateArray(value, "phases")),
    projects: readProjectSnapshots(readStateArray(value, "projects")),
    resources: readResourceSnapshots(readStateArray(value, "resources")),
    timeOff: readTimeOffSnapshots(readStateArray(value, "timeOff")),
  };
}

function readSuccessfulStateResponse(response: LightMyRequestResponse): {
  state: ValidatedStateResponse;
  value: unknown;
} {
  expect(response.statusCode).toBe(200);
  const value: unknown = response.json();
  return { state: readValidatedStateValue(value), value };
}

function readStateResponse(response: LightMyRequestResponse): ValidatedStateResponse {
  return readValidatedStateValue(response.json());
}

function readImportSummary(response: LightMyRequestResponse): ImportSummary {
  const value: unknown = response.json();
  if (!isUnknownRecord(value)) throw new Error("Expected the import response to be an object.");
  requireModeledKeys(value, ["auditWarning", "imported", "maxRecords", "skipped"], "import response");
  const auditWarning = value.auditWarning;
  if (typeof auditWarning !== "boolean") throw new Error("Expected import response auditWarning to be boolean.");
  return {
    auditWarning,
    imported: readRequiredNumber(value, "imported", "import response"),
    maxRecords: readRequiredNumber(value, "maxRecords", "import response"),
    skipped: readRequiredNumber(value, "skipped", "import response"),
  };
}

async function readValidatedState(app: FastifyInstance): Promise<ValidatedStateResponse> {
  return readValidatedStateValue((await call(app, { method: "GET", url: "/api/state" })).json());
}

async function readStateClients(app: FastifyInstance): Promise<ClientSnapshot[]> {
  return (await readValidatedState(app)).clients;
}

async function readStateAccount(app: FastifyInstance): Promise<AccountSnapshot> {
  return readFirstAccount((await readValidatedState(app)).accounts);
}

async function readStateAllocation(app: FastifyInstance, id: string): Promise<AllocationSnapshot> {
  return readAllocation((await readValidatedState(app)).allocations, id);
}

/** Seed a minimal account → client → project → activity → person chain. */
async function scaffold(app: FastifyInstance) {
  await post(app, "accounts", account("a1"));
  await post(app, "clients", client("c1", "a1"));
  await post(app, "projects", project("p1", "a1", "c1"));
  await post(app, "activities", activity({ id: "t1", accountId: "a1", projectId: "p1" }));
  await post(app, "resources", person("r1", "a1"));
}

function readUpdatedAt(response: LightMyRequestResponse): string {
  const payload: unknown = response.json();
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("updatedAt" in payload) ||
    !isIsoInstant(payload.updatedAt)
  ) {
    throw new TypeError("Expected the response to contain a valid updatedAt timestamp.");
  }
  return payload.updatedAt;
}

async function createExternalAllocationEdit(app: FastifyInstance) {
  await scaffold(app);
  const allocationRow = allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t1" });
  const created = await post(app, "allocations", allocationRow);
  const baseRevision = readUpdatedAt(created);
  const external = await put({
    app,
    entity: "allocations",
    id: "al1",
    payload: {
      ...allocationRow,
      note: "Committed by another browser",
      updatedAt: baseRevision,
    },
  });
  return { baseRevision, external };
}

describe("health + state", () => {
  it("reports health and starts empty", async () => {
    const { app } = freshApp();
    expect((await call(app, { method: "GET", url: "/api/health" })).json()).toEqual({ ok: true });
    const s = await readValidatedState(app);
    expect(s.accounts).toEqual([]);
    expect((await call(app, { method: "GET", url: "/api/meta" })).json()).toEqual({ hasData: false });
  });
});

describe("request/connection timeouts (slowloris guard for the direct-exposure deploy)", () => {
  it("bounds both requestTimeout and connectionTimeout — Fastify defaults both to 0 (disabled)", () => {
    const { app } = freshApp();
    // initialConfig's TS typing omits requestTimeout (a Fastify 5 typings gap — it's present at
    // runtime, ajv-defaulted like every other init option), so assert against the raw Node server
    // Fastify actually configures: requestTimeout is a direct assignment, connectionTimeout is
    // applied via server.setTimeout() (which Node mirrors onto the `timeout` property).
    expect(app.initialConfig.connectionTimeout).toBe(30_000);
    expect(app.server.requestTimeout).toBe(30_000);
    expect(app.server.timeout).toBe(30_000);
  });
});

function createCrudCreationTests(): void {
  it("creates every entity type and reads them back via /api/state", async () => {
    const { app } = freshApp();
    await scaffold(app);
    expect(
      (await post(app, "allocations", allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t1" })))
        .statusCode,
    ).toBe(201);
    const s = await readValidatedState(app);
    expect(s.accounts).toHaveLength(1);
    expect(s.clients).toHaveLength(1);
    expect(s.projects).toHaveLength(1);
    expect(s.activities).toHaveLength(1);
    expect(s.resources).toHaveLength(1);
    expect(s.allocations).toHaveLength(1);
    // Round-trips exactly: both weekday JSON arrays + omitted optionals survive.
    expect(withoutRevision(readFirstResource(s.resources))).toEqual(
      withoutRevision({
        ...person("r1", "a1"),
        name: "Unnamed person",
      }),
    );
    expect(withoutRevision(readFirstAllocation(s.allocations))).toEqual(
      withoutRevision(allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t1" })),
    );
  });

  it("persists an explicit mixed full and half-day resource pattern", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const response = await post(app, "resources", { ...person("r1", "a1"), halfDays: [2, 4] });

    expect(response.statusCode).toBe(201);
    expect(readFirstResource((await readValidatedState(app)).resources)).toMatchObject({
      workingDays: [1, 2, 3, 4, 5],
      halfDays: [2, 4],
    });
  });

  it("normalizes placeholder working patterns on create and partial update", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const created = await post(app, "resources", {
      ...placeholder("ph", "a1", "p1"),
      workingDays: [0, 6],
      halfDays: [6],
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ workingDays: [1, 2, 3, 4, 5], halfDays: [] });
    const updated = await patch({ app, entity: "resources", id: "ph", payload: { workingDays: [2], halfDays: [2] } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ workingDays: [1, 2, 3, 4, 5], halfDays: [] });
  });
}

function createCrudMutationTests(): void {
  it("PATCH updates fields; DELETE removes a non-lifecycle row", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await patch({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Renamed",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(readClientResponse(res).name).toBe("Renamed");
    await post(app, "disciplines", {
      id: "d1",
      accountId: "a1",
      name: "Design",
      color: "#5c34d4",
      sortOrder: 0,
      ...meta(),
    });
    expect((await del({ app, entity: "disciplines", id: "d1", accountId: "a1" })).statusCode).toBe(204);
    expect((await readValidatedState(app)).disciplines).toHaveLength(0);
  });

  it("PATCH on a missing id is 404; unknown entity is 404", async () => {
    const { app } = freshApp();
    await scaffold(app);
    expect((await patch({ app, entity: "clients", id: "nope", payload: client("nope", "a1") })).statusCode).toBe(404);
    expect((await post(app, "widgets", { id: "x" })).statusCode).toBe(404);
  });
}

function createCrudResourceMutationTests(): void {
  it("PATCH is a partial merge: omitted fields keep their stored value", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // A real partial patch — only `role`. kind/employmentType/workingDays/etc. must
    // survive (a blind column-wise UPDATE would null the NOT NULL columns → 500/400).
    const res = await patch({ app, entity: "resources", id: "r1", payload: { role: "Lead Designer" } });
    expect(res.statusCode).toBe(200);
    const s = await readValidatedState(app);
    const r = readFirstResource(s.resources);
    expect(r.role).toBe("Lead Designer");
    expect(r.kind).toBe("person");
    expect(r.employmentType).toBe("permanent");
    expect(r.workingHoursPerDay).toBe(8);
    expect(r.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(r.color).toBe("#5c34d4");
  });

  it("PATCH persists and clears a resource favourite", async () => {
    const { app, db } = freshApp();
    await scaffold(app);

    const favouriteResponse = await patchResourceFavourite(app, true);
    const favourite = favouriteResponse.isFavourite;
    expect(favourite).toBe(true);
    expect(getRow(db, "resources", "r1")?.isFavourite).toBe(true);

    const unfavouriteResponse = await patchResourceFavourite(app, false);
    const unfavourite = unfavouriteResponse.isFavourite;
    expect(unfavourite).toBe(false);
    expect(getRow(db, "resources", "r1")?.isFavourite).toBe(false);
  });
}

function createCrudScopingTests(): void {
  it("refuses to re-home an existing row to another account (accountId is immutable)", async () => {
    const { app } = freshApp();
    await scaffold(app); // c1 in a1
    await post(app, "accounts", account("a2"));
    // PATCH and PUT that try to move c1 into a2 are indistinguishable from an absent row.
    expect((await patch({ app, entity: "clients", id: "c1", payload: { accountId: "a2" } })).statusCode).toBe(404);
    expect((await put({ app, entity: "clients", id: "c1", payload: { ...client("c1", "a2") } })).statusCode).toBe(404);
    // …and c1 stays in a1.
    expect(readFirstClient(await readStateClients(app)).accountId).toBe("a1");
  });

  it("scopes a non-lifecycle delete to its owning account", async () => {
    const { app } = freshApp();
    await scaffold(app); // c1 belongs to a1
    await post(app, "accounts", account("a2"));
    await post(app, "disciplines", {
      id: "d1",
      accountId: "a1",
      name: "Design",
      color: "#5c34d4",
      sortOrder: 0,
      ...meta(),
    });
    // Asserting the WRONG account refuses with 404 and leaves the row in place…
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: "/api/disciplines/d1?accountId=a2",
        })
      ).statusCode,
    ).toBe(404);
    expect((await readValidatedState(app)).disciplines).toHaveLength(1);
    // …the correct owner deletes it.
    expect(
      (
        await call(app, {
          method: "DELETE",
          url: "/api/disciplines/d1?accountId=a1",
        })
      ).statusCode,
    ).toBe(204);
    expect((await readValidatedState(app)).disciplines).toHaveLength(0);
  });

  it("refuses a scoped delete that omits accountId (the by-id bypass is closed → 400)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // A scoped delete MUST assert its owner; omitting accountId can't prove ownership, so
    // it is a 400 rather than an unscoped delete-by-id (the old tenant-guard bypass).
    expect((await call(app, { method: "DELETE", url: "/api/clients/c1" })).statusCode).toBe(400);
    expect(await readStateClients(app)).toHaveLength(1); // not deleted
  });
}

function createCrudPersistenceTests(): void {
  it("preserves the immutable createdAt on update (a PUT cannot rewrite it)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const original = readFirstClient(await readStateClients(app)).createdAt;
    await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Renamed",
        createdAt: "2099-01-01T00:00:00.000Z",
      },
    });
    const after = readFirstClient(await readStateClients(app));
    expect(after.name).toBe("Renamed"); // everything else updates
    expect(after.createdAt).toBe(original); // …but createdAt is preserved
  });

  it("reports hasData:true after the user deletes all their data (no demo re-seed)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await call(app, { method: "GET", url: "/api/meta" })).json()).toEqual({ hasData: true });
    await del({ app, entity: "accounts", id: "a1" }); // user empties everything
    expect((await readValidatedState(app)).accounts).toHaveLength(0);
    // Still "initialised" — a reload must NOT mistake an emptied dataset for a fresh one.
    expect((await call(app, { method: "GET", url: "/api/meta" })).json()).toEqual({ hasData: true });
  });

  it("DELETE is idempotent for non-lifecycle tables (missing id still 204 when the owner is asserted)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await del({ app, entity: "phases", id: "ghost", accountId: "a1" })).statusCode).toBe(204);
  });
}

function createCrudUpsertTests(): void {
  it("PUT upserts idempotently: first call creates, second overwrites (no conflict)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const c = client("c1", "a1");
    expect((await put({ app, entity: "clients", id: "c1", payload: c })).statusCode).toBe(200);
    // Replay the SAME create — must not error (the sync adapter relies on this when
    // replaying a batch after a partial failure).
    const replay = await put({ app, entity: "clients", id: "c1", payload: c });
    expect(replay.statusCode).toBe(200);
    // A changed body overwrites.
    expect(
      (
        await put({
          app,
          entity: "clients",
          id: "c1",
          payload: {
            ...c,
            updatedAt: readClientResponse(replay).updatedAt,
            name: "Renamed",
          },
        })
      ).statusCode,
    ).toBe(200);
    const s = await readValidatedState(app);
    expect(s.clients).toHaveLength(1);
    expect(readFirstClientName(s.clients)).toBe("Renamed");
  });

  it("PUT rejects a body id that disagrees with the URL id", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await put({ app, entity: "clients", id: "c1", payload: client("OTHER", "a1") })).statusCode).toBe(400);
  });

  it("PUT runs shared-core validation (rejects a dangling FK)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect(
      (await put({ app, entity: "projects", id: "p1", payload: project("p1", "a1", "no-client") })).statusCode,
    ).toBe(400);
  });
}

describe("CRUD round-trip", () => {
  createCrudCreationTests();
  createCrudMutationTests();
  createCrudResourceMutationTests();
  createCrudScopingTests();
  createCrudPersistenceTests();
  createCrudUpsertTests();
});

describe("generic lifecycle deletion guard", () => {
  it("rejects deleting a client and leaves its full subtree intact", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "allocations", allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t1" }));
    expect((await del({ app, entity: "clients", id: "c1", accountId: "a1" })).statusCode).toBe(400);
    const s = await readValidatedState(app);
    expect(s.clients).toHaveLength(1);
    expect(s.projects).toHaveLength(1);
    expect(s.activities).toHaveLength(1);
    expect(s.allocations).toHaveLength(1);
    expect(s.resources).toHaveLength(1);
  });

  it("deleting a discipline ungroups resources (SET NULL, not delete)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "disciplines", {
      id: "d1",
      accountId: "a1",
      name: "Design",
      sortOrder: 0,
      ...meta(),
    });
    await post(app, "resources", { ...person("r1", "a1"), disciplineId: "d1" });
    await del({ app, entity: "disciplines", id: "d1", accountId: "a1" });
    const s = await readValidatedState(app);
    expect(s.disciplines).toHaveLength(0);
    expect(s.resources).toHaveLength(1);
    expect(readFirstResource(s.resources).disciplineId).toBeUndefined();
  });
});

const seedAttributedActivity = async (resourceKind: "person" | "placeholder" = "person") => {
  const fixture = freshApp();
  await post(fixture.app, "accounts", account("a1"));
  await post(fixture.app, "clients", client("c1", "a1"));
  await post(fixture.app, "projects", project("p1", "a1", "c1"));
  if (resourceKind === "placeholder") {
    await post(fixture.app, "projects", project("p2", "a1", "c1"));
  }
  const resource = resourceKind === "placeholder" ? placeholder("ph", "a1", "p1") : person("r1", "a1");
  await post(fixture.app, "resources", resource);
  await post(fixture.app, "activities", {
    ...activity({ id: "repeatable", accountId: "a1", projectId: "p1" }),
    kind: "repeatable",
    projectId: undefined,
  });
  await post(
    fixture.app,
    "allocations",
    allocation({
      id: "allocation",
      accountId: "a1",
      resourceId: resource.id,
      activityId: "repeatable",
      o: { projectId: "p1" },
    }),
  );
  return fixture;
};

const reconcileAllocationFirst = async (fixture: Awaited<ReturnType<typeof seedAttributedActivity>>) => {
  const before = await readValidatedState(fixture.app);
  const currentActivity = readActivity(before.activities, "repeatable");
  const currentAllocation = readAllocation(before.allocations, "allocation");
  expect(currentActivity.id).toBe("repeatable");
  expect(currentAllocation.id).toBe("allocation");
  const response = await orderedBatch({
    app: fixture.app,
    sessionId: "browser-session-kind-change-0001",
    sequence: 1,
    ops: [
      { method: "PUT", table: "allocations", id: "allocation", row: currentAllocation },
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "project", projectId: "p1" },
      },
    ],
  });
  expect(response.statusCode).toBe(200);
  const state = await readValidatedState(fixture.app);
  const rewrittenAllocation = readAllocation(state.allocations, "allocation");
  expect(rewrittenAllocation).not.toHaveProperty("projectId");
  expect(readBatchReceipt(response).revisions).toContainEqual({
    table: "allocations",
    id: "allocation",
    createdAt: rewrittenAllocation.createdAt,
    updatedAt: rewrittenAllocation.updatedAt,
    rewrite: true,
  });
};

const reconcileExplicitClearedAllocation = async (fixture: Awaited<ReturnType<typeof seedAttributedActivity>>) => {
  const before = await readValidatedState(fixture.app);
  const currentActivity = readActivity(before.activities, "repeatable");
  const currentAllocation = readAllocation(before.allocations, "allocation");
  const clearedAllocation = { ...currentAllocation };
  delete clearedAllocation.projectId;
  const response = await orderedBatch({
    app: fixture.app,
    sessionId: "browser-session-kind-change-0002",
    sequence: 1,
    ops: [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "project", projectId: "p1" },
      },
      { method: "PUT", table: "allocations", id: "allocation", row: clearedAllocation },
    ],
  });
  expect(response.statusCode).toBe(200);
  expect(await readStateAllocation(fixture.app, "allocation")).not.toHaveProperty("projectId");
};

const reconcileImplicitRewrite = async (fixture: Awaited<ReturnType<typeof seedAttributedActivity>>) => {
  const before = await readValidatedState(fixture.app);
  const currentActivity = readActivity(before.activities, "repeatable");
  const response = await orderedBatch({
    app: fixture.app,
    sessionId: "browser-session-kind-change-0003",
    sequence: 1,
    ops: [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "project", projectId: "p1" },
      },
    ],
  });
  expect(response.statusCode).toBe(200);
  const currentAllocation = await readStateAllocation(fixture.app, "allocation");
  expect(currentAllocation).not.toHaveProperty("projectId");
  expect(readBatchReceipt(response).revisions).toContainEqual({
    table: "allocations",
    id: "allocation",
    createdAt: currentAllocation.createdAt,
    updatedAt: currentAllocation.updatedAt,
    rewrite: true,
  });
};

const rejectForbiddenAllocation = async (fixture: Awaited<ReturnType<typeof seedAttributedActivity>>) => {
  const before = await readValidatedState(fixture.app);
  const currentActivity = readActivity(before.activities, "repeatable");
  const currentAllocation = readAllocation(before.allocations, "allocation");
  const response = await orderedBatch({
    app: fixture.app,
    sessionId: "browser-session-kind-change-0004",
    sequence: 1,
    ops: [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "project", projectId: "p1" },
      },
      { method: "PUT", table: "allocations", id: "allocation", row: currentAllocation },
    ],
  });
  expect(response.statusCode).toBe(400);
  expect(response.json()).toMatchObject({ code: "allocation_project_forbidden" });
  expect(readActivity((await readValidatedState(fixture.app)).activities, "repeatable")).toMatchObject({
    kind: "repeatable",
  });
};

function createAttributedAllocationReconciliationTest() {
  it("reconciles attributed allocations after repeatable activity kind changes", async () => {
    const allocationFirst = await seedAttributedActivity();
    await reconcileAllocationFirst(allocationFirst);

    const explicit = await seedAttributedActivity();
    await reconcileExplicitClearedAllocation(explicit);

    const implicit = await seedAttributedActivity();
    await reconcileImplicitRewrite(implicit);

    const forbidden = await seedAttributedActivity();
    await rejectForbiddenAllocation(forbidden);
  });
}

function createAtFlipTimeClearingTest() {
  it("keeps at-flip-time clearing after an activity flips back before a dependent write", async () => {
    const fixture = await seedAttributedActivity("placeholder");
    const before = await readValidatedState(fixture.app);
    const currentActivity = readActivity(before.activities, "repeatable");

    const response = await batch(fixture.app, [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "internal", projectId: undefined },
      },
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...currentActivity, kind: "repeatable", projectId: undefined },
      },
      {
        method: "PUT",
        table: "resources",
        id: "ph",
        row: { ...readResource(before.resources, "ph"), projectId: "p2" },
      },
    ]);

    expect(response.statusCode, response.body).toBe(200);
    const rewritten = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(rewritten).not.toHaveProperty("projectId");
    expect(readBatchReceipt(response).revisions).toContainEqual({
      table: "allocations",
      id: rewritten.id,
      createdAt: rewritten.createdAt,
      updatedAt: rewritten.updatedAt,
      rewrite: true,
    });
  });
}

function createCorruptAttributionValidationTest() {
  it("validates an activity edit against corrupt attribution before clearing it", async () => {
    const fixture = await seedAttributedActivity("placeholder");
    fixture.db.prepare("UPDATE resources SET projectId = 'p2' WHERE id = 'ph'").run();
    const before = await readValidatedState(fixture.app);

    const response = await batch(fixture.app, [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...readActivity(before.activities, "repeatable"), kind: "project", projectId: "p1" },
      },
    ]);

    expect(response.statusCode).toBe(200);
    expect(await readStateAllocation(fixture.app, "allocation")).not.toHaveProperty("projectId");
  });
}

function createDirectActivityPutClearingTest() {
  it("keeps direct activity PUT attribution clearing behavior", async () => {
    const fixture = await seedAttributedActivity();
    const before = await readValidatedState(fixture.app);
    const allocationBefore = readAllocation(before.allocations, "allocation");

    const response = await put({
      app: fixture.app,
      entity: "activities",
      id: "repeatable",
      payload: {
        ...readActivity(before.activities, "repeatable"),
        kind: "internal",
        projectId: undefined,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(readActivityWriteResponse(response)).toMatchObject({ id: "repeatable", kind: "internal" });
    expect(readActivityWriteResponse(response)).not.toHaveProperty("table");
    const allocationAfter = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(allocationAfter).not.toHaveProperty("projectId");
    expect(Date.parse(allocationAfter.updatedAt)).toBeGreaterThan(Date.parse(allocationBefore.updatedAt));
    expect(readActivityWriteResponse(response).rewrittenAllocations).toEqual([
      { id: allocationAfter.id, createdAt: allocationAfter.createdAt, updatedAt: allocationAfter.updatedAt },
    ]);
  });
}

function createDirectActivityPatchClearingTest() {
  it("keeps direct activity PATCH attribution clearing behavior", async () => {
    const fixture = await seedAttributedActivity();
    const allocationBefore = await readStateAllocation(fixture.app, "allocation");

    const response = await patch({
      app: fixture.app,
      entity: "activities",
      id: "repeatable",
      payload: {
        kind: "internal",
        projectId: undefined,
      },
    });

    expect(response.statusCode).toBe(200);
    const allocationAfter = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(allocationAfter).not.toHaveProperty("projectId");
    expect(Date.parse(allocationAfter.updatedAt)).toBeGreaterThan(Date.parse(allocationBefore.updatedAt));
    expect(readActivityWriteResponse(response).rewrittenAllocations).toEqual([
      { id: allocationAfter.id, createdAt: allocationAfter.createdAt, updatedAt: allocationAfter.updatedAt },
    ]);
  });
}

function createLegacyAttributionRepairTest() {
  it("repairs legacy attribution when a batch re-PUTs an already ineligible activity", async () => {
    const fixture = freshApp();
    await post(fixture.app, "accounts", account("a1"));
    await post(fixture.app, "clients", client("c1", "a1"));
    await post(fixture.app, "projects", project("p1", "a1", "c1"));
    await post(fixture.app, "resources", person("r1", "a1"));
    await post(fixture.app, "activities", {
      ...activity({ id: "internal", accountId: "a1", projectId: "p1" }),
      kind: "internal",
      projectId: undefined,
    });
    await post(fixture.app, "activities", {
      ...activity({ id: "repeatable", accountId: "a1", projectId: "p1" }),
      kind: "repeatable",
      projectId: undefined,
    });
    await post(
      fixture.app,
      "allocations",
      allocation({
        id: "allocation",
        accountId: "a1",
        resourceId: "r1",
        activityId: "repeatable",
        o: { projectId: "p1" },
      }),
    );
    fixture.db.prepare("UPDATE allocations SET activityId = 'internal' WHERE id = 'allocation'").run();
    const current = readActivity((await readValidatedState(fixture.app)).activities, "internal");

    const response = await batch(fixture.app, [{ method: "PUT", table: "activities", id: "internal", row: current }]);

    expect(response.statusCode).toBe(200);
    const repaired = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(repaired).not.toHaveProperty("projectId");
    expect(readBatchReceipt(response).revisions).toContainEqual({
      table: "allocations",
      id: repaired.id,
      createdAt: repaired.createdAt,
      updatedAt: repaired.updatedAt,
      rewrite: true,
    });
  });
}

function createCoalescedKindFlipValidationTest() {
  it("keeps projection validation consistent for a coalesced activity kind flip and placeholder rebind", async () => {
    const fixture = freshApp();
    await post(fixture.app, "accounts", account("a1"));
    await post(fixture.app, "clients", client("c1", "a1"));
    await post(fixture.app, "projects", project("p1", "a1", "c1"));
    await post(fixture.app, "projects", project("p2", "a1", "c1"));
    await post(fixture.app, "resources", placeholder("ph", "a1", "p1"));
    await post(fixture.app, "activities", {
      ...activity({ id: "repeatable", accountId: "a1", projectId: "p1" }),
      kind: "repeatable",
      projectId: undefined,
    });
    await post(
      fixture.app,
      "allocations",
      allocation({
        id: "allocation",
        accountId: "a1",
        resourceId: "ph",
        activityId: "repeatable",
        o: { projectId: "p1" },
      }),
    );
    const before = await readValidatedState(fixture.app);

    const response = await batch(fixture.app, [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...readActivity(before.activities, "repeatable"), kind: "internal", projectId: undefined },
      },
      {
        method: "PUT",
        table: "resources",
        id: "ph",
        row: { ...readResource(before.resources, "ph"), projectId: "p2" },
      },
    ]);

    expect(response.statusCode).toBe(200);
    expect(await readStateAllocation(fixture.app, "allocation")).not.toHaveProperty("projectId");
  });
}

function createClearingBeforeArchiveTest() {
  it("clears and echoes allocation attribution before a later lifecycle archive in the same batch", async () => {
    const fixture = freshApp();
    await post(fixture.app, "accounts", account("a1"));
    await post(fixture.app, "clients", client("c1", "a1"));
    await post(fixture.app, "projects", project("p1", "a1", "c1"));
    await post(fixture.app, "resources", person("r1", "a1"));
    await post(fixture.app, "activities", {
      ...activity({ id: "repeatable", accountId: "a1", projectId: "p1" }),
      kind: "repeatable",
      projectId: undefined,
    });
    await post(
      fixture.app,
      "allocations",
      allocation({
        id: "allocation",
        accountId: "a1",
        resourceId: "r1",
        activityId: "repeatable",
        o: { projectId: "p1" },
      }),
    );
    const before = await readValidatedState(fixture.app);

    const response = await batch(fixture.app, [
      {
        method: "PUT",
        table: "activities",
        id: "repeatable",
        row: { ...readActivity(before.activities, "repeatable"), kind: "internal", projectId: undefined },
      },
      { method: "ARCHIVE", table: "projects", id: "p1", accountId: "a1" },
    ]);

    expect(response.statusCode).toBe(200);
    const rewritten = readAllocation((await readValidatedState(fixture.app)).allocations, "allocation");
    expect(rewritten).not.toHaveProperty("projectId");
    expect(readBatchReceipt(response).revisions).toContainEqual({
      table: "allocations",
      id: rewritten.id,
      createdAt: rewritten.createdAt,
      updatedAt: rewritten.updatedAt,
      rewrite: true,
    });
  });
}

function createClosureWriteTest() {
  it("writes closures directly and in a batch, and rejects resource references", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));

    expect((await post(app, "closures", closure("direct-closure", "a1"))).statusCode).toBe(201);
    expect(
      (
        await batch(app, [
          {
            method: "PUT",
            table: "closures",
            id: "batch-closure",
            row: closure("batch-closure", "a1", "New Year shutdown"),
          },
        ])
      ).statusCode,
    ).toBe(200);

    expect((await readValidatedState(app)).closures).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "direct-closure", name: "Christmas shutdown" }),
        expect.objectContaining({ id: "batch-closure", name: "New Year shutdown" }),
      ]),
    );
    expect((await post(app, "closures", { ...closure("invalid-closure", "a1"), resourceId: "r1" })).statusCode).toBe(
      400,
    );
  });
}

function createMissingTimeOffResourceTest() {
  it("rejects an omitted time-off resourceId through direct and batch writes", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const missing = timeOff({ id: "missing-resource", accountId: "a1", resourceId: "r1" }) as Record<string, unknown>;
    delete missing.resourceId;

    expect((await post(app, "timeOff", missing)).statusCode).toBe(400);
    expect(
      (await batch(app, [{ method: "PUT", table: "timeOff", id: "missing-resource", row: missing }])).statusCode,
    ).toBe(400);
    expect((await readValidatedState(app)).timeOff).toEqual([]);
  });
}

function createRepeatedTimeOffRollbackTest() {
  it("rolls back a valid time-off row when a later repeated row is invalid", async () => {
    const { app } = freshApp();
    await scaffold(app);

    const response = await batch(app, [
      {
        method: "PUT",
        table: "timeOff",
        id: "repeat-good",
        row: timeOff({ id: "repeat-good", accountId: "a1", resourceId: "r1" }),
      },
      {
        method: "PUT",
        table: "timeOff",
        id: "repeat-bad",
        row: timeOff({ id: "repeat-bad", accountId: "a1", resourceId: "missing" }),
      },
    ]);

    expect(response.statusCode).toBe(400);
    expect((await readValidatedState(app)).timeOff).toHaveLength(0);
  });
}

function createLifecycleDeletePreScanTest() {
  it("rejects a lifecycle DELETE before executing any batch operation", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "clients", client("c1", "a1"));
    await post(app, "clients", client("c2", "a1"));
    await post(app, "projects", project("p1", "a1", "c1")); // p1 under c1
    await post(app, "activities", activity({ id: "t1", accountId: "a1", projectId: "p1" }));
    // The forbidden lifecycle DELETE rejects the whole request before the preceding reparent runs.
    const res = await batch(app, [
      {
        method: "PUT",
        table: "projects",
        id: "p1",
        row: {
          ...project("p1", "a1", "c2"),
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
      { method: "DELETE", table: "clients", id: "c1", accountId: "a1" },
    ]);
    expect(res.statusCode).toBe(400);
    const s = await readValidatedState(app);
    expect(readClientIds(s.clients)).toEqual(["c1", "c2"]);
    expect(s.projects).toHaveLength(1);
    expect(readFirstProject(s.projects).clientId).toBe("c1");
    expect(s.activities).toHaveLength(1);
  });
}

function createAtomicRollbackTest() {
  it("rolls the WHOLE batch back if any op fails (atomic)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    // First op valid (new client c3); second references a missing client → validation 400.
    const res = await batch(app, [
      { method: "PUT", table: "clients", id: "c3", row: client("c3", "a1") },
      {
        method: "PUT",
        table: "projects",
        id: "bad",
        row: project("bad", "a1", "ghost-client"),
      },
    ]);
    expect(res.statusCode).toBe(400);
    const s = await readValidatedState(app);
    expect(s.clients).toHaveLength(0); // c3 rolled back with the bad op — nothing persisted
    expect(s.projects).toHaveLength(0);
  });
}

function createRepeatedAllocationRollbackTest() {
  it("rolls back valid repeated allocations when one generated sibling is invalid", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await batch(app, [
      {
        method: "PUT",
        table: "allocations",
        id: "repeat-good",
        row: allocation({ id: "repeat-good", accountId: "a1", resourceId: "r1", activityId: "t1" }),
      },
      {
        method: "PUT",
        table: "allocations",
        id: "repeat-bad",
        row: allocation({ id: "repeat-bad", accountId: "a1", resourceId: "missing", activityId: "t1" }),
      },
    ]);
    expect(res.statusCode).toBe(400);
    expect((await readValidatedState(app)).allocations).toHaveLength(0);
  });
}

function createPlaceholderRebindRollbackTest() {
  it("rolls back earlier operations when a placeholder rebind would invalidate existing work", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "projects", project("p2", "a1", "c1"));
    await post(app, "resources", placeholder("ph", "a1", "p1"));
    await post(app, "allocations", allocation({ id: "al", accountId: "a1", resourceId: "ph", activityId: "t1" }));

    const res = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: { ...client("c1", "a1"), name: "Must roll back" },
      },
      {
        method: "PUT",
        table: "resources",
        id: "ph",
        row: placeholder("ph", "a1", "p2"),
      },
    ]);

    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/placeholder’s work/i);
    const snapshot = await readValidatedState(app);
    expect(readFirstClientName(snapshot.clients)).toBe("Acme");
    expect(readProjectId(snapshot.resources, "ph")).toBe("p1");
  });
}

function createCrossAccountDeleteRollbackTest() {
  it("refuses a cross-account delete inside a batch and rolls back", async () => {
    const { app } = freshApp();
    await scaffold(app); // c1 in a1
    await post(app, "accounts", account("a2"));
    const res = await batch(app, [{ method: "DELETE", table: "clients", id: "c1", accountId: "a2" }]);
    expect(res.statusCode).toBe(400);
    expect((await readValidatedState(app)).clients).toHaveLength(1); // c1 untouched
  });
}

function createMissingDeleteAccountTest() {
  it("rejects a scoped delete op that omits accountId", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await batch(app, [{ method: "DELETE", table: "clients", id: "c1" }]);
    expect(res.statusCode).toBe(400);
    expect((await readValidatedState(app)).clients).toHaveLength(1);
  });
}

function createInvalidBatchOperationTest() {
  it("rejects an unknown table / bad op shape", async () => {
    const { app } = freshApp();
    expect((await batch(app, [{ method: "PUT", table: "widgets", id: "x", row: { id: "x" } }])).statusCode).toBe(400);
    expect((await batch(app, [{ method: "PUT", table: "clients", id: "c1", row: { id: "OTHER" } }])).statusCode).toBe(
      400,
    );
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/batch",
          payload: body({ nope: true }),
        })
      ).statusCode,
    ).toBe(400);
  });
}

function createNullBatchOperationTest() {
  it("rejects a null operation as a validation error instead of throwing a 500", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/batch",
      payload: body({ ops: [null] }),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/object/i);
  });
}

describe("batch sync (/api/batch — transactional, ordered)", () => {
  createAttributedAllocationReconciliationTest();
  createAtFlipTimeClearingTest();
  createCorruptAttributionValidationTest();
  createDirectActivityPutClearingTest();
  createDirectActivityPatchClearingTest();
  createLegacyAttributionRepairTest();
  createCoalescedKindFlipValidationTest();
  createClearingBeforeArchiveTest();
  createClosureWriteTest();
  createMissingTimeOffResourceTest();
  createRepeatedTimeOffRollbackTest();
  createLifecycleDeletePreScanTest();
  createAtomicRollbackTest();
  createRepeatedAllocationRollbackTest();
  createPlaceholderRebindRollbackTest();
  createCrossAccountDeleteRollbackTest();
  createMissingDeleteAccountTest();
  createInvalidBatchOperationTest();
  createNullBatchOperationTest();
});

describe("batch pre-scan validation", () => {
  it.each([
    [{ "x-capacitylens-sync-session": "short", "x-capacitylens-sync-sequence": "1" }],
    [{ "x-capacitylens-sync-session": "browser-session-valid-0001", "x-capacitylens-sync-sequence": "0" }],
    [{ "x-capacitylens-sync-session": "browser-session-valid-0001" }],
  ])("rejects malformed browser ordering headers %#", async (headers) => {
    const { app } = freshApp();
    const response = await call(app, {
      method: "POST",
      url: "/api/batch",
      headers,
      payload: body({ ops: [] }),
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid browser sync ordering headers." });
  });

  it.each([
    ["PUT", { method: "PUT", table: "clients", id: "c1", row: { ...client("c1", "a1"), updatedAt: 1 } }],
    ["DELETE", { method: "DELETE", table: "disciplines", id: "d1", accountId: "a1", updatedAt: null }],
    ["ARCHIVE", { method: "ARCHIVE", table: "clients", id: "c1", accountId: "a1", updatedAt: false }],
  ])("requires a string updatedAt for ordered %s operations", async (verb, op) => {
    const { app } = freshApp();
    const response = await orderedBatch({ app, sessionId: "browser-session-valid-0002", sequence: 1, ops: [op] });
    expect(response.statusCode).toBe(400);
    expect(readErrorResponse(response).error).toContain(`ordered ${verb} op needs a string updatedAt`);
  });

  it.each([
    ["unknown method", { method: "PATCH", table: "clients", id: "c1" }, /Unknown op method/],
    ["DELETE account", { method: "DELETE", table: "disciplines", id: "d1", accountId: 1 }, /string accountId/],
    [
      "ARCHIVE non-lifecycle",
      { method: "ARCHIVE", table: "disciplines", id: "d1", accountId: "a1" },
      /only for lifecycle/,
    ],
    ["ARCHIVE account", { method: "ARCHIVE", table: "clients", id: "c1" }, /string accountId/],
  ])("rejects an invalid $name during pre-scan", async (_name, op, message) => {
    const { app } = freshApp();
    const response = await batch(app, [op]);
    expect(response.statusCode).toBe(400);
    expect(readErrorResponse(response).error).toMatch(message);
  });
});

function createRequiredWriteValidationTests(): void {
  it("rejects a null time-off resource", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));

    const response = await post(app, "timeOff", {
      ...timeOff({ id: "invalid-time-off", accountId: "a1", resourceId: "r1" }),
      resourceId: null,
    });

    expect(response.statusCode).toBe(400);
    expect((await readValidatedState(app)).timeOff).toEqual([]);
  });

  it("rejects direct writes that omit values only the import path may repair", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await post(app, "resources", {
      id: "r1",
      accountId: "a1",
      name: "Ada",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/missing required field.*kind/i);
    expect((await readValidatedState(app)).resources).toEqual([]);
  });
}

function createParentWriteValidationTests(): void {
  it("rejects missing required project and phase parents at the shared boundary", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "clients", client("c1", "a1"));

    const missingClient = await post(app, "projects", {
      id: "p1",
      accountId: "a1",
      name: "Project",
      color: "#5c34d4",
      ...meta(),
    });
    expect(missingClient.statusCode).toBe(400);
    expect(readErrorResponse(missingClient).error).toBe("Project must reference a client in this company.");
    expect(readErrorResponse(missingClient).code).toBe("reference_wrong_account");

    await post(app, "projects", project("p2", "a1", "c1"));
    const missingClientOnReplace = await put({
      app,
      entity: "projects",
      id: "p2",
      payload: {
        id: "p2",
        accountId: "a1",
        name: "Replacement",
        color: "#5c34d4",
        ...meta(),
      },
    });
    expect(missingClientOnReplace.statusCode).toBe(400);
    expect(readErrorResponse(missingClientOnReplace).error).toBe("Project must reference a client in this company.");
    expect((await patch({ app, entity: "projects", id: "p2", payload: { name: "Partial rename" } })).statusCode).toBe(
      200,
    );

    const missingProject = await post(app, "phases", {
      id: "ph1",
      accountId: "a1",
      name: "Phase",
      ...meta(),
    });
    expect(missingProject.statusCode).toBe(400);
    expect(readErrorResponse(missingProject).error).toBe("Phase must reference a project in this company.");
  });

  it("rejects a project referencing a client outside the account", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await post(app, "projects", project("p1", "a1", "no-such-client"));
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/client/i);
  });
}

function createAllocationRangeOrderValidationTest(): void {
  it("rejects a reversed allocation date range", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await post(
      app,
      "allocations",
      allocation({
        id: "bad",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: {
          startDate: "2026-02-10",
          endDate: "2026-02-01",
        },
      }),
    );
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/end date/i);
  });
}

function createSchedulingSpanValidationTest(): void {
  it("accepts the maximum scheduling span and rejects longer allocation and time-off writes", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const startDate = "2026-01-01";
    const atLimit = addDaysISO(startDate, MAX_SPAN_DAYS - 1);
    const overLimit = addDaysISO(startDate, MAX_SPAN_DAYS);

    expect(
      (
        await post(
          app,
          "allocations",
          allocation({
            id: "at-limit",
            accountId: "a1",
            resourceId: "r1",
            activityId: "t1",
            o: {
              startDate,
              endDate: atLimit,
            },
          }),
        )
      ).statusCode,
    ).toBe(201);

    const allocationResponse = await post(
      app,
      "allocations",
      allocation({
        id: "over-limit",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: {
          startDate,
          endDate: overLimit,
        },
      }),
    );
    expect(allocationResponse.statusCode).toBe(400);
    expect(readErrorResponse(allocationResponse).error).toBe("Date span cannot exceed 36,500 calendar days.");

    const timeOffResponse = await post(app, "timeOff", {
      id: "to-over-limit",
      accountId: "a1",
      resourceId: "r1",
      startDate,
      endDate: overLimit,
      type: "holiday",
      ...meta(),
    });
    expect(timeOffResponse.statusCode).toBe(400);
    expect(readErrorResponse(timeOffResponse).error).toBe("Date span cannot exceed 36,500 calendar days.");
  });
}

function createPlaceholderWriteValidationTests(): void {
  it("rejects a placeholder assigned outside its bound project", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "projects", project("p2", "a1", "c1"));
    await post(app, "activities", activity({ id: "t2", accountId: "a1", projectId: "p2" }));
    await post(app, "resources", placeholder("ph", "a1", "p1")); // bound to p1
    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "ph", activityId: "t2" }),
    ); // t2 is in p2
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/placeholder/i);
  });

  it("rejects parent edits that would invalidate an existing placeholder allocation", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "projects", project("p2", "a1", "c1"));
    await post(app, "resources", placeholder("ph", "a1", "p1"));
    await post(app, "allocations", allocation({ id: "al", accountId: "a1", resourceId: "ph", activityId: "t1" }));

    const rebind = await patch({ app, entity: "resources", id: "ph", payload: { projectId: "p2" } });
    expect(rebind.statusCode).toBe(400);
    expect(readErrorResponse(rebind).error).toMatch(/placeholder’s work/i);

    const reproject = await patch({ app, entity: "activities", id: "t1", payload: { projectId: "p2" } });
    expect(reproject.statusCode).toBe(400);
    expect(readErrorResponse(reproject).error).toMatch(/placeholder work/i);

    const snapshot = await readValidatedState(app);
    expect(readProjectId(snapshot.resources, "ph")).toBe("p1");
    expect(readProjectId(snapshot.activities, "t1")).toBe("p1");
  });
}

function createAllocationReferenceValidationTests(): void {
  it("rejects an allocation referencing a missing resource/activity", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "ghost", activityId: "t1" }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("fails closed when a corrupt project-bound activity points at another account's project", async () => {
    const { app, db } = freshApp(true, { multiAccount: true });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));
    await post(app, "clients", client("c2", "a2"));
    await post(app, "projects", project("p2", "a2", "c2"));
    await post(app, "resources", person("r1", "a1"));

    // The ordinary activity route and current database trigger reject this mismatch. Remove that
    // one insert trigger to model post-start operator tampering and prove the allocation write
    // boundary independently re-checks the project tenant.
    db.exec("DROP TRIGGER capacitylens_tenant_activities_projectId_insert");
    insertRow(db, "activities", activity({ id: "cross-project", accountId: "a1", projectId: "p2" }));

    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "r1", activityId: "cross-project" }),
    );
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toBe(CROSS_ACCOUNT_ACTIVITY_ERROR);
  });
}

function createExternalResourceWriteValidationTests(): void {
  it("rejects a non-zero allocation load on an external / 3rd-party resource (no capacity)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "resources", { ...person("ext", "a1"), kind: "external" });
    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "ext", activityId: "t1", o: { hoursPerDay: 8 } }),
    );
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/external/i);
  });

  it("accepts a zero-load allocation on an external resource (the form forces 0)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "resources", { ...person("ext", "a1"), kind: "external" });
    const res = await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "ext", activityId: "t1", o: { hoursPerDay: 0 } }),
    );
    expect(res.statusCode).toBe(201);
  });

  it("rejects time off on an external / 3rd-party resource (no capacity)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "resources", { ...person("ext", "a1"), kind: "external" });
    const res = await post(app, "timeOff", {
      id: "to1",
      accountId: "a1",
      resourceId: "ext",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      type: "holiday",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/external/i);
  });
}

function createExternalResourceConversionRejectionTests(): void {
  // Flipping a resource to external while it still owns loaded work / time-off would orphan those
  // dependents (the scheduler hides external capacity + time-off). The server rejects the flip on
  // BOTH the full-row PUT and the partial PATCH merge — same shared assert as the store.
  it("rejects PATCH setting kind:external on a resource that has a loaded allocation", async () => {
    const { app } = freshApp();
    await scaffold(app); // r1 is a person
    await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "r1", activityId: "t1", o: { hoursPerDay: 8 } }),
    );
    const res = await patch({ app, entity: "resources", id: "r1", payload: { kind: "external" } });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/work and time off/i);
  });

  it("rejects PUT setting kind:external on a resource that has time off", async () => {
    const { app } = freshApp();
    await scaffold(app);
    await post(app, "timeOff", {
      id: "to1",
      accountId: "a1",
      resourceId: "r1",
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      type: "holiday",
      ...meta(),
    });
    const res = await put({
      app,
      entity: "resources",
      id: "r1",
      payload: {
        ...person("r1", "a1"),
        kind: "external",
      },
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/work and time off/i);
  });
}

function createExternalResourceConversionAcceptanceTests(): void {
  it("accepts flipping a resource to external when it has NO disallowed dependents (zero-load allocation is fine)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // A zero-load allocation is already valid for an external, so it must NOT block the flip.
    await post(
      app,
      "allocations",
      allocation({ id: "al", accountId: "a1", resourceId: "r1", activityId: "t1", o: { hoursPerDay: 0 } }),
    );
    expect((await patch({ app, entity: "resources", id: "r1", payload: { kind: "external" } })).statusCode).toBe(200);
    expect(readResource((await readValidatedState(app)).resources, "r1").kind).toBe("external");
  });

  it("accepts creating an external resource with no dependents, and editing its name", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect(
      (
        await post(app, "resources", {
          ...person("ext", "a1"),
          kind: "external",
        })
      ).statusCode,
    ).toBe(201);
    expect((await patch({ app, entity: "resources", id: "ext", payload: { role: "Overflow" } })).statusCode).toBe(200);
  });
}

describe("validation (shared domain-core) rejects bad writes with 400", () => {
  createRequiredWriteValidationTests();
  createParentWriteValidationTests();
  createAllocationRangeOrderValidationTest();
  createSchedulingSpanValidationTest();
  createPlaceholderWriteValidationTests();
  createAllocationReferenceValidationTests();
  createExternalResourceWriteValidationTests();
  createExternalResourceConversionRejectionTests();
  createExternalResourceConversionAcceptanceTests();
});

function createInternalClientCreationRejectionTests(): void {
  it("rejects replacing the generated Internal client id", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await post(app, "projects", project("p-internal", "a1", "internal:a1"));
    await post(app, "activities", activity({ id: "t-internal", accountId: "a1", projectId: "p-internal" }));
    await post(app, "resources", person("r1", "a1"));
    await post(
      app,
      "allocations",
      allocation({ id: "al1", accountId: "a1", resourceId: "r1", activityId: "t-internal" }),
    );

    const replacement = await post(app, "clients", {
      ...client("legacy-internal", "a1"),
      builtin: true,
    });
    expect(replacement.statusCode).toBe(400);
    const snapshot = readStateResponse(await call(app, { method: "GET", url: "/api/state?accountId=a1" }));
    expect(snapshot.projects.find((projectRow) => projectRow.id === "p-internal")?.clientId).toBe("internal:a1");
    expect(snapshot.activities.some((activityRow) => activityRow.id === "t-internal")).toBe(true);
    expect(snapshot.allocations.some((allocationRow) => allocationRow.id === "al1")).toBe(true);
  });

  it("rejects every generic attempt to create a builtin client", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    expect((await post(app, "clients", { ...client("c-int", "a1"), builtin: true })).statusCode).toBe(400);
    const dup = await post(app, "clients", {
      ...client("c-int2", "a1"),
      builtin: true,
    });
    expect(dup.statusCode).toBe(400);
    expect(readErrorResponse(dup).error).toMatch(/built-in|Internal/i);
  });
}

function createInternalClientMutationRejectionTests(): void {
  it("rejects generic updates to the generated builtin client", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await put({
      app,
      entity: "clients",
      id: "internal:a1",
      payload: {
        ...client("internal:a1", "a1"),
        name: "Renamed",
        builtin: true,
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a counterfeit same-batch duplicate of a freshly generated Internal client", async () => {
    const { app } = freshApp();
    const res = await batch(app, [
      { method: "PUT", table: "accounts", id: "a1", row: account("a1") },
      {
        method: "PUT",
        table: "clients",
        id: "internal:a1",
        row: {
          ...client("internal:a1", "a1"),
          name: "Counterfeit built-in",
          color: "#ffffff",
          builtin: false,
        },
      },
    ]);

    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/generated|built-in|Internal/i);
    expect((await readValidatedState(app)).accounts).toEqual([]);
    expect((await readValidatedState(app)).clients).toEqual([]);
  });
}

function createInternalClientSingletonAcceptanceTests(): void {
  it("accepts the canonical same-batch duplicate of a freshly generated Internal client", async () => {
    const auditEntries: AuditEntry[] = [];
    const { app } = freshApp(true, {
      audit: {
        append: (entry) => {
          auditEntries.push(entry);
          return true;
        },
        degraded: false,
      },
    });
    const res = await batch(app, [
      { method: "PUT", table: "accounts", id: "a1", row: account("a1") },
      {
        method: "PUT",
        table: "clients",
        id: "internal:a1",
        row: buildInternalClient("a1", TS),
      },
    ]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, applied: 2, changed: 1 });
    expect(
      auditEntries.filter((entry) => "entity" in entry).map(({ entity, action, id }) => ({ entity, action, id })),
    ).toEqual([{ entity: "accounts", action: "create", id: "a1" }]);
    const storedClients = readAllStateClients(await call(app, { method: "GET", url: "/api/state" }));
    expect(storedClients).toMatchObject([
      {
        id: "internal:a1",
        accountId: "a1",
        name: "Internal",
        builtin: true,
      },
    ]);
  });

  it("creates one protected builtin in each account", async () => {
    // multiAccount: true — this test deliberately creates a SECOND company on one instance, which
    // the default single-company cap would otherwise 403 (see app.singleCompanyCap.test.ts for the
    // cap's own coverage); this test is about per-account builtin scoping, not the cap.
    const { app } = freshApp(true, { multiAccount: true });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));
    expect(
      (
        await post(app, "clients", {
          ...client("c-int-1", "a1"),
          builtin: true,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await post(app, "clients", {
          ...client("c-int-2", "a2"),
          builtin: true,
        })
      ).statusCode,
    ).toBe(400);
    const clients = readAllStateClients(await call(app, { method: "GET", url: "/api/state" }));
    expect(clients.filter((clientRow) => clientRow.builtin)).toHaveLength(2);
  });
}

describe("built-in Internal client is a per-account singleton on direct writes", () => {
  createInternalClientCreationRejectionTests();
  createInternalClientMutationRejectionTests();
  createInternalClientSingletonAcceptanceTests();
});

async function testBoundedImportSaturation(): Promise<void> {
  const { app } = freshApp(true, {
    importWorker: async () => {
      throw new WorkQueueFullError("Import preparation is temporarily at capacity. Retry shortly.");
    },
  });
  await post(app, "accounts", account("a1"));

  const response = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: exportFile("source") },
  });

  expect(response.statusCode).toBe(503);
  expect(response.headers["retry-after"]).toBe("1");
  expect(response.json()).toEqual({
    error: "Import preparation is temporarily at capacity. Retry shortly.",
    code: "IMPORT_BUSY",
    retryable: true,
  });
}

function exportFile(accountId: string) {
  return {
    schemaVersion: 3,
    data: {
      accounts: [],
      clients: [client("src-c", accountId)],
      disciplines: [],
      projects: [project("src-p", accountId, "src-c")],
      phases: [],
      resources: [person("src-r", accountId)],
      activities: [activity({ id: "src-t", accountId, projectId: "src-p" })],
      allocations: [
        allocation({ id: "src-al", accountId, resourceId: "src-r", activityId: "src-t" }),
        allocation({ id: "bad", accountId, resourceId: "src-r", activityId: "no-activity" }), // dropped: dangling activity
      ],
      timeOff: [],
    },
  };
}

async function testImportTimeOffAndClosures(): Promise<void> {
  const { app } = freshApp(true, { multiAccount: true });
  await post(app, "accounts", account("a1"));
  await post(app, "accounts", account("a2"));
  const missingResource = timeOff({
    id: "missing-resource",
    accountId: "source",
    resourceId: "source-person",
  }) as Record<string, unknown>;
  delete missingResource.resourceId;
  const file = {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    data: {
      ...emptyAppData(),
      resources: [person("source-person", "source")],
      timeOff: [timeOff({ id: "personal", accountId: "source", resourceId: "source-person" }), missingResource],
      closures: [closure("company", "source")],
    },
  };

  const firstImport = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: file },
  });
  expect(firstImport.statusCode).toBe(200);
  expect(firstImport.json()).toMatchObject({ imported: 3, skipped: 1 });

  const exported = await call(app, {
    method: "GET",
    url: "/api/state?accountId=a1&includeInactive=1",
  });
  const { state: exportedState, value: exportedValue } = readSuccessfulStateResponse(exported);
  expect(exportedState.timeOff).toHaveLength(1);
  expect(exportedState.closures).toEqual([
    expect.objectContaining({ name: "Christmas shutdown", startDate: "2026-12-24", endDate: "2026-12-27" }),
  ]);

  const secondImport = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a2", data: { schemaVersion: EXPORT_SCHEMA_VERSION, data: exportedValue } },
  });
  expect(secondImport.statusCode).toBe(200);
  expect(secondImport.json()).toMatchObject({ imported: 3, skipped: 0 });

  const roundTripped = await call(app, { method: "GET", url: "/api/state?accountId=a2" });
  const roundTrippedTimeOff = readOnlyTimeOff(readStateResponse(roundTripped).timeOff);
  expect(typeof roundTrippedTimeOff.resourceId).toBe("string");
  expect(roundTrippedTimeOff.type).toBe("holiday");
  expect(readStateResponse(roundTripped).closures).toEqual([expect.objectContaining({ name: "Christmas shutdown" })]);
}

async function testImportWithFreshIds(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: exportFile("whatever") },
  });
  expect(res.statusCode).toBe(200);
  const out = readImportSummary(res);
  expect(out.imported).toBe(5); // client, project, resource, activity, 1 valid allocation
  expect(out.skipped).toBe(1); // the dangling allocation
  const s = await readValidatedState(app);
  const proj = readFirstProject(s.projects);
  expect(proj.id).not.toBe("src-p");
  expect(proj.accountId).toBe("a1");
  expect(readFirstProjectId(s.activities)).toBe(proj.id); // FK rewired to the new project id
  expect(s.allocations).toHaveLength(1);
}

async function testStaleImportConflict(): Promise<void> {
  const workerStarted = deferred();
  const releaseWorker = deferred();
  const auditedActions: string[] = [];
  const appendAudit = vi.fn((record: AuditEntry) => {
    auditedActions.push(record.action);
    return true;
  });
  const { app } = freshApp(true, {
    audit: { append: appendAudit, degraded: false },
    importWorker: async (request) => {
      workerStarted.resolve();
      await releaseWorker.promise;
      return runImportWorker(request);
    },
  });
  await post(app, "accounts", account("a1"));
  auditedActions.length = 0;

  const importing = call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: exportFile("source") },
  });
  await workerStarted.promise;

  const concurrentWrite = await post(app, "resources", person("concurrent", "a1"));
  expect(concurrentWrite.statusCode).toBe(201);
  releaseWorker.resolve();

  const response = await importing;
  expect(response.statusCode).toBe(409);
  expect(response.json()).toEqual({
    error: "The company data changed while the import was being prepared. Retry the import from the latest data.",
    code: "IMPORT_SNAPSHOT_STALE",
  });
  const current = await readValidatedState(app);
  expect(current.resources).toContainEqual(expect.objectContaining({ id: "concurrent", accountId: "a1" }));
  expect(current.clients).not.toContainEqual(expect.objectContaining({ name: "Acme", builtin: false }));
  expect(auditedActions).not.toContain("import");
}

async function testCrossAccountImportConcurrency(): Promise<void> {
  const workerStarted = deferred();
  const releaseWorker = deferred();
  const { app } = freshApp(true, {
    multiAccount: true,
    importWorker: async (request) => {
      workerStarted.resolve();
      await releaseWorker.promise;
      return runImportWorker(request);
    },
  });
  await post(app, "accounts", account("a1"));
  await post(app, "accounts", account("a2"));

  const importing = call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: exportFile("source") },
  });
  await workerStarted.promise;

  const concurrentWrite = await post(app, "resources", person("a2-concurrent", "a2"));
  expect(concurrentWrite.statusCode).toBe(201);
  releaseWorker.resolve();

  const response = await importing;
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ imported: 5, skipped: 1 });
  const current = await readValidatedState(app);
  expect(current.resources).toContainEqual(expect.objectContaining({ id: "a2-concurrent", accountId: "a2" }));
  expect(current.projects).toContainEqual(expect.objectContaining({ accountId: "a1" }));
}

async function testDeletedResourceImportPrivacy(): Promise<void> {
  const { app, db } = freshApp();
  await post(app, "accounts", account("a1"));
  const deleted = {
    ...person("src-r", "source"),
    name: "Named Person",
    archivedAt: "2026-01-02T00:00:00.000Z",
    deletedAt: "2026-01-03T00:00:00.000Z",
  };
  const file = {
    schemaVersion: 3,
    data: {
      accounts: [],
      clients: [client("src-c", "source")],
      disciplines: [],
      projects: [project("src-p", "source", "src-c")],
      phases: [],
      activities: [activity({ id: "src-t", accountId: "source", projectId: "src-p" })],
      resources: [deleted],
      allocations: [
        allocation({
          id: "src-al",
          accountId: "source",
          resourceId: "src-r",
          activityId: "src-t",
          o: {
            note: "Private project context",
          },
        }),
      ],
      timeOff: [
        {
          id: "src-to",
          accountId: "source",
          resourceId: "src-r",
          startDate: "2026-01-01",
          endDate: "2026-01-03",
          type: "sick",
          note: "Private medical detail",
          ...meta(),
        },
      ],
    },
  };

  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: file },
  });

  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ imported: 6, skipped: 0 });
  const importedResource = db.prepare(`SELECT name, deletedAt FROM resources WHERE accountId = 'a1'`).get() as {
    name: string;
    deletedAt: string | null;
  };
  expect(importedResource.name).toMatch(/^Removed person #[a-zA-Z0-9]{12}$/);
  expect(importedResource.deletedAt).toBe(deleted.deletedAt);
  expect(db.prepare(`SELECT note FROM allocations WHERE accountId = 'a1'`).get()).toEqual({ note: null });
  expect(db.prepare(`SELECT note FROM timeOff WHERE accountId = 'a1'`).get()).toEqual({ note: null });
}

async function testDanglingImportForeignKeys(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  // A hand-edited file: a project/phase whose required parent is absent (must be
  // dropped before SQLite's FKs reject the whole import), and an activity/resource whose
  // OPTIONAL parent is absent (must survive, unbound to general / no discipline).
  const file = {
    schemaVersion: 3,
    data: {
      accounts: [],
      clients: [],
      disciplines: [],
      projects: [project("dp", "x", "ghost-client")], // dropped: missing client
      phases: [
        {
          id: "dph",
          accountId: "x",
          name: "P",
          projectId: "ghost-project",
          ...meta(),
        },
      ], // dropped
      resources: [{ ...person("dr", "x"), disciplineId: "ghost-disc" }], // kept, discipline unbound
      activities: [activity({ id: "dt", accountId: "x", projectId: "ghost-project" })], // kept, unbound to a general activity
      allocations: [],
      timeOff: [],
    },
  };
  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: file },
  });
  expect(res.statusCode).toBe(200);
  expect(res.json()).toMatchObject({ imported: 2, skipped: 2 });
  const s = await readValidatedState(app);
  expect(s.projects).toHaveLength(0);
  expect(s.phases).toHaveLength(0);
  expect(s.activities).toHaveLength(1);
  expect(readFirstProjectId(s.activities)).toBeUndefined(); // unbound → general activity
  expect(s.resources).toHaveLength(1);
  expect(readFirstResource(s.resources).disciplineId).toBeUndefined(); // unbound discipline
}

async function testLegacyImportMigration(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  const lr = person("lr", "x") as Record<string, unknown>;
  delete lr.employmentType;
  lr.isFreelancer = true;
  const legacy = { schemaVersion: 1, data: { resources: [lr] } };
  await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: legacy },
  });
  const s = await readValidatedState(app);
  expect(readFirstResource(s.resources).employmentType).toBe("freelancer");
  expect("isFreelancer" in readFirstResource(s.resources)).toBe(false);
}

async function testImportRequiresAccountId(): Promise<void> {
  const { app } = freshApp();
  expect(
    (
      await call(app, {
        method: "POST",
        url: "/api/import",
        payload: { data: {} },
      })
    ).statusCode,
  ).toBe(400);
}

async function testRejectsNonCapacityLensImport(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: { accountId: "a1", data: { nope: true } },
  });
  expect(res.statusCode).toBe(400);
}

async function testRejectsMalformedImportVersion(): Promise<void> {
  const { app } = freshApp();
  await post(app, "accounts", account("a1"));
  await post(app, "resources", person("existing", "a1"));
  const before = await state(app);

  const res = await call(app, {
    method: "POST",
    url: "/api/import",
    payload: {
      accountId: "a1",
      data: {
        schemaVersion: "10",
        data: {
          resources: [person("incoming", "source")],
          futureRecords: [{ id: "would-be-lost" }],
        },
      },
    },
  });

  expect(res.statusCode).toBe(400);
  expect(readErrorResponse(res).error).toMatch(/schema version must be a non-negative safe integer/i);
  expect(await state(app)).toEqual(before);
}

describe("import", () => {
  it("reports bounded import saturation as retryable service pressure", testBoundedImportSaturation);
  it("atomically imports personal time off and closures with fresh foreign keys", testImportTimeOffAndClosures);
  it("imports into an account with fresh ids + remapped FKs, dropping invalid rows", testImportWithFreshIds);
  it(
    "refuses a stale import instead of erasing a same-account write committed during preparation",
    testStaleImportConflict,
  );
  it("does not conflict an import when another account changes during preparation", testCrossAccountImportConcurrency);
  it("does not persist dependent private notes imported for a deleted resource", testDeletedResourceImportPrivacy);
  it("drops records with dangling required FKs and unbinds dangling optional ones", testDanglingImportForeignKeys);
  it("runs the v1→v2 migration on imported data (isFreelancer → employmentType)", testLegacyImportMigration);
  it("requires an accountId", testImportRequiresAccountId);
  it("rejects non-CapacityLens data", testRejectsNonCapacityLensImport);
  it("rejects a malformed present schema version without replacing account data", testRejectsMalformedImportVersion);
});

function createAcceptedAndChangedBatchOperationsTest() {
  it("distinguishes accepted batch operations from state-changing operations", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));

    const result = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "changed-client",
        row: client("changed-client", "a1"),
      },
      {
        method: "DELETE",
        table: "phases",
        id: "missing-phase",
        accountId: "a1",
      },
      {
        method: "DELETE",
        table: "allocations",
        id: "missing-allocation",
        accountId: "a1",
      },
    ]);

    expect(result.statusCode).toBe(200);
    expect(readBatchReceipt(result)).toMatchObject({ ok: true, applied: 3, changed: 1 });
    expect(readBatchReceipt(result).revisions).toHaveLength(1);
  });
}

function createSameBatchRearchiveTest() {
  it("excludes a same-batch re-archive of an already-archived row from changed", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });

    const result = await batch(app, [
      { method: "ARCHIVE", table: "clients", id: "c1", accountId: "a1" },
      { method: "ARCHIVE", table: "clients", id: "c1", accountId: "a1" },
    ]);

    expect(result.statusCode).toBe(200);
    // The first op archives the row; the second sees it already archived (mid-transaction) and its
    // audit record is nulled out — `changed` must reflect only the first.
    expect(result.json()).toMatchObject({ ok: true, applied: 2, changed: 1 });
  });
}

function createScopedProjectionMaterializationTest() {
  it("does not materialize unrelated tables for empty/single-account batches or import", async () => {
    const { db, raw, fullTableSelects } = dbTrackingFullTableSelects();
    const app = createApp(db, {
      multiAccount: true,
      optimisticConcurrency: false,
    });
    await post(app, "accounts", account("a1"));
    await post(app, "accounts", account("a2"));
    await post(app, "clients", client("unrelated-client", "a2"));
    fullTableSelects.length = 0;

    const emptyResult = await batch(app, []);
    const emptyBatchReads = fullTableSelects.splice(0).length;
    const batchResult = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "a1-client",
        row: client("a1-client", "a1"),
      },
    ]);
    const singleAccountBatchReads = fullTableSelects.splice(0).length;
    const importResult = await call(app, {
      method: "POST",
      url: "/api/import",
      payload: {
        accountId: "a1",
        data: {
          schemaVersion: 3,
          data: {
            accounts: [],
            disciplines: [],
            resources: [],
            clients: [client("import-client", "source-account")],
            projects: [],
            phases: [],
            activities: [],
            allocations: [],
            timeOff: [],
          },
        },
      },
    });
    const importReads = fullTableSelects.splice(0).length;

    expect([emptyResult.statusCode, batchResult.statusCode, importResult.statusCode]).toEqual([200, 200, 200]);
    expect({ emptyBatchReads, singleAccountBatchReads, importReads }).toEqual({
      emptyBatchReads: 0,
      singleAccountBatchReads: 0,
      importReads: 0,
    });
    await app.close();
    raw.close();
  });
}

describe("tenant-scoped mutation projections", () => {
  createAcceptedAndChangedBatchOperationsTest();
  createSameBatchRearchiveTest();
  createScopedProjectionMaterializationTest();
});

function createOversizedPayloadGuardTest() {
  it("rejects an oversized payload with 413", async () => {
    const { app } = freshApp();
    const huge = '{"id":"' + "a".repeat(6 * 1024 * 1024) + '"}';
    const res = await call(app, {
      method: "POST",
      url: "/api/accounts",
      headers: { "content-type": "application/json" },
      payload: huge,
    });
    expect(res.statusCode).toBe(413);
  });
}

describe("guards", () => {
  createOversizedPayloadGuardTest();
  it("reset is 403 unless allowed, then wipes + re-seeds", async () => {
    const locked = createApp(openDb(":memory:"), { allowReset: false });
    expect(
      (
        await call(locked, {
          method: "POST",
          url: "/api/test/reset",
          payload: {},
        })
      ).statusCode,
    ).toBe(403);

    const { app } = freshApp(true);
    await scaffold(app);
    await call(app, {
      method: "POST",
      url: "/api/test/reset",
      payload: { seed: true },
    });
    const s = await readValidatedState(app);
    expect(s.accounts.length).toBeGreaterThan(0); // seeded demo data present
  });

  it("reset removes memberships and invitations for wiped companies", async () => {
    const { app, db } = freshApp(true);
    db.prepare(
      `INSERT INTO account_members (accountId, userId, role, status, createdAt)
      VALUES (?, ?, ?, ?, ?)`,
    ).run("old-account", "old-user", "owner", "active", TS);
    db.prepare(
      `INSERT INTO invites
      (tokenHash, id, accountId, role, preauthEmail, expiresAt, usedAt, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("old-token-hash", "old-invite", "old-account", "viewer", null, TS, null, TS);

    expect((await call(app, { method: "POST", url: "/api/test/reset" })).statusCode).toBe(200);

    expect(db.prepare(`SELECT COUNT(*) AS count FROM account_members`).get()).toEqual({ count: 0 });
    expect(db.prepare(`SELECT COUNT(*) AS count FROM invites`).get()).toEqual({
      count: 0,
    });
  });

  it("rolls the wipe back when re-seeding fails", async () => {
    const { app, db } = freshApp(true);
    await scaffold(app);
    const accountsBefore = db.prepare(`SELECT id FROM accounts ORDER BY id`).all();
    db.exec(`
      CREATE TRIGGER reject_seeded_accounts
      BEFORE INSERT ON accounts
      BEGIN
        SELECT RAISE(ABORT, 'forced seed failure');
      END
    `);

    const response = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      payload: { seed: true },
    });

    expect(response.statusCode).toBe(500);
    expect(db.prepare(`SELECT id FROM accounts ORDER BY id`).all()).toEqual(accountsBefore);
  });
});

function createDirectWriteColourAndResourceSanitizationTests(): void {
  it("stores a validated account colour without surrounding whitespace", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", { ...account("a1"), color: "  #aAbBcC  " })).statusCode).toBe(201);
    // #aabbcc is not itself a preset — sanitizeWrite snaps it to its NEAREST preset (shared
    // snapToPresetColor), not a fixed fallback colour. See the "snaps a non-preset account
    // colour to its nearest preset" test below for the policy this replaced.
    expect((await readStateAccount(app)).color).toBe("#bed4f4");
  });

  it("snaps a non-preset account colour to its NEAREST preset, not a fixed fallback colour", async () => {
    // Regression guard for the old blanket-fallback bug: a colour close to one specific preset
    // must land on THAT preset, proving the guard is distance-based rather than always emitting
    // one fixed hex regardless of the input.
    // multiAccount: true — this test deliberately creates a SECOND company on one instance (see
    // the identical note at the other multiAccount call sites above).
    const { app } = freshApp(true, { multiAccount: true });
    await post(app, "accounts", { ...account("a1"), color: "#7cd9e4" });
    expect((await readStateAccount(app)).color).toBe("#7adae3");
    // A colour on the opposite side of the palette snaps to a DIFFERENT preset — proving the two
    // don't collapse onto the same fixed fallback.
    await post(app, "accounts", { ...account("a2"), color: "#f6c3bb" });
    const accounts = (await readValidatedState(app)).accounts;
    expect(readAccount(accounts, "a2").color).toBe("#f5bcbc");
  });

  it("uses the same nearest-preset mapping for direct scoped-entity writes", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const response = await post(app, "resources", {
      ...person("r1", "a1"),
      color: "#eb7273",
    });

    expect(response.statusCode).toBe(201);
    expect(readFirstResource((await readValidatedState(app)).resources).color).toBe("#eb7272");
  });

  it("repairs junk fields and missing legacy halfDays/engagement values on POST", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    // A hand-crafted request that bypasses the UI forms with every value-field wrong.
    const res = await post(app, "resources", {
      id: "r1",
      accountId: "a1",
      kind: "wizard", // invalid → 'person'
      role: "Designer",
      employmentType: "overlord", // invalid → 'permanent'
      workingHoursPerDay: -5, // invalid → 8
      workingDays: "nope", // invalid → [1..5]
      color: "not-a-colour", // invalid → fallback hex
      ...meta(),
    });
    expect(res.statusCode).toBe(201);
    const r = readFirstResource((await readValidatedState(app)).resources);
    expect(r.kind).toBe("person");
    expect(r.employmentType).toBe("permanent");
    expect(r.engagement).toBe("studio");
    expect(r.workingHoursPerDay).toBe(8);
    expect(r.workingDays).toEqual([1, 2, 3, 4, 5]);
    expect(r.halfDays).toEqual([]);
    expect(r.color).toBe("#5c34d4");
  });
}

function createDirectWriteAllocationValueSanitizationTest(): void {
  it("repairs a bad allocation status / hours on PUT", async () => {
    const { app } = freshApp();
    await scaffold(app);
    const res = await put({
      app,
      entity: "allocations",
      id: "al1",
      payload: allocation({
        id: "al1",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: { status: "maybe", hoursPerDay: -3 },
      }),
    });
    expect(res.statusCode).toBe(200);
    const a = readFirstAllocation((await readValidatedState(app)).allocations);
    expect(a.status).toBe("confirmed");
    // A finite out-of-range value clamps to the [0,24] FLOOR (0), matching the shared
    // store clamp — import + store now use one clampHoursPerDay, so they can't diverge.
    // (Only a missing / NaN value falls back to a full 8h day.)
    expect(a.hoursPerDay).toBe(0);
  });
}

function createDirectWriteAllocationSeriesSanitizationTest(): void {
  it("sanitizes repeat-series identity on create and preserves membership on every edit shape", async () => {
    const { app } = freshApp();
    await scaffold(app);
    expect(
      (
        await post(app, "allocations", {
          ...allocation({ id: "al-series", accountId: "a1", resourceId: "r1", activityId: "t1" }),
          seriesId: "  weekly-series  ",
        })
      ).statusCode,
    ).toBe(201);
    expect((await readValidatedState(app)).allocations.find((row) => row.id === "al-series")?.seriesId).toBe(
      "weekly-series",
    );

    expect(
      (
        await put({
          app,
          entity: "allocations",
          id: "al-series",
          payload: {
            ...allocation({ id: "al-series", accountId: "a1", resourceId: "r1", activityId: "t1" }),
            note: "Legacy full replacement",
          },
        })
      ).statusCode,
    ).toBe(200);
    expect((await readValidatedState(app)).allocations.find((row) => row.id === "al-series")?.seriesId).toBe(
      "weekly-series",
    );

    expect(
      (await patch({ app, entity: "allocations", id: "al-series", payload: { seriesId: "another-series" } }))
        .statusCode,
    ).toBe(200);
    expect((await readValidatedState(app)).allocations.find((row) => row.id === "al-series")?.seriesId).toBe(
      "weekly-series",
    );

    expect(
      (
        await post(app, "allocations", {
          ...allocation({ id: "al-blank-series", accountId: "a1", resourceId: "r1", activityId: "t1" }),
          seriesId: "   ",
        })
      ).statusCode,
    ).toBe(201);
    expect((await readValidatedState(app)).allocations.find((row) => row.id === "al-blank-series")).not.toHaveProperty(
      "seriesId",
    );
  });
}

function createDirectWriteAccountSchedulingSanitizationTests(): void {
  it("drops a junk account schedulingMode on a direct write but keeps a valid one", async () => {
    const { app } = freshApp();
    // A hand-crafted account write with a junk schedulingMode the scheduler can't handle.
    expect(
      (
        await post(app, "accounts", {
          ...account("a1"),
          schedulingMode: "wizard",
        })
      ).statusCode,
    ).toBe(201);
    expect((await readStateAccount(app)).schedulingMode).toBeUndefined(); // junk dropped → 'hourly'
    // A valid mode persists unchanged.
    await patch({ app, entity: "accounts", id: "a1", payload: { schedulingMode: "blocks" } });
    expect((await readStateAccount(app)).schedulingMode).toBe("blocks");
  });

  it("defaults, repairs and persists account working-day selections", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", { ...account("a1"), weekStartsOn: 0 })).statusCode).toBe(201);
    expect((await readStateAccount(app)).workingDays).toEqual([0, 1, 2, 3, 4]);

    expect((await patch({ app, entity: "accounts", id: "a1", payload: { workingDays: [1, 3, 5] } })).statusCode).toBe(
      200,
    );
    expect((await readStateAccount(app)).workingDays).toEqual([1, 3, 5]);

    // A pre-v31 full-replacement client does not know this field. Omission preserves the
    // configured selection instead of resetting it to the week-start default.
    expect((await put({ app, entity: "accounts", id: "a1", payload: account("a1") })).statusCode).toBe(200);
    expect((await readStateAccount(app)).workingDays).toEqual([1, 3, 5]);

    expect((await patch({ app, entity: "accounts", id: "a1", payload: { workingDays: [1, 9] } })).statusCode).toBe(200);
    expect((await readStateAccount(app)).workingDays).toEqual([0, 1, 2, 3, 4]);

    expect((await patch({ app, entity: "accounts", id: "a1", payload: { workingDays: [] } })).statusCode).toBe(200);
    expect((await readStateAccount(app)).workingDays).toEqual([0, 1, 2, 3, 4]);
  });
}

describe("value-level sanitization on direct writes (server is the integrity boundary)", () => {
  createDirectWriteColourAndResourceSanitizationTests();
  createDirectWriteAllocationValueSanitizationTest();
  createDirectWriteAllocationSeriesSanitizationTest();
  createDirectWriteAccountSchedulingSanitizationTests();
});

describe("scheduling-mode fields round-trip through the DB", () => {
  it("persists account schedulingMode and a block allocation (hoursPerDay 0 + ignoreWeekends)", async () => {
    const { app } = freshApp();
    await scaffold(app);
    // Switch the company into blocks mode.
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { schedulingMode: "blocks" } })).statusCode).toBe(
      200,
    );
    // A block booking persists hoursPerDay 0 (load ignored) + ignoreWeekends true. The
    // 0 must NOT be sanitized up to a full day, and the boolean must round-trip.
    const res = await post(
      app,
      "allocations",
      allocation({
        id: "al1",
        accountId: "a1",
        resourceId: "r1",
        activityId: "t1",
        o: {
          hoursPerDay: 0,
          ignoreWeekends: true,
        },
      }),
    );
    expect(res.statusCode).toBe(201);
    const s = await readValidatedState(app);
    expect(readFirstAccount(s.accounts).schedulingMode).toBe("blocks");
    expect(readFirstAllocation(s.allocations).hoursPerDay).toBe(0);
    expect(readFirstAllocation(s.allocations).ignoreWeekends).toBe(true);
  });
});

// Seed an account carrying all three frozen fields (so a change is detectable).
const FROZEN = {
  weekStartsOn: 1 as const,
  timezone: "Etc/GMT",
  language: "en",
};

async function seedFrozen(app: FastifyInstance) {
  expect((await post(app, "accounts", { ...account("a1"), ...FROZEN })).statusCode).toBe(201);
}

function createFrozenFieldPatchTests(): void {
  it("PATCH changing weekStartsOn → 409", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    const res = await patch({ app, entity: "accounts", id: "a1", payload: { weekStartsOn: 0 } });
    expect(res.statusCode).toBe(409);
    expect((await readStateAccount(app)).weekStartsOn).toBe(1); // unchanged
  });

  it("PATCH changing timezone → 409", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect(
      (await patch({ app, entity: "accounts", id: "a1", payload: { timezone: "Europe/London" } })).statusCode,
    ).toBe(409);
    expect((await readStateAccount(app)).timezone).toBe("Etc/GMT");
  });

  it("PATCH with an unsupported language is sanitised to an unchanged no-op", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { language: "fr" } })).statusCode).toBe(200);
    expect((await readStateAccount(app)).language).toBe("en");
  });
}

function createFrozenFieldPutTests(): void {
  it("PUT resending the row with a CHANGED frozen field → 409", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    const res = await put({
      app,
      entity: "accounts",
      id: "a1",
      payload: {
        ...account("a1"),
        ...FROZEN,
        weekStartsOn: 0,
      },
    });
    expect(res.statusCode).toBe(409);
    expect((await readStateAccount(app)).weekStartsOn).toBe(1);
  });

  it("an UNCHANGED PUT of the frozen fields → 200 (change-not-presence)", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    // The sync adapter re-sends the WHOLE row on any edit (e.g. a rename) — an unchanged
    // frozen value present in the body must PASS.
    const res = await put({
      app,
      entity: "accounts",
      id: "a1",
      payload: {
        ...account("a1"),
        ...FROZEN,
        name: "Renamed",
      },
    });
    expect(res.statusCode).toBe(200);
    expect((await readStateAccount(app)).name).toBe("Renamed");
  });

  it("an UNCHANGED PATCH of a frozen field → 200", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { weekStartsOn: 1 } })).statusCode).toBe(200);
  });
}

function createFrozenFieldInitializationTest(): void {
  it("lets a minimal /api/orgs account set each missing frozen field once", async () => {
    const { app } = freshApp();
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/orgs",
          payload: body({ id: "a1", name: "Studio" }),
        })
      ).statusCode,
    ).toBe(201);

    expect(
      (
        await patch({
          app,
          entity: "accounts",
          id: "a1",
          payload: {
            weekStartsOn: 0,
            timezone: "Europe/London",
            language: "en",
          },
        })
      ).statusCode,
    ).toBe(200);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { timezone: "Etc/GMT" } })).statusCode).toBe(409);

    const stored = await readStateAccount(app);
    expect(stored).toMatchObject({
      weekStartsOn: 0,
      timezone: "Europe/London",
      language: "en",
    });
  });
}

function createFrozenFieldSanitizationTest(): void {
  it("treats sanitiser-dropped frozen values as no-ops across PUT, PATCH and batch", async () => {
    const { app } = freshApp();
    await seedFrozen(app);

    expect(
      (
        await patch({
          app,
          entity: "accounts",
          id: "a1",
          payload: {
            language: "fr",
            timezone: "Mars/Olympus",
            weekStartsOn: 2,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await put({
          app,
          entity: "accounts",
          id: "a1",
          payload: {
            ...account("a1"),
            ...FROZEN,
            language: 123,
            timezone: null,
            weekStartsOn: -1,
          },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await batch(app, [
          {
            method: "PUT",
            table: "accounts",
            id: "a1",
            row: {
              ...account("a1"),
              ...FROZEN,
              language: "cy",
              timezone: "invalid",
              weekStartsOn: 7,
            },
          },
        ])
      ).statusCode,
    ).toBe(200);

    expect(await readStateAccount(app)).toMatchObject(FROZEN);
  });
}

function createFrozenFieldPreferenceAndBatchTests(): void {
  it("PATCH mutable account preferences, including engagement grouping", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { name: "New Name" } })).statusCode).toBe(200);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { disciplinesEnabled: true } })).statusCode).toBe(
      200,
    );
    expect(
      (await patch({ app, entity: "accounts", id: "a1", payload: { groupResourcesByEngagement: false } })).statusCode,
    ).toBe(200);
    expect((await patch({ app, entity: "accounts", id: "a1", payload: { schedulingMode: "blocks" } })).statusCode).toBe(
      200,
    );
    expect((await readStateAccount(app)).groupResourcesByEngagement).toBe(false);
  });

  it("a batch PUT changing a frozen field returns the same reloadable 409 as direct writes", async () => {
    const { app } = freshApp();
    await seedFrozen(app);
    // Documented asymmetry: the batch maps a ValidationError to 400 (vs the per-route 409).
    const res = await batch(app, [
      {
        method: "PUT",
        table: "accounts",
        id: "a1",
        row: { ...account("a1"), ...FROZEN, timezone: "Europe/London" },
      },
    ]);
    expect(res.statusCode).toBe(409);
    expect((await readStateAccount(app)).timezone).toBe("Etc/GMT"); // tx rolled back
  });
}

describe("account frozen fields (P1.14): language / weekStartsOn / timezone", () => {
  createFrozenFieldPatchTests();
  createFrozenFieldPutTests();
  createFrozenFieldInitializationTest();
  createFrozenFieldSanitizationTest();
  createFrozenFieldPreferenceAndBatchTests();
});

function createErrorStatusMappingTest() {
  it("maps validation + constraint errors to 400 and unexpected errors to 500", () => {
    expect(resolveErrorStatus(new ValidationError("bad ref"))).toBe(400);
    expect(
      resolveErrorStatus(
        Object.assign(new Error("FOREIGN KEY constraint failed"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 787,
        }),
      ),
    ).toBe(400);
    expect(
      resolveErrorStatus(
        Object.assign(new Error("NOT NULL constraint failed: resources.role"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 1299,
        }),
      ),
    ).toBe(400);
    expect(
      resolveErrorStatus(
        Object.assign(new Error("forced erasure failure"), {
          code: "ERR_SQLITE_ERROR",
          errcode: 1811,
        }),
      ),
    ).toBe(500);
    expect(resolveErrorStatus(new Error("upstream constraint failed unexpectedly"))).toBe(500);
    expect(resolveErrorStatus(new Error("something unexpected blew up"))).toBe(500);
    expect(resolveErrorStatus("a string")).toBe(500);
  });
}

describe("error status mapping (statusFor)", () => {
  createErrorStatusMappingTest();
  // PINNING TEST: these trigger real node:sqlite violations so the classifier stays tied to the
  // runtime's structured error metadata for each supported row-data constraint family.
  describe("pins node:sqlite constraint metadata on real violations", () => {
    const grab = (fn: () => void): Error => {
      try {
        fn();
      } catch (e) {
        return e as Error;
      }
      throw new Error("expected a constraint violation, but none was thrown");
    };

    const expectConstraint = (error: Error): void => {
      expect(error).toMatchObject({ code: "ERR_SQLITE_ERROR" });
      expect((error as Error & { errcode: number }).errcode & 0xff).toBe(19);
      expect(resolveErrorStatus(error)).toBe(400);
    };

    it("maps a real NOT NULL violation to 400", () => {
      const db = openDb(":memory:");
      const e = grab(() =>
        db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', NULL, '#fff', 't', 't')`),
      );
      expectConstraint(e);
    });

    it("maps a real UNIQUE/PRIMARY KEY violation to 400", () => {
      const db = openDb(":memory:");
      db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', 'Studio', '#fff', 't', 't')`);
      const e = grab(() =>
        db.exec(`INSERT INTO accounts (id, name, color, createdAt, updatedAt) VALUES ('a', 'Dup', '#fff', 't', 't')`),
      );
      expectConstraint(e);
    });

    it("maps a real FOREIGN KEY violation to 400", () => {
      const db = openDb(":memory:"); // openDb turns foreign_keys ON
      const e = grab(() =>
        db.exec(
          `INSERT INTO clients (id, accountId, name, color, createdAt, updatedAt) VALUES ('c', 'no-such-account', 'Acme', '#fff', 't', 't')`,
        ),
      );
      expectConstraint(e);
    });
  });
});

describe("global error redaction", () => {
  it("does not trust an arbitrary sub-500 statusCode as proof that its message is public", async () => {
    const app = createApp(openDb(":memory:"));
    const sentinel = "PRIVATE schema path /srv/capacitylens.db clients.color";
    const cause = Object.assign(new Error(sentinel), { statusCode: 400 });
    const constraintPhraseCause = new Error("upstream constraint failed unexpectedly");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    app.get("/api/test/decorated-client-error", () => {
      throw cause;
    });
    app.get("/api/test/spoofed-framework-error", () => {
      throw Object.assign(new Error(sentinel), {
        code: "FST_ERR_CTP_BODY_TOO_LARGE",
        statusCode: 413,
      });
    });
    app.get("/api/test/non-sqlite-constraint-phrase", () => {
      throw constraintPhraseCause;
    });

    try {
      const response = await app.inject({
        method: "GET",
        url: "/api/test/decorated-client-error",
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({ error: "Internal server error" });
      expect(response.body).not.toContain(sentinel);
      expect(consoleError).toHaveBeenCalledWith(cause);

      const spoofed = await app.inject({
        method: "GET",
        url: "/api/test/spoofed-framework-error",
      });
      expect(spoofed.statusCode).toBe(413);
      expect(spoofed.json()).toEqual({ error: "Request body is too large" });
      expect(spoofed.body).not.toContain(sentinel);

      consoleError.mockClear();
      const unrelated = await app.inject({
        method: "GET",
        url: "/api/test/non-sqlite-constraint-phrase",
      });
      expect(unrelated.statusCode).toBe(500);
      expect(unrelated.json()).toEqual({ error: "Internal server error" });
      expect(unrelated.body).not.toContain(constraintPhraseCause.message);
      expect(consoleError).toHaveBeenCalledWith(constraintPhraseCause);
    } finally {
      consoleError.mockRestore();
    }
  });
});

function createCorsOriginConfigurationTests() {
  it("defaults FAIL-CLOSED to the localhost allow-list (not a wildcard)", async () => {
    const { app } = freshApp();
    // A local dev origin is reflected (it's on the default allow-list)…
    const local = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(local.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    // …but an arbitrary site gets NO ACAO header (the browser blocks it) — the factory
    // never opens to '*' unless explicitly told to.
    const evil = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.test" },
    });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects '*' because credentialed CORS requires explicit origins", () => {
    expect(() => createApp(openDb(":memory:"), { corsOrigin: "*" })).toThrow(/explicit/i);
  });

  it("normalizes harmless origin spellings and rejects non-origin URLs at startup", async () => {
    const app = createApp(openDb(":memory:"), {
      corsOrigin: "HTTPS://APP.EXAMPLE.COM:443/,http://localhost:80",
    });

    const canonicalHttps = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "https://app.example.com" },
    });
    expect(canonicalHttps.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    const canonicalHttp = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost" },
    });
    expect(canonicalHttp.headers["access-control-allow-origin"]).toBe("http://localhost");

    for (const corsOrigin of [
      "not an origin",
      "ftp://app.example.com",
      "https://user@app.example.com",
      "https://app.example.com/path",
      "https://app.example.com?query=1",
      "https://app.example.com#fragment",
    ]) {
      expect(() => createApp(openDb(":memory:"), { corsOrigin })).toThrow(/bare HTTP\(S\) origin/i);
    }
  });
}

function createCorsReflectionTests() {
  it("reflects an allowed origin and omits the header for a disallowed one", async () => {
    const app = createApp(openDb(":memory:"), {
      corsOrigin: "http://good.test,http://also.test",
    });
    const ok = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://good.test" },
    });
    expect(ok.headers["access-control-allow-origin"]).toBe("http://good.test");
    const bad = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.test" },
    });
    expect(bad.headers["access-control-allow-origin"]).toBeUndefined();
  });
}

function createCorsCredentialAndRequestGateTests() {
  it("pairs Allow-Credentials with every reflected explicit origin (P3.4)", async () => {
    // The client sends credentials: 'include' on every request; a credentialed
    // cross-origin response without this header is refused by the browser.
    const { app } = freshApp();
    const reflected = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://localhost:5173" },
    });
    expect(reflected.headers["access-control-allow-credentials"]).toBe("true");
    const disallowed = await call(app, {
      method: "GET",
      url: "/api/health",
      headers: { origin: "http://evil.test" },
    });
    expect(disallowed.headers["access-control-allow-credentials"]).toBeUndefined();
  });

  it("answers a write preflight with 204 + CORS headers (no OPTIONS route exists)", async () => {
    // Regression guard: every cross-origin write (JSON POST/PUT/PATCH/DELETE) is
    // preflighted by the browser, and OPTIONS matches no route — the 204 comes from the
    // ROOT-level onRequest hook on the not-found path. When the hook briefly moved into
    // the routes child plugin, preflights became bare 404s without CORS headers and the
    // db-backed e2e app could no longer save anything.
    const { app } = freshApp();
    const res = await call(app, {
      method: "OPTIONS",
      url: "/api/batch",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(res.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("rejects unsafe browser requests from a disallowed Origin before the handler runs", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: { origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-site request rejected." });
  });

  it("rejects cross-site Fetch Metadata even when Origin is absent", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.statusCode).toBe(403);
  });
}

function createCorsSameOriginTests() {
  it("keeps non-browser clients and allowed same-origin writes working", async () => {
    const { app } = freshApp();
    expect((await call(app, { method: "POST", url: "/api/test/reset" })).statusCode).toBe(200);
    expect(
      (
        await call(app, {
          method: "POST",
          url: "/api/test/reset",
          headers: {
            origin: "http://localhost:5173",
            "sec-fetch-site": "same-site",
          },
        })
      ).statusCode,
    ).toBe(200);
  });

  it("accepts the packaged same-origin proxy path without requiring a redundant CORS allow-list", async () => {
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
      trustProxyHeaders: true,
    });
    const response = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com",
        origin: "https://capacity.example.com",
        "x-forwarded-proto": "https",
        "sec-fetch-site": "same-origin",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["access-control-allow-origin"]).toBe("https://capacity.example.com");
  });

  it("falls back to exact trusted-proxy scheme and Host comparison without Fetch Metadata", async () => {
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
      trustProxyHeaders: true,
    });
    const response = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com:8443",
        origin: "https://capacity.example.com:8443",
        "x-forwarded-proto": "https",
      },
    });
    expect(response.statusCode).toBe(200);
  });
}

function createCorsCrossSiteAndTlsTests() {
  it("lets a cross-site write through when its Origin is on the credentialed allow-list (Fetch Metadata notwithstanding)", async () => {
    // FIX: an Origin EXACTLY on the CORS allow-list is the operator's explicit cross-site contract,
    // so it must pass the gate even when the browser labels the request Sec-Fetch-Site: cross-site
    // (the legitimate configured cross-origin call). The old gate 403'd it on the fetchSite clause
    // despite the allow-list match; now the allow-listed Origin is reflected and the write proceeds.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "https://app.example.com",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        origin: "https://app.example.com",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["access-control-allow-origin"]).toBe("https://app.example.com");
  });

  it("still 403s a genuinely cross-site write from a NON-listed Origin", async () => {
    // The allow-list exemption is exact-match only; an Origin that is neither allow-listed nor
    // same-origin, carrying a cross-site signal, remains a hard 403.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "https://app.example.com",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        origin: "https://evil.example",
        "sec-fetch-site": "cross-site",
      },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-site request rejected." });
  });
}

function createCorsTlsTerminationTests() {
  it("treats a TLS-terminated https Origin as same-origin when only the scheme differs from http req.protocol", async () => {
    // FIX: with no Fetch Metadata and forwarded-proto NOT trusted, the standard TLS-termination
    // deploy has the browser-set Origin claim https:// while req.protocol sees http (cleartext hop
    // behind the proxy). When the Origin's host:port matches our Host and the ONLY difference is
    // that scheme upgrade, it is same-origin — the browser sets the Origin host, so it can't be
    // forged from another site. No allow-list entry and no trustProxyHeaders here.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com",
        origin: "https://capacity.example.com",
      },
    });
    expect(res.statusCode).toBe(200);
  });

  it("still 403s when the https Origin host does NOT match the request Host", async () => {
    // The scheme-upgrade exemption is host-pinned: a mismatched host stays a cross-site 403.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: {
        host: "capacity.example.com",
        origin: "https://other.example.com",
      },
    });
    expect(res.statusCode).toBe(403);
  });
}

function createCorsMalformedHostAndHeaderTests() {
  it("returns a clean 403 (not a 500) when a broken proxy sends a malformed Host header", async () => {
    // REGRESSION: the same-origin check reconstructs `${protocol}://${host}` from the Host header, an
    // untrusted, proxy-influenced string. A broken proxy (or a forged request) can send a Host that
    // `new URL` rejects — here 'exa mple.com' (embedded space). That reconstruct MUST be guarded: an
    // unparseable Host is "cannot prove same-origin" → fail closed → clean cross-site 403. A refactor
    // once moved the reconstruct out of the try/catch, turning this into an uncaught TypeError → 500.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    const res = await call(app, {
      method: "POST",
      url: "/api/test/reset",
      headers: { host: "exa mple.com", origin: "https://capacity.example.com" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: "Cross-site request rejected." });
  });

  it("returns a clean 403 for other unparseable Host shapes from a broken proxy", async () => {
    // Same total-function guarantee across the other Host shapes a broken proxy can emit: a lone '['
    // (unterminated IPv6 bracket) and a double-port 'host:port:port'. Every one fails closed to 403.
    const app = createApp(openDb(":memory:"), {
      allowReset: true,
      corsOrigin: "",
    });
    for (const host of ["[", "capacity.example.com:8443:9000"]) {
      const res = await call(app, {
        method: "POST",
        url: "/api/test/reset",
        headers: { host, origin: "https://capacity.example.com" },
      });
      expect(res.statusCode, `host=${host}`).toBe(403);
    }
  });

  it("Allow-Headers lists JSON plus both operator-secret headers", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "OPTIONS",
      url: "/api/orgs",
      headers: {
        origin: "http://localhost:5173",
        "access-control-request-method": "POST",
        "access-control-request-headers":
          "content-type, x-capacitylens-bootstrap-token, x-capacitylens-setup-token, x-capacitylens-sync-session, x-capacitylens-sync-sequence",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-headers"]).toContain("Content-Type");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-bootstrap-token");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-setup-token");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-sync-session");
    expect(res.headers["access-control-allow-headers"]).toContain("x-capacitylens-sync-sequence");
    expect(res.headers["access-control-expose-headers"]).toContain("x-capacitylens-audit-warning");
  });
}

describe("CORS allow-list", () => {
  createCorsOriginConfigurationTests();
  createCorsReflectionTests();
  createCorsCredentialAndRequestGateTests();
  createCorsSameOriginTests();
  createCorsCrossSiteAndTlsTests();
  createCorsTlsTerminationTests();
  createCorsMalformedHostAndHeaderTests();
});

describe("sensitive response caching", () => {
  it("sets no-store on health, errors, and authenticated API responses", async () => {
    const { app } = freshApp();
    for (const request of [
      { method: "GET" as const, url: "/api/health" },
      { method: "GET" as const, url: "/api/state" },
      { method: "GET" as const, url: "/api/does-not-exist" },
    ]) {
      const res = await call(app, request);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers.pragma).toBe("no-cache");
    }
  });
});

function createDirectPutConcurrencyTests(): void {
  it("rejects a stale PUT with 409 when enabled; allows same/newer", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    // Store a client at T2.
    const created = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    // A PUT carrying an OLDER updatedAt (T1) is a stale overwrite → 409.
    const stale = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Stale",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Acme"); // not overwritten
    // A PUT at a newer time succeeds.
    const fresh = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Fresh",
        updatedAt: readClientResponse(created).updatedAt,
      },
    });
    expect(fresh.statusCode).toBe(200);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Fresh");
  });
}

function createDirectPatchConcurrencyTests(): void {
  it("rejects a stale PATCH and accepts one carrying the current server revision", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
    const stale = await patch({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        name: "Stale",
        updatedAt: "2000-01-01T00:00:00.000Z",
      },
    });
    expect(stale.statusCode).toBe(409);
    const fresh = await patch({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        name: "Fresh",
        updatedAt: readClientResponse(created).updatedAt,
      },
    });
    expect(fresh.statusCode).toBe(200);
    expect(readClientResponse(fresh).name).toBe("Fresh");
    expect(Date.parse(readClientResponse(fresh).updatedAt)).not.toBeNaN();
  });
}

function createConcurrencyOptOutTests(): void {
  it("can be explicitly disabled for a trusted single-writer deployment", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const stale = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Stale",
        updatedAt: "2026-02-01T00:00:00.000Z",
      },
    });
    expect(stale.statusCode).toBe(200);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Stale");
  });
}

function createBatchStalePutConcurrencyTests(): void {
  // The batch PUT branch applies the SAME stale-write refusal as the direct PUT (it previously
  // had none — a stale client batch could silently overwrite newer server rows even with the flag
  // on). The 409 carries the stored row as `current`, and — the batch being one tx — rolls the
  // WHOLE batch back, sibling ops included.
  it("batch: rejects a stale PUT op with 409 + current when enabled, rolling back the WHOLE batch", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    const created = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const res = await batch(app, [
      // A fresh sibling op that would succeed alone — it must NOT survive the rollback.
      {
        method: "PUT",
        table: "clients",
        id: "c2",
        row: { ...client("c2", "a1"), updatedAt: "2026-02-03T00:00:00.000Z" },
      },
      // The stale op: older updatedAt than the stored row → conflict.
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: {
          ...client("c1", "a1"),
          name: "Stale",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
    ]);
    expect(res.statusCode).toBe(409);
    // The direct PUT route's exact conflict shape: a message + the stored row for client re-sync.
    expect(readConflictResponse(res).error).toBe("The record was modified more recently on the server.");
    expect(readConflictResponse(res).current).toMatchObject({
      id: "c1",
      name: "Acme",
      updatedAt: readClientResponse(created).updatedAt,
    });
    const s = await readValidatedState(app);
    expect(readClientIds(s.clients)).toEqual(["c1"]); // c2 rolled back with the batch
    expect(readFirstClientName(s.clients)).toBe("Acme"); // c1 not overwritten
  });
}

function createBatchFreshPutConcurrencyTests(): void {
  it("batch: a fresh (same/newer updatedAt) PUT op passes with the flag on", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    const created = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const res = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: {
          ...client("c1", "a1"),
          name: "Fresh",
          updatedAt: readClientResponse(created).updatedAt,
        },
      },
    ]);
    expect(res.statusCode).toBe(200);
    const revisions = readBatchReceipt(res).revisions;
    expect(revisions).toHaveLength(1);
    const [revision] = revisions;
    if (!revision) throw new Error("Expected the batch response to contain a revision.");
    const persisted = readFirstClient((await readValidatedState(app)).clients);
    expect(revision).toEqual({
      table: "clients",
      id: "c1",
      createdAt: persisted.createdAt,
      updatedAt: persisted.updatedAt,
    });
    expect(isIsoInstant(revision.createdAt)).toBe(true);
    expect(isIsoInstant(revision.updatedAt)).toBe(true);
    expect(persisted.name).toBe("Fresh");
  });
}

function createMissingRevisionConcurrencyTests(): void {
  it("rejects existing-row PUTs that omit the required revision precondition", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const noStamp: Record<string, unknown> = { ...client("c1", "a1") };
    delete noStamp.updatedAt;
    const viaBatch = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: { ...noStamp, name: "NoStamp" },
      },
    ]);
    const viaPut = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...noStamp,
        name: "NoStamp",
      },
    });
    expect(viaBatch.statusCode).toBe(viaPut.statusCode);
    expect(viaBatch.statusCode).toBe(409);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Acme");
  });
}

function createFutureRevisionConcurrencyTests(): void {
  it("rejects a future-authored revision instead of treating it as fresher than the server", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });

    const res = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        name: "Future overwrite",
        updatedAt: "9999-12-31T23:59:59.999Z",
      },
    });

    expect(res.statusCode).toBe(409);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Acme");
  });
}

function createPartialPatchConcurrencyTests(): void {
  it("accepts a partial PATCH that omits updatedAt (a normal partial edit is never a 409)", async () => {
    // The PATCH route calls isStaleWrite unconditionally; a partial PATCH legitimately omits
    // updatedAt, so it must NOT be treated as a stale conflict — otherwise every ordinary partial
    // edit 409s. Restored documented semantics: no incoming updatedAt ⇒ no basis for a conflict.
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: true });
    await post(app, "accounts", account("a1"));
    await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
    const res = await patch({ app, entity: "clients", id: "c1", payload: { name: "Renamed" } });
    expect(res.statusCode).toBe(200);
    expect(readClientResponse(res).name).toBe("Renamed");
    expect(Date.parse(readClientResponse(res).updatedAt)).not.toBeNaN();
  });
}

function createNullPatchConcurrencyTests(): void {
  it("rejects null for a required PATCH field without rewriting the stored value", async () => {
    const app = createApp(openDb(":memory:"));
    await post(app, "accounts", account("a1"));
    await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });

    const res = await patch({ app, entity: "clients", id: "c1", payload: { name: null } });

    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/required field.*cannot be null/i);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Acme");
  });
}

function createUnparseableStoredRevisionTests(): void {
  it("keeps writing to a row whose STORED updatedAt is unparseable (never write-bricked)", async () => {
    // Regression: the inverted predicate returned "stale" whenever a timestamp failed to parse, so a
    // row with a corrupt/legacy stored updatedAt 409'd on EVERY write — permanently unrecoverable.
    // With the fix an unparseable stored side is simply "no basis for a conflict", so the write
    // proceeds and the server re-stamps a fresh valid updatedAt.
    const db = openDb(":memory:");
    const app = createApp(db, { optimisticConcurrency: true });
    insertRow(db, "accounts", account("a1"));
    insertRow(db, "clients", {
      ...client("c1", "a1"),
      updatedAt: "not-a-real-timestamp",
    });
    const res = await patch({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        name: "Recovered",
        updatedAt: "2026-03-01T00:00:00.000Z",
      },
    });
    expect(res.statusCode).toBe(200);
    expect(readClientResponse(res).name).toBe("Recovered");
    expect(Date.parse(readClientResponse(res).updatedAt)).not.toBeNaN();
  });
}

function createUnincrementableStoredRevisionTests(): void {
  it.each(["9999-12-31T23:59:59.999Z", "+010000-01-01T00:00:00.000Z", "+275760-09-13T00:00:00.000Z"])(
    "repairs an unincrementable or expanded stored revision through the API: %s",
    async (storedRevision) => {
      const db = openDb(":memory:");
      const app = createApp(db, { optimisticConcurrency: false });
      insertRow(db, "accounts", account("a1"));
      insertRow(db, "clients", { ...client("c1", "a1"), updatedAt: storedRevision });

      const res = await patch({ app, entity: "clients", id: "c1", payload: { name: "Recovered boundary" } });

      expect(res.statusCode).toBe(200);
      expect(isIsoInstant(readClientResponse(res).updatedAt)).toBe(true);
      expect(readClientResponse(res).updatedAt).not.toBe(storedRevision);
    },
  );
}

function createBatchConcurrencyOptOutTests(): void {
  it("batch: explicit opt-out restores last-writer-wins semantics", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...client("c1", "a1"),
        updatedAt: "2026-02-02T00:00:00.000Z",
      },
    });
    const res = await batch(app, [
      {
        method: "PUT",
        table: "clients",
        id: "c1",
        row: {
          ...client("c1", "a1"),
          name: "Stale",
          updatedAt: "2026-02-01T00:00:00.000Z",
        },
      },
    ]);
    expect(res.statusCode).toBe(200);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Stale");
  });
}

function createOrderedBatchSuccessorTests(): void {
  it.each([true, false])(
    "ordered browser batches preserve the newer edit when sequence 1 commits before sequence 2 (optimistic=%s)",
    async (optimisticConcurrency) => {
      const app = createApp(openDb(":memory:"), { optimisticConcurrency });
      await post(app, "accounts", account("a1"));
      const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
      const baseRevision = readClientResponse(created).updatedAt;
      const sessionId = "browser-session-0001";
      const first = await orderedBatch({
        app,
        sessionId,
        sequence: 1,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: {
              ...client("c1", "a1"),
              name: "First",
              updatedAt: baseRevision,
            },
          },
        ],
      });
      const second = await orderedBatch({
        app,
        sessionId,
        sequence: 2,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: {
              ...client("c1", "a1"),
              name: "Newest",
              updatedAt: baseRevision,
            },
          },
        ],
      });

      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(readBatchSuperseded(second)).toBeUndefined();
      expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Newest");
    },
  );
}

function createOrderedBatchSupersessionTests(): void {
  it.each([true, false])(
    "ordered browser batches preserve the newer edit when sequence 2 arrives before sequence 1 (optimistic=%s)",
    async (optimisticConcurrency) => {
      const app = createApp(openDb(":memory:"), { optimisticConcurrency });
      await post(app, "accounts", account("a1"));
      const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
      const baseRevision = readClientResponse(created).updatedAt;
      const sessionId = "browser-session-0002";
      const second = await orderedBatch({
        app,
        sessionId,
        sequence: 2,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: {
              ...client("c1", "a1"),
              name: "Newest",
              updatedAt: baseRevision,
            },
          },
        ],
      });
      const first = await orderedBatch({
        app,
        sessionId,
        sequence: 1,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: {
              ...client("c1", "a1"),
              name: "First",
              updatedAt: baseRevision,
            },
          },
        ],
      });

      expect(second.statusCode).toBe(200);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({
        ok: true,
        applied: 1,
        superseded: true,
      });
      expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("Newest");
    },
  );
}

function createOrderedLifecycleFenceTests(): void {
  it.each([true, false])(
    "an ordered teardown archive fences an older in-flight lifecycle creation (optimistic=%s)",
    async (optimisticConcurrency) => {
      const app = createApp(openDb(":memory:"), { optimisticConcurrency });
      await post(app, "accounts", account("a1"));
      const pendingClient = client("c1", "a1");
      const sessionId = "browser-session-lifecycle-0001";

      const teardown = await orderedBatch({
        app,
        sessionId,
        sequence: 2,
        ops: [
          {
            method: "ARCHIVE",
            table: "clients",
            id: "c1",
            accountId: "a1",
            updatedAt: pendingClient.updatedAt,
          },
        ],
      });
      const olderCreation = await orderedBatch({
        app,
        sessionId,
        sequence: 1,
        ops: [
          {
            method: "PUT",
            table: "clients",
            id: "c1",
            row: pendingClient,
          },
        ],
      });

      expect(teardown.statusCode).toBe(200);
      expect(teardown.json()).toMatchObject({ ok: true, applied: 1, changed: 0 });
      expect(olderCreation.statusCode).toBe(200);
      expect(olderCreation.json()).toMatchObject({ ok: true, applied: 1, superseded: true });
      expect((await readValidatedState(app)).clients).toEqual([]);
    },
  );
}

function createOrderedLifecycleArchiveTests(): void {
  it("applies an ordered lifecycle archive atomically and retains its inactive row", async () => {
    const db = openDb(":memory:");
    const app = createApp(db);
    await post(app, "accounts", account("a1"));
    const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });

    const response = await orderedBatch({
      app,
      sessionId: "browser-session-lifecycle-0002",
      sequence: 1,
      ops: [
        {
          method: "ARCHIVE",
          table: "clients",
          id: "c1",
          accountId: "a1",
          updatedAt: readClientResponse(created).updatedAt,
        },
      ],
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true, applied: 1, changed: 1 });
    const archivedRow = getRow(db, "clients", "c1");
    if (!isUnknownRecord(archivedRow)) throw new Error("Expected the archived client row to remain in the database.");
    expect(readRequiredString(archivedRow, "id", "archived client row")).toBe("c1");
    expect(readRequiredString(archivedRow, "accountId", "archived client row")).toBe("a1");
    expect(isIsoInstant(readRequiredString(archivedRow, "archivedAt", "archived client row"))).toBe(true);
  });
}

function createOrderedExternalEditTests(): void {
  it("ordered successor still rejects a stale write after an intervening external edit", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    const created = await put({ app, entity: "clients", id: "c1", payload: client("c1", "a1") });
    const baseRevision = readClientResponse(created).updatedAt;
    const sessionId = "browser-session-0003";
    await orderedBatch({
      app,
      sessionId,
      sequence: 1,
      ops: [
        {
          method: "PUT",
          table: "clients",
          id: "c1",
          row: { ...client("c1", "a1"), name: "First", updatedAt: baseRevision },
        },
      ],
    });
    const afterFirst = readFirstClient((await readValidatedState(app)).clients);
    await put({ app, entity: "clients", id: "c1", payload: { ...afterFirst, name: "External" } });
    const successor = await orderedBatch({
      app,
      sessionId,
      sequence: 2,
      ops: [
        {
          method: "PUT",
          table: "clients",
          id: "c1",
          row: { ...client("c1", "a1"), name: "Newest", updatedAt: baseRevision },
        },
      ],
    });

    expect(successor.statusCode).toBe(409);
    expect(readFirstClientName((await readValidatedState(app)).clients)).toBe("External");
  });
}

function createOrderedStaleDeleteTests(): void {
  it("ordered stale DELETE rolls back its batch and preserves an externally edited row", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    const { baseRevision, external } = await createExternalAllocationEdit(app);
    expect(external.statusCode).toBe(200);
    const externalRevision = readUpdatedAt(external);
    expect(externalRevision).not.toBe(baseRevision);

    const staleDelete = await orderedBatch({
      app,
      sessionId: "stale-delete-browser-1",
      sequence: 1,
      ops: [
        {
          method: "PUT",
          table: "disciplines",
          id: "rolled-back",
          row: {
            id: "rolled-back",
            accountId: "a1",
            name: "Must not persist",
            color: "#5c34d4",
            sortOrder: 0,
            ...meta(),
          },
        },
        {
          method: "DELETE",
          table: "allocations",
          id: "al1",
          accountId: "a1",
          updatedAt: baseRevision,
        },
      ],
    });

    expect(staleDelete.statusCode).toBe(409);
    expect(staleDelete.json()).toMatchObject({
      error: "The record was modified more recently on the server.",
      current: {
        id: "al1",
        note: "Committed by another browser",
        updatedAt: externalRevision,
      },
    });
    const current = await readValidatedState(app);
    expect(current.allocations).toEqual([
      expect.objectContaining({
        id: "al1",
        note: "Committed by another browser",
      }),
    ]);
    expect(current.disciplines).toEqual([]);
  });
}

function createOrderedStaleArchiveTests(): void {
  it("ordered stale ARCHIVE rolls back its batch when it is not a same-session successor", async () => {
    const app = createApp(openDb(":memory:"), { optimisticConcurrency: false });
    await post(app, "accounts", account("a1"));
    const created = await post(app, "clients", client("c1", "a1"));
    const createdRow = created.json() as Record<string, unknown>;
    const baseRevision = createdRow.updatedAt as string;
    const external = await put({
      app,
      entity: "clients",
      id: "c1",
      payload: {
        ...createdRow,
        name: "Externally edited",
        updatedAt: baseRevision,
      },
    });
    expect(external.statusCode).toBe(200);

    const response = await orderedBatch({
      app,
      sessionId: "stale-archive-browser-1",
      sequence: 1,
      ops: [
        {
          method: "ARCHIVE",
          table: "clients",
          id: "c1",
          accountId: "a1",
          updatedAt: baseRevision,
        },
      ],
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: "The record was modified more recently on the server.",
      current: { id: "c1", name: "Externally edited" },
    });
    expect(await readStateClients(app)).toEqual([expect.objectContaining({ id: "c1", name: "Externally edited" })]);
  });
}

function createOrderedNonLifecycleDeletionTests(): void {
  it.each(["first-before-undo", "undo-before-first"])(
    "ordered creation followed by a non-lifecycle deletion cannot be resurrected (%s)",
    async (arrivalOrder) => {
      const app = createApp(openDb(":memory:"), {
        optimisticConcurrency: false,
      });
      await post(app, "accounts", account("a1"));
      const sessionId = `browser-session-${arrivalOrder}`;
      const row = {
        id: "d1",
        accountId: "a1",
        name: "Temporary",
        color: "#5c34d4",
        sortOrder: 0,
        createdAt: TS,
        updatedAt: TS,
      };
      const create = () =>
        orderedBatch({ app, sessionId, sequence: 1, ops: [{ method: "PUT", table: "disciplines", id: "d1", row }] });
      const undo = () =>
        orderedBatch({
          app,
          sessionId,
          sequence: 2,
          ops: [
            {
              method: "DELETE",
              table: "disciplines",
              id: "d1",
              accountId: "a1",
              updatedAt: TS,
            },
          ],
        });

      const responses =
        arrivalOrder === "first-before-undo" ? [await create(), await undo()] : [await undo(), await create()];

      expect(responses.every((response) => response.statusCode === 200)).toBe(true);
      expect((await readValidatedState(app)).disciplines).toEqual([]);
    },
  );
}

describe("optimistic concurrency (default-on)", () => {
  createDirectPutConcurrencyTests();
  createDirectPatchConcurrencyTests();
  createConcurrencyOptOutTests();
  createBatchStalePutConcurrencyTests();
  createBatchFreshPutConcurrencyTests();
  createMissingRevisionConcurrencyTests();
  createFutureRevisionConcurrencyTests();
  createPartialPatchConcurrencyTests();
  createNullPatchConcurrencyTests();
  createUnparseableStoredRevisionTests();
  createUnincrementableStoredRevisionTests();
  createBatchConcurrencyOptOutTests();
  createOrderedBatchSuccessorTests();
  createOrderedBatchSupersessionTests();
  createOrderedLifecycleFenceTests();
  createOrderedLifecycleArchiveTests();
  createOrderedExternalEditTests();
  createOrderedStaleDeleteTests();
  createOrderedStaleArchiveTests();
  createOrderedNonLifecycleDeletionTests();
});

describe("batch op-count cap (MAX_BATCH_OPS)", () => {
  it(`rejects a batch of more than ${MAX_BATCH_OPS} ops with 400 before anything is written`, async () => {
    const { app } = freshApp();
    // Op count (not just body bytes) bounds parsing, authorization, scoped projection updates and
    // writes — the cap must fire BEFORE the pre-scan/tx, leaving the DB untouched.
    const ops = Array.from({ length: MAX_BATCH_OPS + 1 }, (_, i) => ({
      method: "PUT",
      table: "accounts",
      id: `flood-${i}`,
      row: account(`flood-${i}`),
    }));
    const res = await batch(app, ops);
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toContain(String(MAX_BATCH_OPS));
    expect((await readValidatedState(app)).accounts).toHaveLength(0); // nothing written
  });

  it(`allows a batch of exactly ${MAX_BATCH_OPS} ops (boundary, inclusive)`, async () => {
    const { app, db } = freshApp();
    await post(app, "accounts", account("a1"));
    // Exercise the expensive shape the cap is intended to contain: real updates against a
    // pre-populated table, not missing-row DELETE padding. Batch validation and projection updates
    // use indexes, so this remains proportional to the operation count plus one account-slice read.
    tx(db, () => {
      for (let index = 0; index < MAX_BATCH_OPS; index += 1) {
        upsertRow(db, "clients", client(`client-${index}`, "a1"));
      }
    });
    const ops = Array.from({ length: MAX_BATCH_OPS }, (_, index) => ({
      method: "PUT",
      table: "clients",
      id: `client-${index}`,
      row: { ...client(`client-${index}`, "a1"), name: `Updated ${index}` },
    }));
    const startedAt = performance.now();
    const res = await batch(app, ops);
    const handlerMs = performance.now() - startedAt;
    expect(res.statusCode).toBe(200);
    expect(handlerMs).toBeLessThan(MAX_BATCH_HANDLER_BUDGET_MS);
    expect((db.prepare(`SELECT COUNT(*) AS n FROM clients WHERE name LIKE 'Updated %'`).get() as { n: number }).n).toBe(
      MAX_BATCH_OPS,
    );
  });
});

describe("null-id rejection (POST/batch without id → 400)", () => {
  it("POST without an id is rejected with 400", async () => {
    const { app } = freshApp();
    const res = await post(app, "accounts", {
      name: "No Id",
      color: "#3b82f6",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/id/);
    // nothing persisted
    expect((await readValidatedState(app)).accounts).toHaveLength(0);
  });

  it("POST with id: null is rejected with 400", async () => {
    const { app } = freshApp();
    const res = await post(app, "accounts", {
      id: null,
      name: "Null Id",
      color: "#3b82f6",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/id/);
  });

  it("POST with empty-string id is rejected with 400", async () => {
    const { app } = freshApp();
    const res = await post(app, "accounts", {
      id: "",
      name: "Empty Id",
      color: "#3b82f6",
      ...meta(),
    });
    expect(res.statusCode).toBe(400);
    expect(readErrorResponse(res).error).toMatch(/id/);
  });

  it("batch PUT op with a missing/non-string id is rejected with 400", async () => {
    const { app } = freshApp();
    // A batch op whose id field is not a string — the batch handler rejects it before
    // it can reach sanitizeWrite (typeof id !== 'string' check).
    const res = await call(app, {
      method: "POST",
      url: "/api/batch",
      payload: body({
        ops: [
          {
            method: "PUT",
            table: "accounts",
            row: { name: "No Id", color: "#3b82f6", ...meta() },
          },
        ],
      }),
    });
    expect(res.statusCode).toBe(400);
    expect((await readValidatedState(app)).accounts).toHaveLength(0);
  });
});

describe("absent/null request body on generic writes → 400, not 500", () => {
  // POST /api/:entity used to dereference the body (body.accountId! for a scoped table,
  // sanitizeWrite's assertIdPresent for accounts) BEFORE any 400 classification could run, so a
  // missing/null body crashed as an unclassified TypeError → statusFor → 500. /api/batch and
  // /api/import already guard `!body` this way; the generic routes now match.
  it("POST /api/resources with no body/Content-Type is 400, not 500", async () => {
    const { app } = freshApp();
    const res = await call(app, { method: "POST", url: "/api/resources" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("POST /api/resources with a literal JSON null body is 400, not 500", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/resources",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("POST /api/accounts with no body/Content-Type is 400, not 500", async () => {
    // Regression for the accounts branch specifically: it skips the scoped-table authorize
    // dereference and instead crashed inside sanitizeWrite's assertIdPresent (row.id on null/undefined).
    const { app } = freshApp();
    const res = await call(app, { method: "POST", url: "/api/accounts" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("POST /api/accounts with a literal JSON null body is 400, not 500", async () => {
    const { app } = freshApp();
    const res = await call(app, {
      method: "POST",
      url: "/api/accounts",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  // The sibling handler: PATCH /api/:entity/:id ran entirely inside a try/catch, but a null body
  // still surfaced as 500 — accountFieldsFrozen's `field in incoming` throws on null, and the
  // caught TypeError isn't a ValidationError/constraint-failed, so statusFor mapped it to 500.
  it("PATCH /api/accounts/:id with a literal JSON null body is 400, not 500", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await call(app, {
      method: "PATCH",
      url: "/api/accounts/a1",
      payload: "null",
      headers: { "content-type": "application/json" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });

  it("PATCH /api/accounts/:id with no body/Content-Type is 400, not 500", async () => {
    const { app } = freshApp();
    await post(app, "accounts", account("a1"));
    const res = await call(app, { method: "PATCH", url: "/api/accounts/a1" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "A request body is required." });
  });
});

// Seed the fixture account + dependency chain, then write each entity via POST and
// GET it back via /api/state. Deep-equal catches any column that is present in the
// spec but not round-tripping correctly (NULL/optional handling, JSON encode/decode).
async function seedFixtureDeps(app: FastifyInstance) {
  expect((await post(app, "accounts", FIXTURE_ACCOUNT)).statusCode).toBe(201);
  expect((await post(app, "clients", FIXTURE_CLIENT)).statusCode).toBe(201);
  expect((await post(app, "disciplines", FIXTURE_DISCIPLINE)).statusCode).toBe(201);
  expect((await post(app, "projects", FIXTURE_PROJECT)).statusCode).toBe(201);
  expect((await post(app, "phases", FIXTURE_PHASE)).statusCode).toBe(201);
}

// Generic writes (POST/PUT/PATCH/batch) STRIP lifecycle tombstones (the P2.1 write guard in
// sanitizeWrite): only the dedicated archive/delete routes may set archivedAt/deletedAt. So a fixture
// round-tripped through POST comes back MINUS its tombstones — those columns' persistence is covered
// by app.lifecycle.test.ts (archive/delete → includeInactive read). Stripping them here keeps this
// column-spec-gap check honest for every OTHER field on clients/projects/resources.
function stripTombstones<T extends { archivedAt?: string; deletedAt?: string }>(fixture: T): T {
  const copy = { ...fixture };
  delete copy.archivedAt;
  delete copy.deletedAt;
  return copy;
}

function expectFixture(actual: object, expected: object) {
  expect(withoutRevision(actual)).toEqual(withoutRevision(expected));
  const revision = actual as { createdAt?: unknown; updatedAt?: unknown };
  expect(Date.parse(String(revision.createdAt))).not.toBeNaN();
  expect(Date.parse(String(revision.updatedAt))).not.toBeNaN();
}

describe("full-fixture round-trip (every optional field set; catches column-spec gaps)", () => {
  it("account: every field round-trips (including optional schedulingMode)", async () => {
    const { app } = freshApp();
    expect((await post(app, "accounts", FIXTURE_ACCOUNT)).statusCode).toBe(201);
    expectFixture(await readStateAccount(app), FIXTURE_ACCOUNT);
  });

  it("client: every field round-trips (lifecycle archivedAt/deletedAt stripped by generic writes)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    expect((await post(app, "clients", FIXTURE_CLIENT)).statusCode).toBe(201);
    expectFixture(readFirstClient((await readValidatedState(app)).clients), stripTombstones(FIXTURE_CLIENT));
  });

  it("discipline: every field round-trips (including optional color)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    expect((await post(app, "disciplines", FIXTURE_DISCIPLINE)).statusCode).toBe(201);
    expectFixture(readFirstDiscipline((await readValidatedState(app)).disciplines), FIXTURE_DISCIPLINE);
  });
});

describe("full-fixture round-trip (every optional field set; catches column-spec gaps)", () => {
  it("project: every field round-trips (lifecycle archivedAt/deletedAt stripped by generic writes)", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    await post(app, "clients", FIXTURE_CLIENT);
    expect((await post(app, "projects", FIXTURE_PROJECT)).statusCode).toBe(201);
    expectFixture(readFirstProject((await readValidatedState(app)).projects), stripTombstones(FIXTURE_PROJECT));
  });

  it("phase: every field round-trips", async () => {
    const { app } = freshApp();
    await post(app, "accounts", FIXTURE_ACCOUNT);
    await post(app, "clients", FIXTURE_CLIENT);
    await post(app, "projects", FIXTURE_PROJECT);
    expect((await post(app, "phases", FIXTURE_PHASE)).statusCode).toBe(201);
    expectFixture(readFirstPhase((await readValidatedState(app)).phases), FIXTURE_PHASE);
  });

  it("resource: every field round-trips (including optional name/disciplineId/projectId + json workingDays + lifecycle archivedAt/deletedAt)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "resources", FIXTURE_RESOURCE)).statusCode).toBe(201);
    expectFixture(readFirstResource((await readValidatedState(app)).resources), stripTombstones(FIXTURE_RESOURCE));
  });

  it("person resource: Supplementary engagement round-trips independently of employment", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    const supplementary = {
      ...person("supplementary-person", FIXTURE_ACCOUNT.id),
      name: "Fixture Supplementary Person",
      employmentType: "permanent" as const,
      engagement: "supplementary" as const,
    };

    expect((await post(app, "resources", supplementary)).statusCode).toBe(201);
    expect(readFirstResource((await readValidatedState(app)).resources)).toMatchObject({
      employmentType: "permanent",
      engagement: "supplementary",
    });
  });

  it("person resource: availability boundaries round-trip with all optional fields populated", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "resources", FIXTURE_RESOURCE_PERSON)).statusCode).toBe(201);
    expectFixture(
      readFirstResource((await readValidatedState(app)).resources),
      stripTombstones(FIXTURE_RESOURCE_PERSON),
    );
  });

  it("external resource: kind + company name round-trip (no discipline/project binding)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "resources", FIXTURE_RESOURCE_EXTERNAL)).statusCode).toBe(201);
    expectFixture(readFirstResource((await readValidatedState(app)).resources), FIXTURE_RESOURCE_EXTERNAL);
  });
});

describe("full-fixture round-trip (every optional field set; catches column-spec gaps)", () => {
  it("activity: every field round-trips (including optional projectId/phaseId)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "activities", FIXTURE_ACTIVITY)).statusCode).toBe(201);
    expectFixture(readFirstActivity((await readValidatedState(app)).activities), FIXTURE_ACTIVITY);
  });

  it("internal + repeatable activities round-trip with kind and no projectId/phaseId", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    expect((await post(app, "activities", FIXTURE_ACTIVITY_INTERNAL)).statusCode).toBe(201);
    expect((await post(app, "activities", FIXTURE_ACTIVITY_REPEATABLE)).statusCode).toBe(201);
    const activities = (await readValidatedState(app)).activities;
    const internalActivity = readActivity(activities, FIXTURE_ACTIVITY_INTERNAL.id);
    const repeatableActivity = readActivity(activities, FIXTURE_ACTIVITY_REPEATABLE.id);
    expect(activities).toHaveLength(2);
    expect(internalActivity.id).toBe(FIXTURE_ACTIVITY_INTERNAL.id);
    expect(repeatableActivity.id).toBe(FIXTURE_ACTIVITY_REPEATABLE.id);
    expect(internalActivity).not.toBe(repeatableActivity);

    expectFixture(internalActivity, FIXTURE_ACTIVITY_INTERNAL);
    expectFixture(repeatableActivity, FIXTURE_ACTIVITY_REPEATABLE);
  });

  it("allocation: every field round-trips (including optional project attribution)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    await post(app, "resources", FIXTURE_RESOURCE);
    await post(app, "activities", FIXTURE_ACTIVITY);
    await post(app, "activities", FIXTURE_ACTIVITY_REPEATABLE);
    expect((await post(app, "allocations", FIXTURE_ALLOCATION)).statusCode).toBe(201);
    expect((await post(app, "allocations", FIXTURE_ALLOCATION_ATTRIBUTED)).statusCode).toBe(201);
    const allocations = (await readValidatedState(app)).allocations;
    const allocationRow = readAllocation(allocations, FIXTURE_ALLOCATION.id);
    const attributedAllocation = readAllocation(allocations, FIXTURE_ALLOCATION_ATTRIBUTED.id);
    expect(allocations).toHaveLength(2);
    expect(allocationRow.id).toBe(FIXTURE_ALLOCATION.id);
    expect(attributedAllocation.id).toBe(FIXTURE_ALLOCATION_ATTRIBUTED.id);
    expect(allocationRow).not.toBe(attributedAllocation);

    expectFixture(allocationRow, FIXTURE_ALLOCATION);
    expectFixture(attributedAllocation, FIXTURE_ALLOCATION_ATTRIBUTED);
  });

  it("timeOff: every field round-trips (including optional note)", async () => {
    const { app } = freshApp();
    await seedFixtureDeps(app);
    await post(app, "resources", FIXTURE_RESOURCE);
    expect((await post(app, "timeOff", FIXTURE_TIMEOFF)).statusCode).toBe(201);
    expectFixture(readOnlyTimeOff((await readValidatedState(app)).timeOff), FIXTURE_TIMEOFF);
  });
});
