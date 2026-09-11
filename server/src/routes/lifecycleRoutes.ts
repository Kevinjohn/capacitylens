import type { AuthorizeBasicInput } from "./routeShared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Action } from "@capacitylens/shared/domain/access";
import {
  archive,
  canPurge,
  isLifecycleEntityKey,
  LifecycleTransitionError,
  obfuscateResource,
  softDelete,
  unarchive,
  type LifecycleEntityKey,
} from "@capacitylens/shared/domain/lifecycle";
import type { AuditRecord } from "../audit";
import type { LifecycleRow, TenantStore } from "../tenantStore";
import { createServerRevision } from "../revision";
import type { Resource } from "@capacitylens/shared/types/entities";

export interface LifecycleRedactionInput {
  req: FastifyRequest;
  entity: string;
  row: Record<string, unknown>;
  accountId: string;
}

class LifecycleResponseError extends Error {
  constructor(
    readonly statusCode: 404 | 409,
    message: string,
    readonly code?: "protected_entity",
  ) {
    super(message);
    this.name = "LifecycleResponseError";
  }
}

interface LifecycleRouteDependencies {
  store: TenantStore;
  authorize: (input: AuthorizeBasicInput) => boolean;
  commit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => void;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
  redact: (input: LifecycleRedactionInput) => Record<string, unknown>;
}

function sendLifecycleFailure(
  reply: FastifyReply,
  error: unknown,
  fail: LifecycleRouteDependencies["fail"],
): FastifyReply {
  if (error instanceof LifecycleResponseError) {
    return reply.code(error.statusCode).send({
      ...(error.code ? { code: error.code } : {}),
      error: error.message,
    });
  }
  if (error instanceof LifecycleTransitionError) {
    return reply.code(409).send({ code: error.code, error: error.message });
  }
  return fail(reply, error);
}

interface WriteTransitionResult {
  kind: "write";
  next: LifecycleRow;
  changedFields: string[];
  scrubResourceNotes?: boolean;
}

interface PurgeTransitionResult {
  kind: "purge";
  cascadeCounts: NonNullable<AuditRecord["cascadeCounts"]>;
}

type TransitionResult = WriteTransitionResult | PurgeTransitionResult;

interface LifecycleTransitionInput {
  row: LifecycleRow;
  entity: LifecycleEntityKey;
  accountId: string;
  id: string;
}

interface TransitionSpec {
  path: "archive" | "unarchive" | "delete" | "purge";
  permission: Action;
  protectedVerb: string;
  auditAction: AuditRecord["action"];
  apply: (input: LifecycleTransitionInput) => TransitionResult;
  successStatus?: 200 | 204;
}

interface LifecycleRequestInput {
  entity: LifecycleEntityKey;
  id: string;
  accountId: string;
}

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readLifecycleRequest(req: FastifyRequest, reply: FastifyReply): LifecycleRequestInput | null {
  if (!isUnknownRecord(req.params) || typeof req.params.entity !== "string" || typeof req.params.id !== "string") {
    throw new Error("Expected lifecycle route parameters.");
  }
  if (!isLifecycleEntityKey(req.params.entity)) {
    reply.code(404).send({ error: `Unknown entity: ${req.params.entity}` });
    return null;
  }
  if (!isUnknownRecord(req.body) || typeof req.body.accountId !== "string" || req.body.accountId.length === 0) {
    reply.code(400).send({ error: "accountId is required." });
    return null;
  }
  return { entity: req.params.entity, id: req.params.id, accountId: req.body.accountId };
}

function assertUserId(req: FastifyRequest): string {
  if (!req.user) throw new Error("Expected user context on an authorized lifecycle route.");
  return req.user.id;
}

function isBuiltinLifecycleRow(row: LifecycleRow): boolean {
  return "builtin" in row && row.builtin;
}

function isResourceRow(row: LifecycleRow): row is Resource {
  return "employmentType" in row;
}

function applyDeletedRowObfuscation(entity: LifecycleEntityKey, row: LifecycleRow): LifecycleRow {
  if (entity !== "resources") return row;
  if (!isResourceRow(row)) throw new Error("Expected the resource lifecycle store to return a resource row.");
  return obfuscateResource(row);
}

interface ApplyTransitionMutationInput {
  dependencies: LifecycleRouteDependencies;
  req: FastifyRequest;
  reply: FastifyReply;
  request: LifecycleRequestInput;
  spec: TransitionSpec;
}

function applyTransitionMutation({
  dependencies,
  req,
  reply,
  request,
  spec,
}: ApplyTransitionMutationInput): Record<string, unknown> | undefined {
  const { accountId, entity, id } = request;
  const auditRecord: AuditRecord = {
    ts: new Date().toISOString(),
    userId: assertUserId(req),
    accountId,
    action: spec.auditAction,
    entity,
    id,
    changedFields: [],
  };
  let response: Record<string, unknown> | undefined;
  dependencies.commit(reply, auditRecord, () => {
    const row = dependencies.store.readLifecycleRow(accountId, entity, id);
    if (!row) throw new LifecycleResponseError(404, "Not found");
    if (entity === "clients" && isBuiltinLifecycleRow(row)) {
      throw new LifecycleResponseError(
        409,
        `The built-in Internal client cannot be ${spec.protectedVerb}.`,
        "protected_entity",
      );
    }

    const result = spec.apply({ row, entity, accountId, id });
    if (result.kind === "purge") {
      auditRecord.cascadeCounts = result.cascadeCounts;
      return;
    }
    dependencies.store.writeLifecycleRow(accountId, entity, result.next);
    const scrubbed = result.scrubResourceNotes ? dependencies.store.scrubResourceNotes(accountId, id) : null;
    auditRecord.changedFields = [
      ...result.changedFields,
      ...(scrubbed?.allocationNotes ? ["allocations.note"] : []),
      ...(scrubbed?.timeOffNotes ? ["timeOff.note"] : []),
    ];
    // Redaction may consult the membership store. Keep that fallible read inside the outer
    // product/audit transaction so a failure cannot turn a committed transition into a 5xx.
    response = dependencies.redact({ req, entity, row: { ...result.next }, accountId });
  });
  return response;
}

interface SendTransitionResponseInput {
  dependencies: LifecycleRouteDependencies;
  req: FastifyRequest;
  reply: FastifyReply;
  spec: TransitionSpec;
}

function sendTransitionResponse({
  dependencies,
  req,
  reply,
  spec,
}: SendTransitionResponseInput): FastifyReply | undefined {
  const request = readLifecycleRequest(req, reply);
  if (!request) return reply;
  if (!dependencies.authorize({ req, reply, accountId: request.accountId, action: spec.permission })) return;

  try {
    const response = applyTransitionMutation({ dependencies, req, reply, request, spec });
    if (spec.successStatus === 204) return reply.code(204).send();
    if (response === undefined) throw new Error("Lifecycle write completed without a response.");
    return reply.code(200).send(response);
  } catch (error) {
    return sendLifecycleFailure(reply, error, dependencies.fail);
  }
}

/** Register one lifecycle mutation through the shared guard→read→transition→write→audit pipeline. */
function registerTransition(
  app: FastifyInstance,
  dependencies: LifecycleRouteDependencies,
  spec: TransitionSpec,
): void {
  app.post(`/api/:entity/:id/${spec.path}`, (req, reply) => sendTransitionResponse({ dependencies, req, reply, spec }));
}

/** Dedicated plugin-style registration for all tombstone lifecycle routes. */
export function registerLifecycleRoutes(app: FastifyInstance, dependencies: LifecycleRouteDependencies): void {
  registerTransition(app, dependencies, {
    path: "archive",
    permission: "write",
    protectedVerb: "archived",
    auditAction: "archive",
    apply: ({ row }) => {
      const now = createServerRevision(row.updatedAt);
      const next = { ...archive(row, now), updatedAt: now };
      return { kind: "write", next, changedFields: ["archivedAt"] };
    },
  });

  registerTransition(app, dependencies, {
    path: "unarchive",
    permission: "write",
    protectedVerb: "unarchived",
    auditAction: "unarchive",
    apply: ({ row }) => {
      const next = { ...unarchive(row), updatedAt: createServerRevision(row.updatedAt) };
      return { kind: "write", next, changedFields: ["archivedAt"] };
    },
  });

  registerTransition(app, dependencies, {
    path: "delete",
    permission: "purge",
    protectedVerb: "deleted",
    auditAction: "softDelete",
    apply: ({ row, entity }) => {
      const now = createServerRevision(row.updatedAt);
      const tombstone = softDelete(row, now);
      const deleted = { ...tombstone, updatedAt: tombstone.deletedAt ?? now };
      const next = applyDeletedRowObfuscation(entity, deleted);
      return {
        kind: "write",
        next,
        changedFields: entity === "resources" ? ["deletedAt", "name"] : ["deletedAt"],
        scrubResourceNotes: entity === "resources",
      };
    },
  });

  registerTransition(app, dependencies, {
    path: "purge",
    permission: "purge",
    protectedVerb: "purged",
    auditAction: "purge",
    successStatus: 204,
    apply: ({ row, entity, accountId, id }: LifecycleTransitionInput) => {
      if (!canPurge(row, new Date().toISOString())) {
        throw new LifecycleResponseError(409, "Cannot purge: must be a soft-deleted tombstone at least 30 days old.");
      }
      const purged = dependencies.store.purgeLifecycleRow(accountId, entity, id);
      if (!purged) {
        throw new LifecycleResponseError(404, "Not found");
      }
      return { kind: "purge", cascadeCounts: purged.removedCounts };
    },
  });
}
