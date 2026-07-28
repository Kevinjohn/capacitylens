import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Client, Resource } from "@capacitylens/shared/types/entities";
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
import { isBuiltinClient } from "@capacitylens/shared/data/internalClient";
import type { AuditRecord } from "../audit";
import type { LifecycleRow, TenantStore } from "../tenantStore";

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
  authorize: (req: FastifyRequest, reply: FastifyReply, accountId: string, action: Action) => boolean;
  commit: (reply: FastifyReply, record: AuditRecord, mutation: () => void) => void;
  fail: (reply: FastifyReply, error: unknown) => FastifyReply;
  redact: (
    req: FastifyRequest,
    entity: string,
    row: Record<string, unknown>,
    accountId: string,
  ) => Record<string, unknown>;
}

function nextRevision(updatedAt: unknown): string {
  const previous = typeof updatedAt === "string" ? Date.parse(updatedAt) : Number.NaN;
  return new Date(Math.max(Date.now(), Number.isFinite(previous) ? previous + 1 : 0)).toISOString();
}

function lifecycleFailure(reply: FastifyReply, error: unknown, fail: LifecycleRouteDependencies["fail"]): FastifyReply {
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

interface TransitionResult {
  next: LifecycleRow;
  changedFields: string[];
  scrubResourceNotes?: boolean;
}

interface TransitionSpec {
  path: "archive" | "unarchive" | "delete" | "purge";
  permission: Action;
  protectedVerb: string;
  auditAction: AuditRecord["action"];
  apply: (row: LifecycleRow, entity: LifecycleEntityKey, accountId: string, id: string) => TransitionResult | null;
  successStatus?: 200 | 204;
}

/** Register one lifecycle mutation through the shared guard→read→transition→write→audit pipeline. */
function registerTransition(
  app: FastifyInstance,
  dependencies: LifecycleRouteDependencies,
  spec: TransitionSpec,
): void {
  app.post(`/api/:entity/:id/${spec.path}`, (req, reply) => {
    const { entity: rawEntity, id } = req.params as {
      entity: string;
      id: string;
    };
    if (!isLifecycleEntityKey(rawEntity)) {
      return reply.code(404).send({ error: `Unknown entity: ${rawEntity}` });
    }
    const body = (req.body ?? {}) as { accountId?: unknown };
    if (typeof body.accountId !== "string" || body.accountId.length === 0) {
      return reply.code(400).send({ error: "accountId is required." });
    }
    const accountId = body.accountId;
    if (!dependencies.authorize(req, reply, accountId, spec.permission)) return;

    try {
      const auditRecord: AuditRecord = {
        ts: new Date().toISOString(),
        userId: req.user!.id,
        accountId,
        action: spec.auditAction,
        entity: rawEntity,
        id,
        changedFields: [],
      };
      let result: TransitionResult | null = null;
      let response: Record<string, unknown> | undefined;
      dependencies.commit(reply, auditRecord, () => {
        const row = dependencies.store.readLifecycleRow(accountId, rawEntity, id);
        if (!row) throw new LifecycleResponseError(404, "Not found");
        if (rawEntity === "clients" && isBuiltinClient(row as Client)) {
          throw new LifecycleResponseError(
            409,
            `The built-in Internal client cannot be ${spec.protectedVerb}.`,
            "protected_entity",
          );
        }

        result = spec.apply(row, rawEntity, accountId, id);
        if (result === null) return;
        dependencies.store.writeLifecycleRow(accountId, rawEntity, result.next);
        const scrubbed = result.scrubResourceNotes ? dependencies.store.scrubResourceNotes(accountId, id) : null;
        auditRecord.changedFields = [
          ...result.changedFields,
          ...(scrubbed?.allocationNotes ? ["allocations.note"] : []),
          ...(scrubbed?.timeOffNotes ? ["timeOff.note"] : []),
        ];
        // Redaction may consult the membership store. Keep that fallible read inside the outer
        // product/audit transaction so a failure cannot turn a committed transition into a 5xx.
        response = dependencies.redact(req, rawEntity, result.next as unknown as Record<string, unknown>, accountId);
      });
      if (spec.successStatus === 204) return reply.code(204).send();
      return reply.code(200).send(response);
    } catch (error) {
      return lifecycleFailure(reply, error, dependencies.fail);
    }
  });
}

/** Dedicated plugin-style registration for all tombstone lifecycle routes. */
export function registerLifecycleRoutes(app: FastifyInstance, dependencies: LifecycleRouteDependencies): void {
  registerTransition(app, dependencies, {
    path: "archive",
    permission: "write",
    protectedVerb: "archived",
    auditAction: "archive",
    apply: (row) => {
      const now = nextRevision(row.updatedAt);
      const next = { ...archive(row, now), updatedAt: now };
      return { next, changedFields: ["archivedAt"] };
    },
  });

  registerTransition(app, dependencies, {
    path: "unarchive",
    permission: "write",
    protectedVerb: "unarchived",
    auditAction: "unarchive",
    apply: (row) => {
      const next = { ...unarchive(row), updatedAt: nextRevision(row.updatedAt) };
      return { next, changedFields: ["archivedAt"] };
    },
  });

  registerTransition(app, dependencies, {
    path: "delete",
    permission: "purge",
    protectedVerb: "deleted",
    auditAction: "softDelete",
    apply: (row, entity) => {
      const now = nextRevision(row.updatedAt);
      const tombstone = softDelete(row, now);
      const deleted = { ...tombstone, updatedAt: tombstone.deletedAt ?? now };
      const next = entity === "resources" ? obfuscateResource(deleted as Resource) : deleted;
      return {
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
    apply: (row, entity, accountId, id) => {
      if (!canPurge(row, new Date().toISOString())) {
        throw new LifecycleResponseError(409, "Cannot purge: must be a soft-deleted tombstone at least 30 days old.");
      }
      if (!dependencies.store.purgeLifecycleRow(accountId, entity, id)) {
        throw new LifecycleResponseError(404, "Not found");
      }
      return null;
    },
  });
}
