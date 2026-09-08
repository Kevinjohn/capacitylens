import { SINGLE_COMPANY_CAP_MESSAGE } from "@capacitylens/shared/account/policy";
import { buildInternalClient } from "@capacitylens/shared/data/internalClient";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditRecord } from "../../audit";
import { getRow, upsertRow } from "../../db";
import { listAppliedRequestedFieldNames, sanitizeWrite, assertValidWrite } from "../../validate";
import { checkEntityWriteBody, prepareScopedWrite, stampServerRevision, type PreparedWrite } from "../../writePipeline";
import type { AccountEntityRouteDependencies } from "./dependencies";
import { sendAccountRouteFailure, enforceAccountWriteGuards } from "./guards";
import { ACCOUNT_CREATE_CLOSED_MESSAGE, isAccountCreateCapped, buildCanonicalAccountProductPayload } from "./policy";

type AccountActor = NonNullable<FastifyRequest["accountActor"]>;

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRouteId(req: FastifyRequest): string {
  if (!isUnknownRecord(req.params) || typeof req.params.id !== "string") {
    throw new Error("Expected the account route to provide a string id.");
  }
  return req.params.id;
}

function readWriteBody(body: unknown): Record<string, unknown> {
  if (!isUnknownRecord(body)) throw new Error("Expected a checked account write body.");
  return body;
}

function requireActor(req: FastifyRequest): AccountActor {
  if (!req.accountActor) throw new Error("Expected account actor context on an authorized write.");
  return req.accountActor;
}

function requireUserId(req: FastifyRequest): string {
  if (!req.user) throw new Error("Expected user context on an authorized write.");
  return req.user.id;
}

function readCreatedAt(row: Record<string, unknown>): string {
  if (typeof row.createdAt !== "string") throw new Error("Expected the prepared account row to have createdAt.");
  return row.createdAt;
}

interface AccountWriteInput {
  dependencies: AccountEntityRouteDependencies;
  req: FastifyRequest;
  reply: FastifyReply;
  id: string;
  body: Record<string, unknown>;
}

function createPutAuditRecord(input: {
  req: FastifyRequest;
  id: string;
  body: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
  row: Record<string, unknown>;
}): AuditRecord {
  const { req, id, body, existing, row } = input;
  return {
    ts: new Date().toISOString(),
    userId: requireUserId(req),
    // Audit the mutated account from the URL; a caller's ownership assertion never selects a ledger.
    accountId: id,
    action: existing ? "update" : "create",
    entity: "accounts",
    id,
    changedFields: listAppliedRequestedFieldNames({ table: "accounts", requested: body, existing, applied: row }),
  };
}

async function persistPut(input: {
  dependencies: AccountEntityRouteDependencies;
  req: FastifyRequest;
  reply: FastifyReply;
  id: string;
  existing: Record<string, unknown> | undefined;
  row: Record<string, unknown>;
  scopedState: PreparedWrite["scopedState"];
  auditRecord: AuditRecord;
  workspaceCommand: ReturnType<AccountEntityRouteDependencies["command"]>;
}): Promise<Record<string, unknown>> {
  const { dependencies, req, reply, id, existing, row, scopedState, auditRecord, workspaceCommand } = input;
  const { db, flows, multiAccount, enqueueAudit, commitProductAudit, drainProductAudit } = dependencies;
  if (existing) {
    commitProductAudit(reply, auditRecord, () => upsertRow(db, "accounts", row));
    return row;
  }
  const provisioned = await flows.provisionWorkspace({
    actor: requireActor(req),
    workspaceId: id,
    joinedAt: readCreatedAt(row),
    command: workspaceCommand,
    multiWorkspace: multiAccount,
    bootstrapAuthorized: false,
    canonicalProductPayload: buildCanonicalAccountProductPayload(row),
    provisionProductData: () => {
      assertValidWrite({ state: scopedState, table: "accounts", row, existing });
      upsertRow(db, "accounts", row);
      upsertRow(db, "clients", { ...buildInternalClient(id, readCreatedAt(row)) });
      enqueueAudit(auditRecord);
      return row;
    },
  });
  if (!provisioned.replayed) drainProductAudit(reply);
  return provisioned.product;
}

function allowPut(input: AccountWriteInput, existing: Record<string, unknown> | undefined): boolean {
  const { dependencies, req, reply, id } = input;
  // Authenticated account creation is closed before the OFF-mode cap is considered. Existing rows
  // skip the create-only cap and instead require write authority for their own account id.
  if (!existing && dependencies.authMode !== "off") {
    reply.code(403).send({ error: ACCOUNT_CREATE_CLOSED_MESSAGE });
    return false;
  }
  if (!existing && isAccountCreateCapped({ db: dependencies.db, multiAccount: dependencies.multiAccount })) {
    reply.code(403).send({ error: SINGLE_COMPANY_CAP_MESSAGE });
    return false;
  }
  return !existing || dependencies.authorize({ req, reply, accountId: id, action: "write" });
}

async function replayPut(
  input: AccountWriteInput & {
    existing: Record<string, unknown> | undefined;
    workspaceCommand: ReturnType<AccountEntityRouteDependencies["command"]>;
    visibility: Parameters<AccountEntityRouteDependencies["redact"]>[2];
  },
): Promise<boolean> {
  const { dependencies, req, reply, id, body, existing, workspaceCommand, visibility } = input;
  // Only trusted-local compatibility writes can replay here. Authenticated updates never await the
  // coordinator between their authority decision and mutation, avoiding stale authorization.
  if (dependencies.authMode !== "off" || !existing) return false;
  const replay = await dependencies.flows.replayWorkspaceProvisioning<Record<string, unknown>>({
    actor: requireActor(req),
    workspaceId: id,
    command: workspaceCommand,
    canonicalProductPayload: buildCanonicalAccountProductPayload(
      sanitizeWrite({ table: "accounts", row: body, existing, options: visibility }),
    ),
  });
  if (!replay) return false;
  reply.code(200).send(dependencies.redact("accounts", replay.product, visibility));
  return true;
}

async function applyPut(input: AccountWriteInput): Promise<FastifyReply | undefined> {
  const { dependencies, req, reply, id, body } = input;
  const { db, store, optimisticConcurrency, command, fieldVisibility, redact } = dependencies;
  // Parse the command before reading state, and attempt trusted-local replay before the stale-write
  // guard so a completed command is returned rather than rejected by a newer stored revision.
  const workspaceCommand = command(req);
  const existing = getRow(db, "accounts", id) ?? undefined;
  if (!allowPut(input, existing)) return;
  if (
    enforceAccountWriteGuards({
      reply,
      existing,
      ownsRow: dependencies.ownsRow,
      isStaleWrite: dependencies.isStaleWrite,
      redact,
      checkOwnsRow: { accountId: body.accountId },
      checkFrozen: { candidate: sanitizeWrite({ table: "accounts", row: body, existing }) },
    })
  )
    return;
  const visibility = fieldVisibility(req, "accounts", body.accountId);
  if (await replayPut({ ...input, existing, workspaceCommand, visibility })) return;
  if (
    enforceAccountWriteGuards({
      reply,
      existing,
      ownsRow: dependencies.ownsRow,
      isStaleWrite: dependencies.isStaleWrite,
      redact,
      checkStale: { optimisticConcurrency, candidateRow: body, vis: visibility },
    })
  )
    return;
  const { row, scopedState } = prepareScopedWrite({
    store,
    entity: "accounts",
    body,
    existing,
    vis: visibility,
    verb: "replace",
  });
  const auditRecord = createPutAuditRecord({ req, id, body, existing, row });
  const responseRow = await persistPut({
    dependencies,
    req,
    reply,
    id,
    existing,
    row,
    scopedState,
    auditRecord,
    workspaceCommand,
  });
  return reply.code(200).send(redact("accounts", responseRow, visibility));
}

async function put(dependencies: AccountEntityRouteDependencies, req: FastifyRequest, reply: FastifyReply) {
  const id = readRouteId(req);
  const bodyCheck = checkEntityWriteBody({
    verb: "replace",
    entity: "accounts",
    body: req.body,
    urlId: id,
    scoped: false,
  });
  if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
  try {
    return await applyPut({ dependencies, req, reply, id, body: readWriteBody(req.body) });
  } catch (error) {
    return sendAccountRouteFailure(reply, error, dependencies);
  }
}

function applyPatch(input: AccountWriteInput): FastifyReply | undefined {
  const { dependencies, req, reply, id, body } = input;
  const { db, store, optimisticConcurrency, authorize, fieldVisibility, redact, commitProductAudit } = dependencies;
  const existing = getRow(db, "accounts", id);
  if (!existing) return reply.code(404).send({ error: "Not found" });
  if (!authorize({ req, reply, accountId: id, action: "write" })) return;
  const visibility = fieldVisibility(req, "accounts", body.accountId ?? existing.accountId);
  const merged = sanitizeWrite({ table: "accounts", row: { ...existing, ...body, id }, existing, options: visibility });
  // Accounts sanitization drops accountId, but ownsRow must see the caller's raw assertion so a
  // foreign ownership claim is concealed as 404 instead of being silently ignored.
  if (
    enforceAccountWriteGuards({
      reply,
      existing,
      ownsRow: dependencies.ownsRow,
      isStaleWrite: dependencies.isStaleWrite,
      redact,
      checkOwnsRow: { accountId: body.accountId ?? existing.accountId },
      checkFrozen: { candidate: merged },
      checkStale: { optimisticConcurrency, candidateRow: body, requirePrecondition: false, vis: visibility },
    })
  )
    return;
  const stamped = stampServerRevision(merged, existing);
  const lookup = store.validationLookup?.();
  const validationState = lookup === undefined ? store.readFullSlice(id) : emptyAppData();
  assertValidWrite({ state: validationState, table: "accounts", row: stamped, existing, lookup });
  commitProductAudit(
    reply,
    {
      ts: new Date().toISOString(),
      userId: requireUserId(req),
      accountId: id,
      action: "patch",
      entity: "accounts",
      id,
      changedFields: listAppliedRequestedFieldNames({ table: "accounts", requested: body, existing, applied: stamped }),
    },
    () => upsertRow(db, "accounts", stamped),
  );
  return reply.code(200).send(redact("accounts", stamped, visibility));
}

function patch(dependencies: AccountEntityRouteDependencies, req: FastifyRequest, reply: FastifyReply) {
  const id = readRouteId(req);
  const bodyCheck = checkEntityWriteBody({
    verb: "patch",
    entity: "accounts",
    body: req.body,
    urlId: id,
    scoped: false,
  });
  if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
  try {
    return applyPatch({ dependencies, req, reply, id, body: readWriteBody(req.body) });
  } catch (error) {
    return dependencies.fail(reply, error);
  }
}

export function createAccountWriteHandlers(dependencies: AccountEntityRouteDependencies) {
  return {
    put: (req: FastifyRequest, reply: FastifyReply) => put(dependencies, req, reply),
    patch: (req: FastifyRequest, reply: FastifyReply) => patch(dependencies, req, reply),
  };
}
