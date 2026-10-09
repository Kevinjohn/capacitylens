import { isBrowserSyncSessionId } from "@capacitylens/shared/account/validation";
import type { FastifyRequest } from "fastify";
import type { SyncOrder } from "../../syncOrdering";
import { checkEntityWriteBody } from "../../writePipeline";
import type { WriteRejection } from "../../writePipeline";
import {
  buildBatchTooLargeMessage,
  buildOrderedRevisionMessage,
  buildUnknownOpMethodMessage,
  REPLY_ERRORS,
} from "../replyErrors";
import { isKnownTable, isLifecycleEntity, isScopedTable } from "../routeShared";
import type { ParseResult } from "../routeShared";

import { MAX_BATCH_OPS } from "./types";
import type { BatchOp, ParsedBatchRequest } from "./types";
import { isRecord } from "@capacitylens/shared/lib/isRecord";

type BatchOperationResult = ParseResult<BatchOp, WriteRejection>;

function reject<T>(error: string): ParseResult<T, WriteRejection> {
  return { kind: "invalid", failure: { status: 400, error } };
}

function parseSyncOrder(headers: FastifyRequest["headers"]): ParseResult<SyncOrder | null, WriteRejection> {
  const sessionId = headers["x-capacitylens-sync-session"];
  const rawSequence = headers["x-capacitylens-sync-sequence"];
  if (sessionId === undefined && rawSequence === undefined) return { kind: "parsed", value: null };
  const sequence = typeof rawSequence === "string" && /^[1-9]\d{0,15}$/.test(rawSequence) ? Number(rawSequence) : NaN;
  if (!isBrowserSyncSessionId(sessionId) || !Number.isSafeInteger(sequence)) {
    return reject(REPLY_ERRORS.batchSyncHeadersInvalid);
  }
  return { kind: "parsed", value: { sessionId, sequence } };
}

function resolveOrderedRevisionRejection(
  updatedAt: unknown,
  method: BatchOp["method"],
  syncOrder: SyncOrder | null,
): WriteRejection | null {
  if (syncOrder === null || typeof updatedAt === "string") return null;
  return { status: 400, error: buildOrderedRevisionMessage(method) };
}

function parsePutOperation(rawOp: Record<string, unknown>, syncOrder: SyncOrder | null): BatchOperationResult {
  const { table, id, row } = rawOp;
  if (typeof table !== "string" || !isKnownTable(table) || typeof id !== "string") {
    return reject(REPLY_ERRORS.batchOpTarget);
  }
  const rejection = checkEntityWriteBody({
    verb: "replace",
    entity: table,
    body: row,
    urlId: id,
    scoped: isScopedTable(table),
  });
  if (rejection) return { kind: "invalid", failure: rejection };
  if (!isRecord(row)) return reject(REPLY_ERRORS.batchPutRowRequired);
  const revisionRejection = resolveOrderedRevisionRejection(row.updatedAt, "PUT", syncOrder);
  if (revisionRejection) return { kind: "invalid", failure: revisionRejection };
  return { kind: "parsed", value: { method: "PUT", table, id, row } };
}

function parseDeleteOperation(rawOp: Record<string, unknown>, syncOrder: SyncOrder | null): BatchOperationResult {
  const { table, id, accountId, updatedAt } = rawOp;
  if (typeof table !== "string" || !isKnownTable(table) || typeof id !== "string") {
    return reject(REPLY_ERRORS.batchOpTarget);
  }
  if (isLifecycleEntity(table)) return reject(REPLY_ERRORS.batchDeleteLifecycle);
  if (table === "accounts") return reject(REPLY_ERRORS.batchDeleteAccount);
  if (isScopedTable(table) && typeof accountId !== "string") {
    return reject(REPLY_ERRORS.batchDeleteAccountId);
  }
  const revisionRejection = resolveOrderedRevisionRejection(updatedAt, "DELETE", syncOrder);
  if (revisionRejection) return { kind: "invalid", failure: revisionRejection };
  return {
    kind: "parsed",
    value: {
      method: "DELETE",
      table,
      id,
      ...(typeof accountId === "string" ? { accountId } : {}),
      ...(typeof updatedAt === "string" ? { updatedAt } : {}),
    },
  };
}

function parseArchiveOperation(rawOp: Record<string, unknown>, syncOrder: SyncOrder | null): BatchOperationResult {
  const { table, id, accountId, updatedAt } = rawOp;
  if (typeof table !== "string" || !isKnownTable(table) || typeof id !== "string") {
    return reject(REPLY_ERRORS.batchOpTarget);
  }
  if (!isLifecycleEntity(table)) return reject(REPLY_ERRORS.batchArchiveNotLifecycle);
  if (typeof accountId !== "string") return reject(REPLY_ERRORS.batchArchiveAccountId);
  const revisionRejection = resolveOrderedRevisionRejection(updatedAt, "ARCHIVE", syncOrder);
  if (revisionRejection) return { kind: "invalid", failure: revisionRejection };
  return {
    kind: "parsed",
    value: {
      method: "ARCHIVE",
      table,
      id,
      accountId,
      ...(typeof updatedAt === "string" ? { updatedAt } : {}),
    },
  };
}

function parseBatchOperation(rawOp: unknown, syncOrder: SyncOrder | null): BatchOperationResult {
  if (!isRecord(rawOp)) {
    return reject(REPLY_ERRORS.batchOpNotObject);
  }
  if (rawOp.method === "PUT") return parsePutOperation(rawOp, syncOrder);
  if (rawOp.method === "DELETE") return parseDeleteOperation(rawOp, syncOrder);
  if (rawOp.method === "ARCHIVE") return parseArchiveOperation(rawOp, syncOrder);
  return reject(buildUnknownOpMethodMessage(rawOp.method));
}

/** Parse and validate one atomic batch request before authorization or transaction work begins. */
export function parseBatchRequest(req: FastifyRequest): ParseResult<ParsedBatchRequest, WriteRejection> {
  const body = req.body;
  if (body === null || typeof body !== "object" || !("ops" in body) || !Array.isArray(body.ops)) {
    return reject(REPLY_ERRORS.batchOpsRequired);
  }
  const syncOrderResult = parseSyncOrder(req.headers);
  if (syncOrderResult.kind === "invalid") return syncOrderResult;
  if (body.ops.length > MAX_BATCH_OPS) return reject(buildBatchTooLargeMessage(MAX_BATCH_OPS));
  const ops: BatchOp[] = [];
  for (const rawOp of body.ops) {
    const result = parseBatchOperation(rawOp, syncOrderResult.value);
    if (result.kind === "invalid") return result;
    ops.push(result.value);
  }
  return { kind: "parsed", value: { ops, syncOrder: syncOrderResult.value } };
}
