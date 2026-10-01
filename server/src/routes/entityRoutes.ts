import { NO_REPROMPT, type AuthorizeRouteInput } from "./routeShared";
import { buildUnknownEntityMessage, FROZEN_REPLY_MESSAGES, REPLY_ERRORS } from "./replyErrors";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { emptyAppData } from "@capacitylens/shared/types/entities";
import type { AuditRecord } from "../audit";
import type { AccountMode } from "../auth";
import { deleteRow, getRow, insertRow, type Db, type RewrittenAllocationRevision, upsertRow } from "../db";
import type { SanitizeWriteOptions } from "../fieldPolicy";
import type { TenantStore } from "../tenantStore";
import { listAppliedRequestedFieldNames, sanitizeWrite, assertValidWrite } from "../validate";
import {
  resolveBuiltinWriteRejection,
  checkEntityWriteBody,
  prepareScopedWrite,
  replaceGeneratedBuiltin,
  stampServerRevision,
  type PreparedWrite,
} from "../writePipeline";
import {
  isGenericEntity,
  isLifecycleEntity,
  isScopedTable,
  isStaleWrite,
  ownsRow,
  shapeActivityWriteEcho,
  writeActivityRow,
} from "./routeShared";

export interface EntityRouteDependencies {
  db: Db;
  store: TenantStore;
  authMode: AccountMode;
  optimisticConcurrency: boolean;
  authorize: (input: AuthorizeRouteInput) => boolean;
  fieldVisibility: (req: FastifyRequest, table: string, accountId: unknown) => SanitizeWriteOptions;
  redact: (table: string, row: Record<string, unknown>, visibility: SanitizeWriteOptions) => Record<string, unknown>;
  commitProductAudit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => boolean;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
}

interface EntityCollectionRoute {
  Params: { entity: string };
}

interface EntityItemRoute {
  Params: { entity: string; id: string };
}

// Repeated query keys arrive as arrays, so the declared type admits them and the handler checks.
interface EntityDeleteRoute extends EntityItemRoute {
  Querystring: { accountId?: string | string[] };
}

interface EntityWriteContext {
  req: FastifyRequest;
  reply: FastifyReply;
  entity: string;
  dependencies: EntityRouteDependencies;
}

function readAuthenticatedUserId(req: FastifyRequest): string {
  if (!req.user) throw new Error("Authenticated entity route request is missing its user.");
  return req.user.id;
}

const sendUnknownEntity = (reply: FastifyReply, entity: string) =>
  reply.code(404).send({ error: buildUnknownEntityMessage(entity) });

/** Send the refusal when a replacement may not proceed; null when it may. A refusal already sent
 * by the authorization gate is returned as the same reply. */
function sendReplacementRefusal(
  { req, reply, entity, dependencies }: EntityWriteContext,
  body: Record<string, unknown>,
  existing: Record<string, unknown> | undefined,
): FastifyReply | null {
  const builtinCheck = resolveBuiltinWriteRejection({ verb: "replace", entity, existing, incoming: body });
  if (builtinCheck) return reply.code(builtinCheck.status).send({ error: builtinCheck.error });
  if (entity === "clients" && body.builtin === true && existing?.builtin !== true) {
    const accountId = body.accountId as string;
    if (!dependencies.authorize({ req, reply, accountId, action: "manageInternalClient", options: NO_REPROMPT }))
      return reply;
  }
  if (!ownsRow(existing, body.accountId)) return reply.code(404).send({ error: FROZEN_REPLY_MESSAGES.notFound });
  return null;
}

type PatchTarget = { kind: "allowed"; existing: Record<string, unknown> } | { kind: "refused"; reply: FastifyReply };

function readAllowedPatchTarget({ req, reply, entity, dependencies }: EntityWriteContext, id: string): PatchTarget {
  const existing = getRow(dependencies.db, entity, id);
  if (!existing) return { kind: "refused", reply: reply.code(404).send({ error: FROZEN_REPLY_MESSAGES.notFound }) };
  if (
    isScopedTable(entity) &&
    !dependencies.authorize({
      req,
      reply,
      accountId: existing.accountId as string,
      action: "write",
      options: { concealNonMembership: true },
    })
  )
    return { kind: "refused", reply };
  const builtinCheck = resolveBuiltinWriteRejection({
    verb: "patch",
    entity,
    existing,
    incoming: req.body as Record<string, unknown>,
  });
  if (builtinCheck) {
    return { kind: "refused", reply: reply.code(builtinCheck.status).send({ error: builtinCheck.error }) };
  }
  return { kind: "allowed", existing };
}

type ApplyWriteInput = Partial<Pick<PreparedWrite, "generatedReplacement" | "scopedState">> & {
  db: Db;
  entity: string;
  row: Record<string, unknown>;
  existing: Record<string, unknown> | undefined;
};

function applyWrite(input: ApplyWriteInput): RewrittenAllocationRevision[] {
  if (input.generatedReplacement) {
    if (!input.scopedState) throw new Error("Generated client replacement is missing its scoped state.");
    replaceGeneratedBuiltin({
      db: input.db,
      state: input.scopedState,
      generatedId: input.generatedReplacement,
      row: input.row,
    });
    return [];
  }
  if (input.entity === "activities") {
    return writeActivityRow({ db: input.db, projection: undefined, row: input.row, existing: input.existing });
  }
  upsertRow(input.db, input.entity, input.row);
  return [];
}

function readPatchValidationState(store: TenantStore, entity: string, accountId: string) {
  const lookup = store.validationLookup?.();
  const state = entity === "clients" || lookup === undefined ? store.readFullSlice(accountId) : emptyAppData();
  return { lookup, state };
}

interface PatchAuditRows {
  body: unknown;
  existing: Record<string, unknown>;
  merged: Record<string, unknown>;
  stamped: Record<string, unknown>;
}

function createPatchAuditRecord(
  { req, entity }: EntityWriteContext,
  id: string,
  { body, existing, merged, stamped }: PatchAuditRows,
): AuditRecord {
  return stampAudit({
    userId: readAuthenticatedUserId(req),
    accountId: (merged.accountId as string | undefined) ?? id,
    action: "patch",
    entity,
    id,
    changedFields: listAppliedRequestedFieldNames({ table: entity, requested: body, existing, applied: stamped }),
  });
}

const stampAudit = (record: Omit<AuditRecord, "ts">): AuditRecord => ({ ts: new Date().toISOString(), ...record });

function registerCreateRoute(app: FastifyInstance, dependencies: EntityRouteDependencies): void {
  const {
    db,
    store,
    authorize,
    fieldVisibility: fieldVisibilityFor,
    commitProductAudit,
    fail: sendFail,
  } = dependencies;

  app.post<EntityCollectionRoute>("/api/:entity", (req, reply) => {
    const { entity } = req.params;
    if (!isGenericEntity(entity)) return sendUnknownEntity(reply, entity);
    const scoped = isScopedTable(entity);
    const bodyCheck = checkEntityWriteBody({ verb: "create", entity, body: req.body, urlId: undefined, scoped });
    if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
    const requestRow = req.body as Record<string, unknown>;
    const builtinCheck = resolveBuiltinWriteRejection({
      verb: "create",
      entity,
      existing: undefined,
      incoming: requestRow,
    });
    if (builtinCheck) return reply.code(builtinCheck.status).send({ error: builtinCheck.error });
    if (scoped) {
      if (!authorize({ req, reply, accountId: requestRow.accountId as string, action: "write" })) return;
    }
    try {
      const visibility = fieldVisibilityFor(req, entity, requestRow.accountId);
      const { row } = prepareScopedWrite({
        store,
        entity,
        body: requestRow,
        existing: undefined,
        vis: visibility,
        verb: "create",
      });
      const auditRecord = stampAudit({
        userId: readAuthenticatedUserId(req),
        accountId: (row.accountId as string | undefined) ?? (row.id as string),
        action: "create",
        entity,
        id: row.id as string,
        changedFields: listAppliedRequestedFieldNames({
          table: entity,
          requested: requestRow,
          existing: undefined,
          applied: row,
        }),
      });
      commitProductAudit(reply, auditRecord, () => {
        insertRow(db, entity, row);
      });
      return reply.code(201).send(row);
    } catch (error) {
      return sendFail(reply, error);
    }
  });
}

function replaceEntity(
  req: FastifyRequest<EntityItemRoute>,
  reply: FastifyReply,
  dependencies: EntityRouteDependencies,
): FastifyReply | undefined {
  const { db, store, optimisticConcurrency, authorize, commitProductAudit } = dependencies;
  const fieldVisibilityFor = dependencies.fieldVisibility;
  const redactWriteEcho = dependencies.redact;
  const sendFail = dependencies.fail;
  const { entity, id } = req.params;
  if (!isGenericEntity(entity)) return sendUnknownEntity(reply, entity);
  const scoped = isScopedTable(entity);
  const bodyCheck = checkEntityWriteBody({ verb: "replace", entity, body: req.body, urlId: id, scoped });
  if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
  const body = req.body as Record<string, unknown>;
  if (scoped && !authorize({ req, reply, accountId: body.accountId as string, action: "write" })) return;
  try {
    const existing = getRow(db, entity, id) ?? undefined;
    const refusal = sendReplacementRefusal({ req, reply, entity, dependencies }, body, existing);
    if (refusal) return refusal;
    const visibility = fieldVisibilityFor(req, entity, body.accountId);
    if (optimisticConcurrency) {
      const staleWriteInput = { existing, row: body };
      if (isStaleWrite(staleWriteInput)) {
        return reply.code(409).send({
          error: REPLY_ERRORS.staleWrite,
          current: redactWriteEcho(entity, staleWriteInput.existing, visibility),
        });
      }
    }
    const { row, generatedReplacement, scopedState } = prepareScopedWrite({
      store,
      entity,
      body,
      existing,
      vis: visibility,
      verb: "replace",
    });
    const auditRecord = stampAudit({
      userId: readAuthenticatedUserId(req),
      accountId: (body.accountId as string | undefined) ?? id,
      action: existing ? "update" : "create",
      entity,
      id,
      changedFields: listAppliedRequestedFieldNames({ table: entity, requested: body, existing, applied: row }),
    });
    let rewrittenAllocations: RewrittenAllocationRevision[] = [];
    commitProductAudit(reply, auditRecord, () => {
      rewrittenAllocations = applyWrite({ db, entity, row, existing, generatedReplacement, scopedState });
    });
    const echo = redactWriteEcho(entity, row, visibility);
    return reply.code(200).send(shapeActivityWriteEcho(entity, echo, rewrittenAllocations));
  } catch (error) {
    return sendFail(reply, error);
  }
}

function registerUpdateRoutes(app: FastifyInstance, dependencies: EntityRouteDependencies): void {
  app.put<EntityItemRoute>("/api/:entity/:id", (req, reply) => replaceEntity(req, reply, dependencies));
  app.patch<EntityItemRoute>("/api/:entity/:id", (req, reply) => patchEntity(req, reply, dependencies));
}

function patchEntity(
  req: FastifyRequest<EntityItemRoute>,
  reply: FastifyReply,
  dependencies: EntityRouteDependencies,
): FastifyReply | undefined {
  const { db, store, optimisticConcurrency, commitProductAudit } = dependencies;
  const fieldVisibilityFor = dependencies.fieldVisibility;
  const redactWriteEcho = dependencies.redact;
  const sendFail = dependencies.fail;
  const { entity, id } = req.params;
  if (!isGenericEntity(entity)) return sendUnknownEntity(reply, entity);
  const scoped = isScopedTable(entity);
  const bodyCheck = checkEntityWriteBody({ verb: "patch", entity, body: req.body, urlId: id, scoped });
  if (bodyCheck) return reply.code(bodyCheck.status).send({ error: bodyCheck.error });
  try {
    const context = { req, reply, entity, dependencies };
    const target = readAllowedPatchTarget(context, id);
    if (target.kind === "refused") return target.reply;
    const { existing } = target;
    const visibility = fieldVisibilityFor(
      req,
      entity,
      (req.body as { accountId?: unknown }).accountId ?? existing.accountId,
    );
    const merged = sanitizeWrite({
      table: entity,
      row: { ...existing, ...(req.body as Record<string, unknown>), id },
      existing,
      options: visibility,
    });
    if (!ownsRow(existing, merged.accountId)) {
      return reply.code(404).send({ error: FROZEN_REPLY_MESSAGES.notFound });
    }
    if (
      optimisticConcurrency &&
      isStaleWrite({ existing, row: req.body as Record<string, unknown>, requirePrecondition: false })
    ) {
      return reply.code(409).send({
        error: REPLY_ERRORS.staleWrite,
        current: redactWriteEcho(entity, existing, visibility),
      });
    }
    const stamped = stampServerRevision(merged, existing);
    const scopeId = String(merged.accountId);
    const { lookup, state } = readPatchValidationState(store, entity, scopeId);
    assertValidWrite({ state, table: entity, row: stamped, existing, lookup });
    let rewrittenAllocations: RewrittenAllocationRevision[] = [];
    commitProductAudit(
      reply,
      createPatchAuditRecord(context, id, { body: req.body, existing, merged, stamped }),
      () => {
        rewrittenAllocations = applyWrite({ db, entity, row: stamped, existing });
      },
    );
    const echo = redactWriteEcho(entity, stamped, visibility);
    return reply.code(200).send(shapeActivityWriteEcho(entity, echo, rewrittenAllocations));
  } catch (error) {
    return sendFail(reply, error);
  }
}

function registerDeleteRoute(app: FastifyInstance, dependencies: EntityRouteDependencies): void {
  const { db, authMode, authorize, commitProductAudit, fail: sendFail } = dependencies;
  app.delete<EntityDeleteRoute>("/api/:entity/:id", (req, reply) => {
    const { entity, id } = req.params;
    if (!isGenericEntity(entity)) return sendUnknownEntity(reply, entity);
    if (isLifecycleEntity(entity)) {
      return reply.code(400).send({ error: REPLY_ERRORS.useLifecycleEndpoints });
    }
    const { accountId } = req.query;
    try {
      if (!isScopedTable(entity)) {
        return reply.code(403).send({ error: REPLY_ERRORS.noDeletionPolicy });
      }
      if (typeof accountId !== "string") {
        return reply.code(400).send({ error: REPLY_ERRORS.accountIdRequiredForScopedDelete });
      }
      if (!authorize({ req, reply, accountId, action: "write" })) return;
      const existing = getRow(db, entity, id) ?? undefined;
      if (!ownsRow(existing, accountId) || (!existing && authMode !== "off")) {
        return reply.code(404).send({ error: FROZEN_REPLY_MESSAGES.notFound });
      }
      if (existing) {
        commitProductAudit(
          reply,
          stampAudit({
            userId: readAuthenticatedUserId(req),
            accountId,
            action: "delete",
            entity,
            id,
            changedFields: [],
          }),
          () => deleteRow(db, entity, id),
        );
      }
      return reply.code(204).send();
    } catch (error) {
      return sendFail(reply, error);
    }
  });
}

export function registerEntityRoutes(app: FastifyInstance, dependencies: EntityRouteDependencies): void {
  registerCreateRoute(app, dependencies);
  registerUpdateRoutes(app, dependencies);
  registerDeleteRoute(app, dependencies);
}
