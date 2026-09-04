import { AccountContractError } from "@capacitylens/shared/account/errors";
import { buildInternalClient, isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import { archive } from "@capacitylens/shared/domain/lifecycle";
import { type AppDataKey } from "@capacitylens/shared/types/entities";
import { deleteRow, getRow, upsertRow } from "../../db";
import { nextServerRevision } from "../../revision";
import { isSameSessionSuccessor } from "../../syncOrdering";
import type { LifecycleRow } from "../../tenantStore";
import { appliedRequestedFieldNames, sanitizeWrite, validateWrite, ValidationError } from "../../validate";
import {
  builtinInternalWriteGuard,
  generatedBuiltinReplacement,
  replaceGeneratedBuiltin,
  stampServerRevision,
} from "../../writePipeline";
import { ACCOUNT_FROZEN_FIELDS_MESSAGE, accountFieldsFrozen } from "../accountEntityRoutes";
import { isLifecycleEntity, isScopedTable, isStaleWrite, ownsRow, writeActivityRow } from "../routeShared";

import { matchesMintedInternalClient } from "./appData";
import { StaleWriteError } from "./errors";
import { type ApplyBatchOperationParameters } from "./types";

export function applyBatchOperation(parameters: ApplyBatchOperationParameters): void {
  const {
    opIndex,
    op,
    req,
    db,
    store,
    state,
    projection,
    mintedInternalIds,
    revisions,
    auditRecords,
    lifecycleArchives,
    syncOrder,
    optimisticConcurrency,
    multiAccount,
    projectedWorkspaceCount,
    accountFlows,
    fieldVisFor,
    redactWriteEcho,
  } = parameters;
  const { method, table, id } = op;
  // Shape, method, known-table and id validation completed before authorization and before
  // opening this transaction. This loop owns only state-dependent validation and mutation.
  if (method === "PUT") {
    const row = op.row;
    if (!row || typeof row !== "object" || (row as { id?: unknown }).id !== id) {
      throw new ValidationError("Each PUT op needs a row whose id matches the op id.");
    }
    // accountId is immutable (ownsRow): a write must not re-home an existing row.
    const persistedExisting = getRow(db, table, id);
    const existing =
      table === "allocations"
        ? (projection.row("allocations", id) as Record<string, unknown> | undefined)
        : persistedExisting;
    // Built-in Internal guard (Finding 7 — ONE implementation). The batch's own minted-
    // Internal exception accepts only the canonical duplicate a client emitted alongside
    // the account create; malformed or re-homed bodies roll the whole batch back.
    if (table === "clients" && existing?.builtin === true && mintedInternalIds.has(id)) {
      if (!matchesMintedInternalClient(existing, row as Record<string, unknown>)) {
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
      if (auditRecords[opIndex]) {
        auditRecords[opIndex] = null;
      }
      return;
    }
    const builtinRejection = builtinInternalWriteGuard("replace", table, existing, row as Record<string, unknown>);
    if (builtinRejection) throw new ValidationError(builtinRejection.error);
    if (!ownsRow(existing, (row as { accountId?: unknown }).accountId)) {
      throw new AccountContractError({
        code: "NOT_FOUND",
        message: "Not found",
        retryable: false,
      });
    }
    const sanitizedRow = sanitizeWrite(
      table,
      row as Record<string, unknown>,
      existing,
      fieldVisFor(table, (row as { accountId?: unknown }).accountId),
    );
    // language/weekStartsOn/timezone are FROZEN after creation (P1.14). Match the
    // direct routes' 409 so the sync client takes its authoritative-reload path
    // instead of retrying the same state-dependent conflict indefinitely.
    if (table === "accounts" && accountFieldsFrozen(existing, sanitizedRow)) {
      throw new AccountContractError({
        code: "CONFLICT",
        message: ACCOUNT_FROZEN_FIELDS_MESSAGE,
        retryable: false,
      });
    }
    // Optimistic concurrency is default-on for generic writes and mandatory for an
    // ordered browser batch. The stale-write refusal is isStaleWrite, the SAME predicate
    // the direct PUT route runs, so the two paths can't drift. Thrown
    // (not replied) because we are inside tx(): the throw aborts the transaction, so
    // the WHOLE batch rolls back, and the catch below maps it to the direct route's
    // 409 + { current } shape.
    if (
      (optimisticConcurrency || syncOrder !== null) &&
      isStaleWrite(persistedExisting, row as Record<string, unknown>) &&
      !(syncOrder && isSameSessionSuccessor(db, syncOrder, table, id, persistedExisting))
    ) {
      // The 409's `current` payload is a READ of the stored row: redact the time-off
      // note for a note-blind writer, exactly like the write echo (P1.6) — the conflict
      // path must not hand an editor the very field readSlice redacts.
      throw new StaleWriteError(
        redactWriteEcho(table, persistedExisting, fieldVisFor(table, (row as { accountId?: unknown }).accountId)),
      );
    }
    // P1.6: pin the time-off `note` for a note-blind writer — the batch is the client's
    // REAL save path, so an editor's redacted round-trip lands here (see sanitizeWrite).
    const clean = stampServerRevision(sanitizedRow, existing);
    const auditRecord = auditRecords[opIndex];
    if (auditRecord) {
      auditRecord.changedFields = appliedRequestedFieldNames(table, row, existing, clean);
    }
    const generatedReplacement = generatedBuiltinReplacement(state, table, clean);
    if (table === "accounts" && !existing) {
      // Evaluate provisioning policy before inserting the account, against the final
      // count of the whole atomic batch. The surrounding application-wide lock is shared
      // with /api/orgs; any later storage failure rolls this membership write back.
      accountFlows.provisionWorkspaceInExistingTransaction({
        workspaceId: id,
        principalId: req.accountActor!.principalId,
        joinedAt: clean.createdAt as string,
        multiWorkspace: multiAccount,
        projectedWorkspaceCount,
      });
    }
    if (generatedReplacement) {
      replaceGeneratedBuiltin(db, state, generatedReplacement, clean);
      projection.replaceGeneratedBuiltin(generatedReplacement, clean);
    } else {
      validateWrite(state, table, clean, existing, projection);
      if (table === "activities") {
        writeActivityRow(db, projection, clean, existing);
      } else {
        upsertRow(db, table, clean);
        projection.upsert(table as AppDataKey, clean);
      }
    }
    if (table === "accounts" && !existing) {
      const internalClient = buildInternalClient(id, clean.createdAt as string) as unknown as Record<string, unknown>;
      upsertRow(db, "clients", internalClient);
      projection.upsert("clients", internalClient);
      mintedInternalIds.add(internalClient.id as string);
    }
    revisions.push({
      table,
      id,
      createdAt: clean.createdAt as string,
      updatedAt: clean.updatedAt as string,
    });
  } else if (method === "ARCHIVE") {
    if (!isLifecycleEntity(table)) {
      throw new ValidationError("ARCHIVE is supported only for lifecycle entities.");
    }
    const existing = getRow(db, table, id);
    if (!ownsRow(existing, op.accountId)) {
      throw new AccountContractError({
        code: "NOT_FOUND",
        message: "Not found",
        retryable: false,
      });
    }
    if (!existing) {
      lifecycleArchives.push({ table, id, archived: false });
      return;
    }
    if (table === "clients" && isBuiltinClient(existing as never)) {
      throw new ValidationError("The built-in Internal client cannot be archived.");
    }
    if (
      syncOrder &&
      isStaleWrite(existing, { updatedAt: op.updatedAt }) &&
      !isSameSessionSuccessor(db, syncOrder, table, id, existing)
    ) {
      throw new StaleWriteError(redactWriteEcho(table, existing, fieldVisFor(table, op.accountId ?? id)));
    }
    if (existing.archivedAt != null || existing.deletedAt != null) {
      if (auditRecords[opIndex]) {
        auditRecords[opIndex] = null;
      }
      lifecycleArchives.push({ table, id, archived: existing.archivedAt != null });
      return;
    }
    const now = nextServerRevision(existing.updatedAt);
    const archived = {
      ...archive(existing as unknown as LifecycleRow, now),
      updatedAt: now,
    };
    store.writeLifecycleRow(op.accountId!, table, archived);
    projection.upsert(table as AppDataKey, archived as unknown as Record<string, unknown>);
    lifecycleArchives.push({ table, id, archived: true });
  } else if (method === "DELETE") {
    if (table === "accounts") {
      throw new ValidationError("Use the dedicated company deletion endpoint.");
    }
    const existing = getRow(db, table, id);
    // Scoped deletes assert ownership (same rule as the DELETE route).
    if (isScopedTable(table)) {
      if (typeof op.accountId !== "string") {
        throw new ValidationError("accountId is required to delete a scoped record.");
      }
      if (!ownsRow(existing, op.accountId)) {
        throw new AccountContractError({
          code: "NOT_FOUND",
          message: "Not found",
          retryable: false,
        });
      }
    }
    if (
      syncOrder &&
      isStaleWrite(existing, { updatedAt: op.updatedAt }) &&
      !isSameSessionSuccessor(db, syncOrder, table, id, existing)
    ) {
      throw new StaleWriteError(redactWriteEcho(table, existing, fieldVisFor(table, op.accountId ?? id)));
    }
    deleteRow(db, table, id);
    projection.delete(table as AppDataKey, id);
  } else {
    throw new ValidationError(`Unknown op method: ${String(method)}`);
  }
}
