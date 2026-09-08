import { isBrowserSyncSessionId } from "@capacitylens/shared/account/validation";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { SyncOrder } from "../../syncOrdering";
import { checkEntityWriteBody } from "../../writePipeline";
import type { WriteRejection } from "../../writePipeline";
import { isKnownTable, isLifecycleEntity, isScopedTable } from "../routeShared";

import { MAX_BATCH_OPS } from "./types";
import type { BatchOp, ParsedBatchRequest } from "./types";

type BatchOperationResult = { kind: "accepted"; op: BatchOp } | { kind: "rejected"; rejection: WriteRejection };
type SyncOrderResult = { kind: "accepted"; syncOrder: SyncOrder | null } | { kind: "rejected" };

function reject(error: string): BatchOperationResult {
  return { kind: "rejected", rejection: { status: 400, error } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseSyncOrder(headers: FastifyRequest["headers"]): SyncOrderResult {
  const sessionId = headers["x-capacitylens-sync-session"];
  const rawSequence = headers["x-capacitylens-sync-sequence"];
  if (sessionId === undefined && rawSequence === undefined) return { kind: "accepted", syncOrder: null };
  const sequence = typeof rawSequence === "string" && /^[1-9]\d{0,15}$/.test(rawSequence) ? Number(rawSequence) : NaN;
  if (!isBrowserSyncSessionId(sessionId) || !Number.isSafeInteger(sequence)) return { kind: "rejected" };
  return { kind: "accepted", syncOrder: { sessionId, sequence } };
}

function resolveOrderedRevisionRejection(
  updatedAt: unknown,
  method: BatchOp["method"],
  syncOrder: SyncOrder | null,
): WriteRejection | null {
  if (syncOrder === null || typeof updatedAt === "string") return null;
  return { status: 400, error: `An ordered ${method} op needs a string updatedAt revision.` };
}

function parsePutOperation(rawOp: Record<string, unknown>, syncOrder: SyncOrder | null): BatchOperationResult {
  const { table, id, row } = rawOp;
  if (typeof table !== "string" || !isKnownTable(table) || typeof id !== "string") {
    return reject("Each op needs a known table and string id.");
  }
  const rejection = checkEntityWriteBody({
    verb: "replace",
    entity: table,
    body: row,
    urlId: id,
    scoped: isScopedTable(table),
  });
  if (rejection) return { kind: "rejected", rejection };
  if (!isRecord(row)) return reject("A request body is required.");
  const revisionRejection = resolveOrderedRevisionRejection(row.updatedAt, "PUT", syncOrder);
  if (revisionRejection) return { kind: "rejected", rejection: revisionRejection };
  return { kind: "accepted", op: { method: "PUT", table, id, row } };
}

function parseDeleteOperation(rawOp: Record<string, unknown>, syncOrder: SyncOrder | null): BatchOperationResult {
  const { table, id, accountId, updatedAt } = rawOp;
  if (typeof table !== "string" || !isKnownTable(table) || typeof id !== "string") {
    return reject("Each op needs a known table and string id.");
  }
  if (isLifecycleEntity(table)) return reject("Use the dedicated lifecycle endpoints for lifecycle entities.");
  if (table === "accounts") return reject("Use the dedicated company deletion endpoint.");
  if (isScopedTable(table) && typeof accountId !== "string") {
    return reject("A scoped DELETE op needs a string accountId.");
  }
  const revisionRejection = resolveOrderedRevisionRejection(updatedAt, "DELETE", syncOrder);
  if (revisionRejection) return { kind: "rejected", rejection: revisionRejection };
  return {
    kind: "accepted",
    op: {
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
    return reject("Each op needs a known table and string id.");
  }
  if (!isLifecycleEntity(table)) return reject("ARCHIVE is supported only for lifecycle entities.");
  if (typeof accountId !== "string") return reject("An ARCHIVE op needs a string accountId.");
  const revisionRejection = resolveOrderedRevisionRejection(updatedAt, "ARCHIVE", syncOrder);
  if (revisionRejection) return { kind: "rejected", rejection: revisionRejection };
  return {
    kind: "accepted",
    op: {
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
    return reject("Each op must be an object.");
  }
  if (rawOp.method === "PUT") return parsePutOperation(rawOp, syncOrder);
  if (rawOp.method === "DELETE") return parseDeleteOperation(rawOp, syncOrder);
  if (rawOp.method === "ARCHIVE") return parseArchiveOperation(rawOp, syncOrder);
  return reject(`Unknown op method: ${String(rawOp.method)}`);
}

function sendRejection(reply: FastifyReply, rejection: WriteRejection): null {
  reply.code(rejection.status).send({ error: rejection.error });
  return null;
}

/** Parse and validate one atomic batch request before authorization or transaction work begins. */
export function parseBatchRequest(req: FastifyRequest, reply: FastifyReply): ParsedBatchRequest | null {
  const body = req.body;
  if (body === null || typeof body !== "object" || !("ops" in body) || !Array.isArray(body.ops)) {
    return sendRejection(reply, { status: 400, error: "ops array is required" });
  }
  const syncOrderResult = parseSyncOrder(req.headers);
  if (syncOrderResult.kind === "rejected") {
    return sendRejection(reply, { status: 400, error: "Invalid browser sync ordering headers." });
  }
  if (body.ops.length > MAX_BATCH_OPS) {
    return sendRejection(reply, {
      status: 400,
      error: `A batch may contain at most ${MAX_BATCH_OPS} operations.`,
    });
  }
  const ops: BatchOp[] = [];
  for (const rawOp of body.ops) {
    const result = parseBatchOperation(rawOp, syncOrderResult.syncOrder);
    if (result.kind === "rejected") return sendRejection(reply, result.rejection);
    ops.push(result.op);
  }
  return { ops, syncOrder: syncOrderResult.syncOrder };
}
