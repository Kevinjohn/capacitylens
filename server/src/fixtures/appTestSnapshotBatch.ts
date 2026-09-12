import { expect } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { call } from "./appTestHttp";
import {
  isUnknownRecord,
  readOptionalBoolean,
  readOptionalString,
  readRequiredBoolean,
  readRequiredNumber,
  readRequiredString,
  readStateArray,
  requireModeledKeys,
  type ActivitySnapshot,
  type ActivityWriteResponse,
  type BatchReceipt,
  type BatchRevisionSnapshot,
  type ClientResponse,
  type ClientSnapshot,
  type ImportSummary,
  type ProjectBinding,
  type ValidatedStateResponse,
} from "./appTestSnapshotCore";
import {
  readAccountSnapshots,
  readClosureSnapshots,
  readResourceSnapshots,
  readTimeOffSnapshots,
} from "./appTestSnapshotAccount";
import {
  readActivitySnapshots,
  readAllocationSnapshots,
  readDisciplineSnapshots,
  readPhaseSnapshots,
  readProjectSnapshots,
} from "./appTestSnapshotSchedule";
export function readAllClientSnapshots(rows: unknown[]): ClientSnapshot[] {
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

export function readClientSnapshots(rows: unknown[]): ClientSnapshot[] {
  return readAllClientSnapshots(rows).filter((clientRow) => clientRow.builtin !== true);
}

export function readAllStateClients(response: LightMyRequestResponse): ClientSnapshot[] {
  const value: unknown = response.json();
  if (!isUnknownRecord(value)) throw new Error("Expected the state response to be an object.");
  return readAllClientSnapshots(readStateArray(value, "clients"));
}

export function readFirstClient(clients: ClientSnapshot[]): ClientSnapshot {
  const clientRow = clients[0];
  if (!clientRow) throw new Error("Expected the state response to contain a client.");
  return clientRow;
}

export function readFirstClientName(clients: ClientSnapshot[]): string {
  return readFirstClient(clients).name;
}

export function readClientIds(clients: ClientSnapshot[]): string[] {
  return clients.map(({ id }) => id);
}

export function readClientResponseValue(value: unknown): ClientResponse {
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

export function readClientResponse(response: LightMyRequestResponse): ClientResponse {
  return readClientResponseValue(response.json());
}

export interface ConflictResponse {
  error: string;
  current: ClientResponse;
}

export function readConflictResponse(response: LightMyRequestResponse): ConflictResponse {
  const value: unknown = response.json();
  if (!isUnknownRecord(value) || typeof value.error !== "string" || !("current" in value)) {
    throw new Error("Expected a conflict response with an error and current row.");
  }
  return { error: value.error, current: readClientResponseValue(value.current) };
}

export function readBatchSuperseded(response: LightMyRequestResponse): boolean | undefined {
  const value: unknown = response.json();
  if (!isUnknownRecord(value)) throw new Error("Expected the batch response to be an object.");
  if (!("superseded" in value)) return undefined;
  if (typeof value.superseded !== "boolean") {
    throw new Error("Expected a present batch superseded field to be boolean.");
  }
  return value.superseded;
}

export function readBatchReceipt(response: LightMyRequestResponse): BatchReceipt {
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

export function readActivityWriteResponse(response: LightMyRequestResponse): ActivityWriteResponse {
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

export function readProjectId(rows: ProjectBinding[], id: string): string | undefined {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Expected the state response to contain row ${id}.`);
  return row.projectId;
}

export function readFirstProjectId(rows: ProjectBinding[]): string | undefined {
  const row = rows[0];
  if (!row) throw new Error("Expected the state response to contain a project-bound row.");
  return row.projectId;
}

export function readValidatedStateValue(value: unknown): ValidatedStateResponse {
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

/** Fetch and validate the whole state document. This lives beside its validator rather than in
 *  `appTestHttp`, which would otherwise have to import from here and close an import cycle. */
export const state = async (app: FastifyInstance) => {
  // Generic account creation now guarantees its required Internal client. Most legacy CRUD tests
  // predate that invariant and reason about the regular clients they explicitly create. The exact
  // state validator retains that view by filtering rows whose validated builtin flag is true.
  return readValidatedStateValue((await call(app, { method: "GET", url: "/api/state" })).json());
};

export function readSuccessfulStateResponse(response: LightMyRequestResponse): {
  state: ValidatedStateResponse;
  value: unknown;
} {
  expect(response.statusCode).toBe(200);
  const value: unknown = response.json();
  return { state: readValidatedStateValue(value), value };
}

export function readStateResponse(response: LightMyRequestResponse): ValidatedStateResponse {
  return readValidatedStateValue(response.json());
}

export function readImportSummary(response: LightMyRequestResponse): ImportSummary {
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

export async function readValidatedState(app: FastifyInstance): Promise<ValidatedStateResponse> {
  return readValidatedStateValue((await call(app, { method: "GET", url: "/api/state" })).json());
}

export async function readStateClients(app: FastifyInstance): Promise<ClientSnapshot[]> {
  return (await readValidatedState(app)).clients;
}
