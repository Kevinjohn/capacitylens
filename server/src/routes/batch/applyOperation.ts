import { AccountContractError } from "@capacitylens/shared/account/errors";
import { buildInternalClient, isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { archive } from "@capacitylens/shared/domain/lifecycle";
import { type AppDataKey } from "@capacitylens/shared/types/entities";
import { deleteRow, getRow, upsertRow } from "../../db";
import { createServerRevision } from "../../revision";
import { isSameSessionSuccessor } from "../../syncOrdering";
import type { LifecycleRow } from "../../tenantStore";
import { listAppliedRequestedFieldNames, sanitizeWrite, assertValidWrite, ValidationError } from "../../validate";
import {
  resolveBuiltinWriteRejection,
  resolveGeneratedBuiltinReplacement,
  replaceGeneratedBuiltin,
  stampServerRevision,
} from "../../writePipeline";
import { ACCOUNT_FROZEN_FIELDS_MESSAGE, hasFrozenAccountFieldChanges } from "../accountEntityRoutes";
import { isLifecycleEntity, isScopedTable, isStaleWrite, ownsRow, writeActivityRow } from "../routeShared";

import { isMatchingMintedInternalClient } from "./appData";
import { StaleWriteError } from "./errors";
import { type ApplyBatchOperationParameters } from "./types";

type OperationParameters = Omit<ApplyBatchOperationParameters, "opIndex" | "op"> &
  Pick<ApplyBatchOperationParameters, "opIndex">;
type PutRowState = {
  table: string;
  id: string;
  row: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
};

// The batch's minted-Internal exception accepts only the canonical duplicate emitted beside an
// account create. It acknowledges the submitted operation without auditing a second state change.
function recordMintedInternalClient(
  parameters: OperationParameters,
  { table, id, row, existing }: PutRowState,
): boolean {
  const { mintedInternalIds, revisions, auditRecords, opIndex } = parameters;
  if (table !== "clients" || existing?.builtin !== true || !mintedInternalIds.has(id)) return false;
  if (!isMatchingMintedInternalClient(existing, row)) {
    throw new ValidationError("The same-batch built-in Internal client must match the generated server row.");
  }
  revisions.push({
    table,
    id,
    createdAt: existing.createdAt as string,
    updatedAt: existing.updatedAt as string,
  });
  // This submitted operation is acknowledged for sync/revision purposes, but
  // the preceding account create already minted the identical row. Do not
  // report or audit a second state change that never happened.
  if (auditRecords[opIndex]) auditRecords[opIndex] = null;
  return true;
}

// Ordered batches and optimistic generic writes use the direct PUT route's stale-write predicate.
// Throwing here aborts the whole transaction; the route maps the error to its redacted 409 shape.
function rejectStalePut(
  parameters: OperationParameters,
  state: Omit<PutRowState, "existing"> & { persistedExisting: Record<string, unknown> | undefined },
): void {
  const { optimisticConcurrency, syncOrder, db, redactWriteEcho, fieldVisFor } = parameters;
  const { table, id, row, persistedExisting } = state;
  if (!optimisticConcurrency && syncOrder === null) return;
  const staleWriteInput = { existing: persistedExisting, row };
  if (
    isStaleWrite(staleWriteInput) &&
    !(syncOrder && isSameSessionSuccessor({ db, order: syncOrder, table, id, current: staleWriteInput.existing }))
  ) {
    throw new StaleWriteError(
      redactWriteEcho(
        table,
        staleWriteInput.existing,
        fieldVisFor(table, table === "accounts" ? id : (row as { accountId?: unknown }).accountId),
      ),
    );
  }
}

// Validation runs against the projection after every preceding operation. Activity writes retain
// their project invariants, and account creation mints exactly one canonical Internal client.
function persistPut(
  parameters: OperationParameters,
  write: Omit<PutRowState, "row"> & { clean: Record<string, unknown> },
): void {
  const { db, state, projection, mintedInternalIds } = parameters;
  const { table, id, clean, existing } = write;
  const generatedReplacement = resolveGeneratedBuiltinReplacement(state, table, clean);
  if (generatedReplacement) {
    replaceGeneratedBuiltin({ db, state, generatedId: generatedReplacement, row: clean });
    projection.replaceGeneratedBuiltin(generatedReplacement, clean);
  } else {
    assertValidWrite({ state, table, row: clean, existing, lookup: projection });
    if (table === "activities") writeActivityRow({ db, projection, row: clean, existing });
    else {
      upsertRow(db, table, clean);
      projection.upsert(table as AppDataKey, clean);
    }
  }
  if (table !== "accounts" || existing) return;
  const internalClient = buildInternalClient(id, clean.createdAt as string) as unknown as Record<string, unknown>;
  upsertRow(db, "clients", internalClient);
  projection.upsert("clients", internalClient);
  mintedInternalIds.add(internalClient.id as string);
}

function readPutRow(op: ApplyBatchOperationParameters["op"]): Record<string, unknown> {
  const row = op.row;
  if (!row || typeof row !== "object" || (row as { id?: unknown }).id !== op.id) {
    throw new ValidationError("Each PUT op needs a row whose id matches the op id.");
  }
  return row;
}

function sanitizePut(parameters: OperationParameters, state: PutRowState): Record<string, unknown> {
  const { fieldVisFor } = parameters;
  const { table, id, row, existing } = state;
  const builtinRejection = resolveBuiltinWriteRejection({ verb: "replace", entity: table, existing, incoming: row });
  if (builtinRejection) throw new ValidationError(builtinRejection.error);
  if (!ownsRow(existing, (row as { accountId?: unknown }).accountId)) {
    throw new AccountContractError({ code: "NOT_FOUND", message: "Not found", retryable: false });
  }
  const sanitizedRow = sanitizeWrite({
    table,
    row,
    existing,
    options: fieldVisFor(table, table === "accounts" ? id : (row as { accountId?: unknown }).accountId),
  });
  if (table === "accounts" && hasFrozenAccountFieldChanges(existing, sanitizedRow)) {
    throw new AccountContractError({ code: "CONFLICT", message: ACCOUNT_FROZEN_FIELDS_MESSAGE, retryable: false });
  }
  return sanitizedRow;
}

// accountId is immutable (ownsRow), frozen account fields keep the direct route's 409 semantics,
// and sanitisation pins fields hidden from the writer before any state is changed.
function applyPut(parameters: OperationParameters, op: ApplyBatchOperationParameters["op"]): void {
  const { req, db, projection, revisions, auditRecords, multiAccount, projectedWorkspaceCount, accountFlows, opIndex } =
    parameters;
  const { table, id } = op;
  const row = readPutRow(op);
  const persistedExisting = getRow(db, table, id) ?? undefined;
  const existing =
    table === "allocations"
      ? (projection.row("allocations", id) as Record<string, unknown> | undefined)
      : persistedExisting;
  const rowState = { table, id, row, existing };
  if (recordMintedInternalClient(parameters, rowState)) return;
  const sanitizedRow = sanitizePut(parameters, rowState);
  rejectStalePut(parameters, { table, id, row, persistedExisting });
  const clean = stampServerRevision(sanitizedRow, existing);
  const auditRecord = auditRecords[opIndex];
  if (auditRecord) {
    auditRecord.changedFields = listAppliedRequestedFieldNames({ table, requested: row, existing, applied: clean });
  }
  if (table === "accounts" && !existing) {
    const accountActor = req.accountActor;
    if (!accountActor) throw new Error("Account creation requires an authorized account actor.");
    accountFlows.provisionWorkspaceInExistingTransaction({
      workspaceId: id,
      principalId: accountActor.principalId,
      joinedAt: clean.createdAt as string,
      multiWorkspace: multiAccount,
      projectedWorkspaceCount,
    });
  }
  persistPut(parameters, { table, id, clean, existing });
  revisions.push({ table, id, createdAt: clean.createdAt as string, updatedAt: clean.updatedAt as string });
}

// ARCHIVE uses the same ordered-write rejection and redacted current row as direct mutations.
function rejectStaleArchive(
  parameters: OperationParameters,
  op: ApplyBatchOperationParameters["op"],
  existing: Record<string, unknown>,
): void {
  const { db, syncOrder, redactWriteEcho, fieldVisFor } = parameters;
  const { table, id } = op;
  if (
    syncOrder &&
    isStaleWrite({ existing, row: { updatedAt: op.updatedAt } }) &&
    !isSameSessionSuccessor({ db, order: syncOrder, table, id, current: existing })
  ) {
    throw new StaleWriteError(redactWriteEcho(table, existing, fieldVisFor(table, op.accountId ?? id)));
  }
}

function recordExistingArchive(
  parameters: OperationParameters,
  archiveState: { table: string; id: string; existing: Record<string, unknown> },
): boolean {
  const { table, id, existing } = archiveState;
  if (existing.archivedAt == null && existing.deletedAt == null) return false;
  const { auditRecords, opIndex, lifecycleArchives } = parameters;
  if (auditRecords[opIndex]) auditRecords[opIndex] = null;
  lifecycleArchives.push({ table, id, archived: existing.archivedAt != null });
  return true;
}

function applyArchive(parameters: OperationParameters, op: ApplyBatchOperationParameters["op"]): void {
  const { db, store, projection, lifecycleArchives } = parameters;
  const { table, id } = op;
  if (!isLifecycleEntity(table)) throw new ValidationError("ARCHIVE is supported only for lifecycle entities.");
  const existing = getRow(db, table, id) ?? undefined;
  if (!ownsRow(existing, op.accountId)) {
    throw new AccountContractError({ code: "NOT_FOUND", message: "Not found", retryable: false });
  }
  if (!existing) {
    lifecycleArchives.push({ table, id, archived: false });
    return;
  }
  if (table === "clients" && isBuiltinClient(existing)) {
    throw new ValidationError("The built-in Internal client cannot be archived.");
  }
  rejectStaleArchive(parameters, op, existing);
  if (recordExistingArchive(parameters, { table, id, existing })) return;
  if (typeof op.accountId !== "string") throw new ValidationError("An ARCHIVE op needs a string accountId.");
  const now = createServerRevision(existing.updatedAt);
  const archived = { ...archive(existing as unknown as LifecycleRow, now), updatedAt: now };
  store.writeLifecycleRow(op.accountId, table, archived);
  projection.upsert(table, archived);
  lifecycleArchives.push({ table, id, archived: true });
}

function applyDelete(parameters: OperationParameters, op: ApplyBatchOperationParameters["op"]): void {
  const { db, projection, syncOrder, redactWriteEcho, fieldVisFor } = parameters;
  const { table, id } = op;
  if (table === "accounts") throw new ValidationError("Use the dedicated company deletion endpoint.");
  const existing = getRow(db, table, id) ?? undefined;
  // Scoped deletes assert ownership before stale-write evaluation, matching the direct route.
  if (isScopedTable(table)) {
    if (typeof op.accountId !== "string") {
      throw new ValidationError("accountId is required to delete a scoped record.");
    }
    if (!ownsRow(existing, op.accountId)) {
      throw new AccountContractError({ code: "NOT_FOUND", message: "Not found", retryable: false });
    }
  }
  if (syncOrder) {
    const staleWriteInput = { existing, row: { updatedAt: op.updatedAt } };
    if (
      isStaleWrite(staleWriteInput) &&
      !isSameSessionSuccessor({ db, order: syncOrder, table, id, current: staleWriteInput.existing })
    ) {
      throw new StaleWriteError(
        redactWriteEcho(table, staleWriteInput.existing, fieldVisFor(table, op.accountId ?? id)),
      );
    }
  }
  deleteRow(db, table, id);
  projection.delete(table as AppDataKey, id);
}

export function applyBatchOperation(parameters: ApplyBatchOperationParameters): void {
  const { opIndex, op, ...operationParameters } = parameters;
  const context = { ...operationParameters, opIndex };
  // Shape, method, known-table and id validation completed before authorization and before
  // opening this transaction. This dispatch owns only state-dependent validation and mutation.
  switch (op.method) {
    case "PUT":
      applyPut(context, op);
      return;
    case "ARCHIVE":
      applyArchive(context, op);
      return;
    case "DELETE":
      applyDelete(context, op);
      return;
  }
}
