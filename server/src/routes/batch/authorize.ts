import type { Action } from "@capacitylens/shared/domain/access";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthMode } from "../../auth";
import { getRow, type Db } from "../../db";
import { ACCOUNT_CREATE_CLOSED_MESSAGE, countAccounts } from "../accountEntityRoutes";
import { isScopedTable } from "../routeShared";

import type { BatchRouteDependencies } from "../batchRoutes";
import { type BatchOp } from "./types";

/** Project the final top-level account count for an already shape-validated batch. */
export function projectBatchAccounts(db: Db, ops: BatchOp[]): { count: number; createsFinalAccount: boolean } {
  let count = countAccounts(db);
  const originalExistence = new Map<string, boolean>();
  const projectedExistence = new Map<string, boolean>();
  for (const op of ops) {
    if (op.table !== "accounts") continue;
    let exists = projectedExistence.get(op.id);
    if (exists === undefined) {
      exists = Boolean(getRow(db, "accounts", op.id));
      originalExistence.set(op.id, exists);
    }
    if (op.method === "PUT" && !exists) count += 1;
    if (op.method === "DELETE" && exists) count -= 1;
    projectedExistence.set(op.id, op.method === "PUT");
  }
  return {
    count,
    createsFinalAccount: [...projectedExistence].some(([id, exists]) => exists && originalExistence.get(id) === false),
  };
}

export function authorizeBatchOperations(parameters: {
  ops: BatchOp[];
  db: Db;
  authMode: AuthMode;
  req: FastifyRequest;
  reply: FastifyReply;
  authorize: BatchRouteDependencies["authorize"];
}): boolean {
  const { ops, db, authMode, req, reply, authorize } = parameters;
  // This function is invoked once before waiting for workspace locks and again after lock
  // acquisition. Keep the cache local so those remain independent authorization snapshots,
  // while repeated operations for the same account/action do not repeat the identical
  // membership query within either snapshot. Only successful checks are cached; a denial
  // sends its response and ends the pass immediately.
  const authorizedActions = new Map<string, Set<Action>>();
  const authorizeOnce = (accountId: string, action: Action): boolean => {
    const actions = authorizedActions.get(accountId);
    if (actions?.has(action)) return true;
    if (!authorize(req, reply, accountId, action)) return false;
    if (actions) actions.add(action);
    else authorizedActions.set(accountId, new Set([action]));
    return true;
  };

  for (const op of ops) {
    if (op?.table === "accounts" && op.method === "PUT") {
      const existingAccount = getRow(db, "accounts", op.id);
      if (existingAccount) {
        if (!authorizeOnce(op.id, "write")) return false;
      } else if (authMode !== "off") {
        reply.code(403).send({ error: ACCOUNT_CREATE_CLOSED_MESSAGE });
        return false;
      }
      // OFF-mode creates are checked against the projected final set and rechecked by the
      // provisioning policy inside the transaction.
      continue;
    }
    if (!isScopedTable(op.table)) {
      reply.code(403).send({
        error: "No batch-write policy is defined for this entity.",
      });
      return false;
    }
    const accountId = op.method === "PUT" ? (op.row as { accountId?: string } | undefined)?.accountId : op.accountId;
    const action: Action =
      op.method === "PUT" && op.table === "clients" && (op.row as { builtin?: unknown } | undefined)?.builtin === true
        ? "manageInternalClient"
        : "write";
    if (!authorizeOnce(accountId as string, action)) return false;
  }
  return true;
}
