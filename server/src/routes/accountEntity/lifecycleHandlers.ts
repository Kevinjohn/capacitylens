import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditRecord } from "../../audit";
import { getRow, insertRow } from "../../db";
import { listAppliedRequestedFieldNames, assertValidWrite } from "../../validate";
import { checkEntityWriteBody, prepareScopedWrite } from "../../writePipeline";

import type { AccountEntityRouteDependencies } from "./dependencies";
import { sendAccountRouteFailure } from "./guards";
import { ACCOUNT_CREATE_CLOSED_MESSAGE, buildCanonicalAccountProductPayload } from "./policy";

function requireRequestContext(req: FastifyRequest) {
  if (!req.user || !req.accountActor) throw new Error("Authenticated request context is required.");
  return { user: req.user, actor: req.accountActor };
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireRequestRow(body: unknown): Record<string, unknown> {
  if (!isUnknownRecord(body)) {
    throw new Error("Validated account request body is unavailable.");
  }
  return body;
}

function requireRowString(row: Record<string, unknown>, field: "id" | "createdAt"): string {
  const value = row[field];
  if (typeof value !== "string") throw new Error(`Validated account row requires a string ${field}.`);
  return value;
}

async function createAccount(req: FastifyRequest, reply: FastifyReply, dependencies: AccountEntityRouteDependencies) {
  const { db, store, multiAccount, flows, command, fieldVisibility, drainProductAudit, enqueueAudit } = dependencies;
  const requestRow = requireRequestRow(req.body);
  const { user, actor } = requireRequestContext(req);
  const visibility = fieldVisibility(req, "accounts", requestRow.accountId);
  const { row, scopedState } = prepareScopedWrite({
    store,
    entity: "accounts",
    body: requestRow,
    existing: undefined,
    vis: visibility,
    verb: "create",
  });
  const id = requireRowString(row, "id");
  const createdAt = requireRowString(row, "createdAt");
  const auditRecord: AuditRecord = {
    ts: new Date().toISOString(),
    userId: user.id,
    accountId: typeof row.accountId === "string" ? row.accountId : id,
    action: "create",
    entity: "accounts",
    id,
    changedFields: listAppliedRequestedFieldNames({
      table: "accounts",
      requested: requestRow,
      existing: undefined,
      applied: row,
    }),
  };
  const provisioned = await flows.provisionWorkspace({
    actor,
    workspaceId: id,
    joinedAt: createdAt,
    command: command(req),
    multiWorkspace: multiAccount,
    bootstrapAuthorized: false,
    canonicalProductPayload: buildCanonicalAccountProductPayload(row),
    provisionProductData: () => {
      // Validate and mint the account's singleton Internal client in the provisioning transaction.
      assertValidWrite({ state: scopedState, table: "accounts", row });
      insertRow(db, "accounts", row);
      insertRow(db, "clients", { ...buildInternalClient(id, createdAt) });
      enqueueAudit(auditRecord);
      return row;
    },
  });
  if (!provisioned.replayed) drainProductAudit(reply);
  return reply.code(201).send(provisioned.product);
}

function createPostHandler(dependencies: AccountEntityRouteDependencies) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Authenticated account creation stays on POST /api/orgs, which also creates membership.
    const bodyCheck = checkEntityWriteBody({
      verb: "create",
      entity: "accounts",
      body: req.body,
      urlId: undefined,
      scoped: false,
    });
    if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
    if (dependencies.authMode !== "off") {
      return reply.code(403).send({ error: ACCOUNT_CREATE_CLOSED_MESSAGE });
    }
    try {
      return await createAccount(req, reply, dependencies);
    } catch (error) {
      return sendAccountRouteFailure(reply, error, dependencies);
    }
  };
}

function createDeleteHandler(dependencies: AccountEntityRouteDependencies) {
  const { db, authMode, flows, authorize, command, replayCommand, drainProductAudit, enqueueAudit } = dependencies;
  return async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    try {
      const targetExisted = Boolean(getRow(db, "accounts", id));
      // A completed receipt may replay after erasure removed the caller's live membership.
      const replay = replayCommand(req);
      if (replay) {
        const replayed = await flows.replayWorkspaceErasure({
          actor: requireRequestContext(req).actor,
          workspaceId: id,
          command: replay,
        });
        if (replayed) return reply.code(204).send();
      }
      if (!authorize({ req, reply, accountId: id, action: "deleteAccount" })) return;
      // Preserve trusted-local idempotency without exposing authenticated account existence.
      if (!targetExisted && authMode === "off") return reply.code(204).send();
      const { user, actor } = requireRequestContext(req);
      const auditRecord: AuditRecord = {
        ts: new Date().toISOString(),
        userId: user.id,
        accountId: id,
        action: "delete",
        entity: "accounts",
        id,
        changedFields: [],
      };
      await flows.eraseWorkspace({
        actor,
        workspaceId: id,
        command: command(req),
        ...(targetExisted ? { auditProductMutationInTx: () => enqueueAudit(auditRecord) } : {}),
      });
      if (targetExisted) drainProductAudit(reply);
      return reply.code(204).send();
    } catch (error) {
      return sendAccountRouteFailure(reply, error, dependencies);
    }
  };
}

export function createAccountLifecycleHandlers(dependencies: AccountEntityRouteDependencies) {
  return { post: createPostHandler(dependencies), delete: createDeleteHandler(dependencies) };
}
