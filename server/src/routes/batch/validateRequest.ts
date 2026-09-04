import { isBrowserSyncSessionId } from "@capacitylens/shared/account/validation";
import type { FastifyReply, FastifyRequest } from "fastify";
import { type SyncOrder } from "../../syncOrdering";
import { checkEntityWriteBody } from "../../writePipeline";
import { isKnownTable, isLifecycleEntity, isScopedTable } from "../routeShared";

import { MAX_BATCH_OPS, type BatchOp, type ParsedBatchRequest } from "./types";

export function validateBatchRequest(req: FastifyRequest, reply: FastifyReply): ParsedBatchRequest | null {
  const body = req.body as { ops?: unknown };
  if (!body || !Array.isArray(body.ops)) {
    reply.code(400).send({ error: "ops array is required" });
    return null;
  }
  const ops = body.ops as BatchOp[];
  const rawSyncSession = req.headers["x-capacitylens-sync-session"];
  const rawSyncSequence = req.headers["x-capacitylens-sync-sequence"];
  let syncOrder: SyncOrder | null = null;
  if (rawSyncSession !== undefined || rawSyncSequence !== undefined) {
    const sequence =
      typeof rawSyncSequence === "string" && /^[1-9]\d{0,15}$/.test(rawSyncSequence)
        ? Number(rawSyncSequence)
        : Number.NaN;
    if (!isBrowserSyncSessionId(rawSyncSession) || !Number.isSafeInteger(sequence)) {
      reply.code(400).send({ error: "Invalid browser sync ordering headers." });
      return null;
    }
    syncOrder = { sessionId: rawSyncSession, sequence };
  }
  // Ordered-op updatedAt guard shared by the PUT/DELETE/ARCHIVE branches of the pre-scan below —
  // a no-op unless this request carries sync ordering headers (closes over syncOrder above).
  const requireOrderedUpdatedAt = (value: unknown, verbLabel: string): { status: number; error: string } | null =>
    syncOrder && typeof value !== "string"
      ? { status: 400, error: `An ordered ${verbLabel} op needs a string updatedAt revision.` }
      : null;
  // MAX_BATCH_OPS (see its doc comment) bounds the per-operation multiplier; the initial
  // projection read still scales once with each affected account's slice.
  // Rejected before the pre-scan and transaction, so an over-cap batch does no per-op work.
  if (ops.length > MAX_BATCH_OPS) {
    reply.code(400).send({
      error: `A batch may contain at most ${MAX_BATCH_OPS} operations.`,
    });
    return null;
  }
  for (const rawOp of ops as unknown[]) {
    if (!rawOp || typeof rawOp !== "object" || Array.isArray(rawOp)) {
      reply.code(400).send({ error: "Each op must be an object." });
      return null;
    }
    const op = rawOp as Partial<BatchOp>;
    if (op.method !== "PUT" && op.method !== "DELETE" && op.method !== "ARCHIVE") {
      reply.code(400).send({ error: `Unknown op method: ${String(op.method)}` });
      return null;
    }
    if (typeof op.table !== "string" || !isKnownTable(op.table) || typeof op.id !== "string") {
      reply.code(400).send({ error: "Each op needs a known table and string id." });
      return null;
    }
    if (op.method === "PUT") {
      const rejection = checkEntityWriteBody("replace", op.table, op.row, op.id, isScopedTable(op.table));
      if (rejection) {
        reply.code(rejection.status).send({ error: rejection.error });
        return null;
      }
      const row = op.row as Record<string, unknown>;
      const orderedRejection = requireOrderedUpdatedAt(row.updatedAt, "PUT");
      if (orderedRejection) {
        reply.code(orderedRejection.status).send({ error: orderedRejection.error });
        return null;
      }
    } else if (op.method === "DELETE") {
      if (isLifecycleEntity(op.table)) {
        reply.code(400).send({
          error: "Use the dedicated lifecycle endpoints for lifecycle entities.",
        });
        return null;
      }
      if (op.table === "accounts") {
        reply.code(400).send({ error: "Use the dedicated company deletion endpoint." });
        return null;
      }
      if (isScopedTable(op.table) && typeof op.accountId !== "string") {
        reply.code(400).send({ error: "A scoped DELETE op needs a string accountId." });
        return null;
      }
      const orderedRejection = requireOrderedUpdatedAt(op.updatedAt, "DELETE");
      if (orderedRejection) {
        reply.code(orderedRejection.status).send({ error: orderedRejection.error });
        return null;
      }
    } else {
      if (!isLifecycleEntity(op.table)) {
        reply.code(400).send({ error: "ARCHIVE is supported only for lifecycle entities." });
        return null;
      }
      if (typeof op.accountId !== "string") {
        reply.code(400).send({ error: "An ARCHIVE op needs a string accountId." });
        return null;
      }
      const orderedRejection = requireOrderedUpdatedAt(op.updatedAt, "ARCHIVE");
      if (orderedRejection) {
        reply.code(orderedRejection.status).send({ error: orderedRejection.error });
        return null;
      }
    }
  }
  return { ops, syncOrder };
}
