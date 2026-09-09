import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditRecord } from "../../audit";
import { getRow, insertRow } from "../../db";
import { listAppliedRequestedFieldNames, assertValidWrite } from "../../validate";
import { checkEntityWriteBody, prepareScopedWrite } from "../../writePipeline";

import type { AccountEntityRouteDependencies } from "./dependencies";
import { sendAccountRouteFailure } from "./guards";
import { ACCOUNT_CREATE_CLOSED_MESSAGE, buildCanonicalAccountProductPayload } from "./policy";

type AccountLifecycleDependencies = Pick<
  AccountEntityRouteDependencies,
  | "db"
  | "store"
  | "authMode"
  | "multiAccount"
  | "flows"
  | "authorize"
  | "command"
  | "replayCommand"
  | "fieldVisibility"
  | "drainProductAudit"
  | "enqueueAudit"
  | "fail"
  | "accountFail"
>;

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

async function createAccount(req: FastifyRequest, reply: FastifyReply, dependencies: AccountLifecycleDependencies) {
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
      // Validate only on first execution so a committed replay is unaffected by the account now
      // existing or the cap later filling. Account, Internal client and audit commit together.
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

function createPostHandler(dependencies: AccountLifecycleDependencies) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    // Keep the shape guard outside try so malformed bodies remain caller-fault 400s, not 500s.
    const bodyCheck = checkEntityWriteBody({
      verb: "create",
      entity: "accounts",
      body: req.body,
      urlId: undefined,
      scoped: false,
    });
    if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
    // Authenticated creation stays on POST /api/orgs; OFF creation remains cap-bounded by the flow.
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

function createDeleteHandler(dependencies: AccountLifecycleDependencies) {
  const { db, authMode, flows, authorize, command, replayCommand, drainProductAudit, enqueueAudit } = dependencies;
  return async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const { id } = req.params;
    try {
      const targetExisted = Boolean(getRow(db, "accounts", id));
      // Only an exact completed receipt may replay after erasure removed live membership;
      // malformed, pending and unrelated commands continue through owner authorization.
      const replay = replayCommand(req);
      if (replay) {
        const replayed = await flows.replayWorkspaceErasure({
          actor: requireRequestContext(req).actor,
          workspaceId: id,
          command: replay,
        });
        if (replayed) return reply.code(204).send();
      }
      // Total tenant erasure is owner-only and the flow coordinates its transactional cascade.
      if (!authorize({ req, reply, accountId: id, action: "deleteAccount" })) return;
      // Preserve trusted-local idempotency without exposing authenticated account existence.
      if (!targetExisted && authMode === "off") return reply.code(204).send();
      const { user, actor } = requireRequestContext(req);
      const auditRecord: AuditRecord = {
        ts: new Date().toISOString(),
        userId: user.id,
        // Attribute erasure to the URL account itself, never caller-supplied tenant data.
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

export function createAccountLifecycleHandlers(dependencies: AccountLifecycleDependencies) {
  return { post: createPostHandler(dependencies), delete: createDeleteHandler(dependencies) };
}
