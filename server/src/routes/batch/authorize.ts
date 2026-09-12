import type { Action } from "@capacitylens/shared/domain/access";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AccountMode } from "../../auth";
import { getRow, type Db } from "../../db";
import { ACCOUNT_CREATE_CLOSED_MESSAGE, countAccounts } from "../accountEntityRoutes";
import { isScopedTable, NO_REPROMPT } from "../routeShared";

import type { BatchRouteDependencies } from "../batchRoutes";
import { type BatchOp } from "./types";

interface AuthorizeBatchOperationsInput {
  ops: BatchOp[];
  db: Db;
  authMode: AccountMode;
  req: FastifyRequest;
  reply: FastifyReply;
  authorize: BatchRouteDependencies["authorize"];
}

interface CreateBatchAuthorizerInput {
  req: FastifyRequest;
  reply: FastifyReply;
  authorize: BatchRouteDependencies["authorize"];
}

interface AuthorizeAccountPutInput {
  op: BatchOp;
  db: Db;
  authMode: AccountMode;
  reply: FastifyReply;
  authorizeOnce: (accountId: string, action: Action) => boolean;
}

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

function createBatchAuthorizer({
  req,
  reply,
  authorize,
}: CreateBatchAuthorizerInput): (accountId: string, action: Action) => boolean {
  const authorizedActions = new Map<string, Set<Action>>();
  return (accountId, action) => {
    const actions = authorizedActions.get(accountId);
    if (actions?.has(action)) return true;
    // Adopting a client as the internal one is an ordinary administrative action: role gating
    // stands, but it does not demand a recent sign-in. `write` is exempt from freshness anyway.
    const options = action === "manageInternalClient" ? NO_REPROMPT : undefined;
    if (!authorize({ req, reply, accountId, action, options })) return false;
    if (actions) actions.add(action);
    else authorizedActions.set(accountId, new Set([action]));
    return true;
  };
}

function readScopedAccountId(op: BatchOp): string {
  const accountId = op.method === "PUT" ? op.row?.accountId : op.accountId;
  if (typeof accountId !== "string") {
    throw new Error("A validated scoped batch operation requires an account ID.");
  }
  return accountId;
}

function resolveScopedAction(op: BatchOp): Action {
  return op.method === "PUT" && op.table === "clients" && op.row?.builtin === true ? "manageInternalClient" : "write";
}

function authorizeAccountPut(parameters: AuthorizeAccountPutInput): boolean {
  const { op, db, authMode, reply, authorizeOnce } = parameters;
  if (getRow(db, "accounts", op.id)) return authorizeOnce(op.id, "write");
  if (authMode === "off") return true;
  reply.code(403).send({ error: ACCOUNT_CREATE_CLOSED_MESSAGE });
  return false;
}

export function authorizeBatchOperations(parameters: AuthorizeBatchOperationsInput): boolean {
  const { ops, db, authMode, req, reply, authorize } = parameters;
  // This function is invoked once before waiting for workspace locks and again after lock
  // acquisition. Keep the cache local so those remain independent authorization snapshots,
  // while repeated operations for the same account/action do not repeat the identical
  // membership query within either snapshot. Only successful checks are cached; a denial
  // sends its response and ends the pass immediately.
  const authorizeOnce = createBatchAuthorizer({ req, reply, authorize });

  for (const op of ops) {
    if (op.table === "accounts" && op.method === "PUT") {
      if (!authorizeAccountPut({ op, db, authMode, reply, authorizeOnce })) return false;
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
    if (!authorizeOnce(readScopedAccountId(op), resolveScopedAction(op))) return false;
  }
  return true;
}
