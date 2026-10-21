import { expect } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { call } from "./appTestHttp";
import {
  readOptionalBoolean,
  readOptionalString,
  readRequiredBoolean,
  readRequiredNumber,
  readRequiredString,
  readStateArray,
  assertModeledKeys,
} from "./appTestSnapshotCore";
import type {
  ActivitySnapshot,
  ActivityWriteResponse,
  BatchReceipt,
  BatchRevisionSnapshot,
  ClientResponse,
  ClientSnapshot,
  ImportSummary,
  ProjectBinding,
  ValidatedStateResponse,
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
import { isRecord } from "@capacitylens/shared/lib/isRecord";
/**
 * Validates each client row against the API response fields, including optional archive and privacy metadata.
 *
 * @throws When a row is not an object or a modeled field is invalid.
 */
export function readAllClientSnapshots(rows: unknown[]): ClientSnapshot[] {
  return rows.map((row) => {
    if (!isRecord(row)) throw new Error("Expected every client row to be an object.");
    assertModeledKeys(
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

/**
 * Returns the validated client rows after excluding built-in entries.
 *
 * @throws When any client row is malformed.
 */
export function readClientSnapshots(rows: unknown[]): ClientSnapshot[] {
  return readAllClientSnapshots(rows).filter((clientRow) => clientRow.builtin !== true);
}

/**
 * Extracts and validates the clients array from a state response.
 *
 * @throws When the response body or client rows are malformed.
 */
export function readAllStateClients(response: LightMyRequestResponse): ClientSnapshot[] {
  const value: unknown = response.json();
  if (!isRecord(value)) throw new Error("Expected the state response to be an object.");
  return readAllClientSnapshots(readStateArray(value, "clients"));
}

/**
 * Returns the first client or throws when the state contains none.
 *
 * @throws When the array contains no client.
 */
export function readFirstClient(clients: ClientSnapshot[]): ClientSnapshot {
  const clientRow = clients[0];
  if (!clientRow) throw new Error("Expected the state response to contain a client.");
  return clientRow;
}

/**
 * Returns the name of the first validated client.
 *
 * @throws When the array contains no client.
 */
export function readFirstClientName(clients: ClientSnapshot[]): string {
  return readFirstClient(clients).name;
}

/**
 * Projects client IDs from the supplied snapshots in response order.
 */
export function readClientIds(clients: ClientSnapshot[]): string[] {
  return clients.map(({ id }) => id);
}

/**
 * Validates the required fields of a client write response.
 *
 * @throws When the response object or any required field is invalid.
 */
export function readClientResponseValue(value: unknown): ClientResponse {
  if (!isRecord(value)) throw new Error("Expected the client response to be an object.");
  return {
    accountId: readRequiredString(value, "accountId", "client response"),
    color: readRequiredString(value, "color", "client response"),
    createdAt: readRequiredString(value, "createdAt", "client response"),
    id: readRequiredString(value, "id", "client response"),
    name: readRequiredString(value, "name", "client response"),
    updatedAt: readRequiredString(value, "updatedAt", "client response"),
  };
}

/**
 * Parses the response body and validates it as a client write result.
 *
 * @throws When the response body or any required field is invalid.
 */
export function readClientResponse(response: LightMyRequestResponse): ClientResponse {
  return readClientResponseValue(response.json());
}

/**
 * Represents a client conflict response containing the current row and server message.
 */
export interface ConflictResponse {
  error: string;
  current: ClientResponse;
}

/**
 * Requires a conflict message and validates the current client row returned by the API.
 *
 * @throws When the conflict envelope or current client row is malformed.
 */
export function readConflictResponse(response: LightMyRequestResponse): ConflictResponse {
  const value: unknown = response.json();
  if (!isRecord(value) || typeof value.error !== "string" || !("current" in value)) {
    throw new Error("Expected a conflict response with an error and current row.");
  }
  return { error: value.error, current: readClientResponseValue(value.current) };
}

/**
 * Reads the optional superseded flag and rejects a present non-boolean value.
 *
 * @throws When the response body is not an object or the flag is not boolean.
 */
export function readBatchSuperseded(response: LightMyRequestResponse): boolean | undefined {
  const value: unknown = response.json();
  if (!isRecord(value)) throw new Error("Expected the batch response to be an object.");
  if (!("superseded" in value)) return undefined;
  if (typeof value.superseded !== "boolean") {
    throw new Error("Expected a present batch superseded field to be boolean.");
  }
  return value.superseded;
}

/**
 * Validates batch counts, archive records, revision records, and the optional superseded flag.
 *
 * @throws When the response envelope, counts, or nested records are malformed.
 */
export function readBatchReceipt(response: LightMyRequestResponse): BatchReceipt {
  const value: unknown = response.json();
  if (!isRecord(value)) throw new Error("Expected the batch response to be an object.");
  assertModeledKeys(
    value,
    ["applied", "archives", "auditWarning", "changed", "ok", "revisions", "superseded"],
    "batch response",
  );
  const revisions = readStateArray(value, "revisions").map((revision) => {
    if (!isRecord(revision)) throw new Error("Expected every batch revision to be an object.");
    assertModeledKeys(revision, ["createdAt", "id", "rewrite", "table", "updatedAt"], "batch revision");
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
    if (!isRecord(archive)) throw new Error("Expected every batch archive to be an object.");
    assertModeledKeys(archive, ["archived", "id", "table"], "batch archive");
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

/**
 * Validates an activity write result, including its project links and rewritten allocation revisions.
 *
 * @throws When the response envelope or any modeled field is invalid.
 */
export function readActivityWriteResponse(response: LightMyRequestResponse): ActivityWriteResponse {
  const value: unknown = response.json();
  if (!isRecord(value)) throw new Error("Expected the activity response to be an object.");
  assertModeledKeys(
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
    if (!isRecord(revision)) throw new Error("Expected every rewritten allocation to be an object.");
    assertModeledKeys(revision, ["createdAt", "id", "updatedAt"], "rewritten allocation");
    return {
      createdAt: readRequiredString(revision, "createdAt", "rewritten allocation"),
      id: readRequiredString(revision, "id", "rewritten allocation"),
      updatedAt: readRequiredString(revision, "updatedAt", "rewritten allocation"),
    };
  });
  return { ...activity, rewrittenAllocations };
}

/**
 * Returns a row's optional project attribution.
 *
 * @throws When no row has the requested ID.
 */
export function readProjectId(rows: ProjectBinding[], id: string): string | undefined {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`Expected the state response to contain row ${id}.`);
  return row.projectId;
}

/**
 * Returns the first row's optional project attribution.
 *
 * @throws When the array is empty.
 */
export function readFirstProjectId(rows: ProjectBinding[]): string | undefined {
  const row = rows[0];
  if (!row) throw new Error("Expected the state response to contain a project-bound row.");
  return row.projectId;
}

/**
 * Validates the modeled entities and fields in an untrusted state payload.
 *
 * @throws When the response object, entity arrays, or modeled fields are invalid.
 */
export function readValidatedStateValue(value: unknown): ValidatedStateResponse {
  if (!isRecord(value)) {
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

/** Fetch and validate the whole state document.
 * It lives beside its validator to avoid an import cycle with `appTestHttp`.
 *
 * @throws When the request fails or the state response is malformed.
 */
export const state = async (app: FastifyInstance) => {
  // Exclude the built-in Internal client so CRUD assertions cover user-created clients.
  return readValidatedStateValue((await call(app, { method: "GET", url: "/api/state" })).json());
};

/**
 * Requires a successful state response and validates its projected fields.
 *
 * @throws When the status is not 200 or the state payload is malformed.
 */
export function readSuccessfulStateResponse(response: LightMyRequestResponse): {
  state: ValidatedStateResponse;
  value: unknown;
} {
  expect(response.statusCode).toBe(200);
  const value: unknown = response.json();
  return { state: readValidatedStateValue(value), value };
}

/**
 * Validates the API state response envelope and its modeled entity arrays.
 *
 * @throws When the response body or any modeled entity is malformed.
 */
export function readStateResponse(response: LightMyRequestResponse): ValidatedStateResponse {
  return readValidatedStateValue(response.json());
}

/**
 * Extracts and validates the summary returned after an import.
 *
 * @throws When the response summary or any required field is invalid.
 */
export function readImportSummary(response: LightMyRequestResponse): ImportSummary {
  const value: unknown = response.json();
  if (!isRecord(value)) throw new Error("Expected the import response to be an object.");
  assertModeledKeys(value, ["auditWarning", "imported", "maxRecords", "skipped"], "import response");
  const auditWarning = value.auditWarning;
  if (typeof auditWarning !== "boolean") throw new Error("Expected import response auditWarning to be boolean.");
  return {
    auditWarning,
    imported: readRequiredNumber(value, "imported", "import response"),
    maxRecords: readRequiredNumber(value, "maxRecords", "import response"),
    skipped: readRequiredNumber(value, "skipped", "import response"),
  };
}

/**
 * Fetches the state endpoint and validates its response before returning the snapshot.
 *
 * @throws When the request fails or the state response is malformed.
 */
export async function readValidatedState(app: FastifyInstance): Promise<ValidatedStateResponse> {
  return readValidatedStateValue((await call(app, { method: "GET", url: "/api/state" })).json());
}

/**
 * Reads client snapshots from a validated state value.
 *
 * @throws When the request fails or the state response is malformed.
 */
export async function readStateClients(app: FastifyInstance): Promise<ClientSnapshot[]> {
  return (await readValidatedState(app)).clients;
}
