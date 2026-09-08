import type { EffectiveRoleResult } from "./appAuthorization";
import type { AuthorizeBasicInput } from "./routeShared";
import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccountMode, Role } from "@capacitylens/shared/account/types";
import type { AccountAuditPort, IdentityPort } from "@capacitylens/shared/account/ports";
import {
  MASQUERADE_ERROR_CODES,
  type MasqueradeEndReason,
  type MasqueradeState,
} from "@capacitylens/shared/domain/masquerade";
import { cleanText } from "@capacitylens/shared/lib/strings";
import {
  MasqueradeAlreadyActiveError,
  MasqueradeRegistry,
  type MasqueradeRecord,
  type StoredMasqueradeRecord,
} from "../MasqueradeRegistry";

/** Dependencies required by the session-scoped masquerade HTTP adapter. */
export interface MasqueradeRouteDependencies {
  authMode: AccountMode;
  applicationId: string;
  accountAudit: AccountAuditPort;
  registry: MasqueradeRegistry;
  identity: IdentityPort;
  authorize(input: AuthorizeBasicInput): boolean;
  roleForPrincipal(principalId: string, accountId: string): Role | null;
  effectiveRole(request: FastifyRequest, accountId: string): EffectiveRoleResult;
}

interface EnqueueMasqueradeEndAuditInput {
  accountAudit: AccountAuditPort;
  applicationId: string;
  record: Readonly<StoredMasqueradeRecord>;
  reason: MasqueradeEndReason;
}

/** Construct the durable lifecycle event written before any registry state change. */
export function enqueueMasqueradeEndAudit({
  accountAudit,
  applicationId,
  record,
  reason,
}: EnqueueMasqueradeEndAuditInput): void {
  const occurredAt = new Date().toISOString();
  accountAudit.append({
    id: randomUUID(),
    occurredAt,
    applicationId,
    workspaceId: record.accountId,
    actorPrincipalId: record.userId,
    targetPrincipalId: record.targetUserId,
    commandId: null,
    action: "identity.masquerade_ended",
    outcome: "success",
    changedFields: ["masquerade"],
    reason,
  });
}

async function readMasqueradeState(
  record: Readonly<MasqueradeRecord>,
  identity: IdentityPort,
  effectiveRole: Role,
): Promise<MasqueradeState> {
  const [target] = await identity.getPrincipalSummaries({
    principalIds: [record.targetUserId],
  });
  const targetName = cleanText(target?.displayName ?? target?.email ?? "Member");
  return {
    accountId: record.accountId,
    targetUserId: record.targetUserId,
    targetName,
    effectiveRole,
    startedAt: record.startedAt,
    token: record.token,
  };
}

function readTargetUserId(body: unknown): string | null {
  const { targetUserId } = (body ?? {}) as { targetUserId?: unknown };
  return typeof targetUserId === "string" && targetUserId.length > 0 ? targetUserId : null;
}

function registerMasqueradeStartRoute(app: FastifyInstance, dependencies: MasqueradeRouteDependencies): void {
  const { authMode, applicationId, accountAudit, registry, identity, authorize, roleForPrincipal } = dependencies;

  app.post("/api/accounts/:accountId/masquerade", async (request, reply) => {
    const session = request.session;
    if (session && registry.lookup(session.id)) {
      return reply
        .code(409)
        .send({ error: "This session is already masquerading.", code: MASQUERADE_ERROR_CODES.active });
    }
    if (authMode === "off" || !session) return reply.code(403).send({ error: "Forbidden." });
    const { accountId } = request.params as { accountId: string };
    if (!authorize({ req: request, reply, accountId, action: "masquerade" })) return;
    const targetUserId = readTargetUserId(request.body);
    if (targetUserId === null) {
      return reply.code(400).send({ error: "targetUserId must be a non-empty string." });
    }
    if (targetUserId === session.principal.id) {
      return reply.code(400).send({ error: "You cannot masquerade as yourself." });
    }
    const effectiveRole = roleForPrincipal(targetUserId, accountId);
    if (effectiveRole === null) return reply.code(404).send({ error: "Member not found." });
    if (session.expiresAt === null) {
      return reply.code(503).send({ error: "The session expiry could not be verified." });
    }
    const record: MasqueradeRecord = {
      sessionHandle: session.id,
      userId: session.principal.id,
      accountId,
      targetUserId,
      token: randomBytes(32).toString("base64url"),
      startedAt: new Date().toISOString(),
      expiresAt: session.expiresAt,
    };
    try {
      registry.start(record, (pending) => {
        accountAudit.append({
          id: randomUUID(),
          occurredAt: pending.startedAt,
          applicationId,
          workspaceId: pending.accountId,
          actorPrincipalId: pending.userId,
          targetPrincipalId: pending.targetUserId,
          commandId: null,
          action: "identity.masquerade_started",
          outcome: "success",
          changedFields: ["masquerade"],
          expiresAt: pending.expiresAt,
        });
      });
    } catch (error) {
      if (error instanceof MasqueradeAlreadyActiveError) {
        return reply.code(409).send({ error: error.message, code: MASQUERADE_ERROR_CODES.active });
      }
      throw error;
    }
    return reply.code(200).send(await readMasqueradeState(record, identity, effectiveRole));
  });
}

function registerMasqueradeStatusRoute(app: FastifyInstance, dependencies: MasqueradeRouteDependencies): void {
  const { authMode, registry, identity, effectiveRole } = dependencies;
  app.get("/api/masquerade", async (request, reply) => {
    if (authMode === "off") return reply.code(403).send({ error: "Forbidden." });
    const session = request.session;
    if (!session) return reply.code(401).send({ error: "Sign in to continue." });
    const record = registry.lookup(session.id);
    if (!record) return { active: false };
    const resolved = effectiveRole(request, record.accountId);
    if (resolved.kind === "ended") {
      return reply.code(403).send({ error: "Masquerade ended.", code: MASQUERADE_ERROR_CODES.ended });
    }
    if (resolved.role === null) return reply.code(403).send({ error: "Forbidden." });
    return { active: true, ...(await readMasqueradeState(record, identity, resolved.role)) };
  });
}

function registerMasqueradeEndRoute(app: FastifyInstance, dependencies: MasqueradeRouteDependencies): void {
  const { authMode, applicationId, accountAudit, registry } = dependencies;
  const auditEnd = (record: Readonly<StoredMasqueradeRecord>, reason: MasqueradeEndReason): void =>
    enqueueMasqueradeEndAudit({ accountAudit, applicationId, record, reason });
  app.delete("/api/masquerade", async (request, reply) => {
    if (authMode === "off") return reply.code(403).send({ error: "Forbidden." });
    const body = (request.body ?? {}) as { token?: unknown; reason?: unknown };
    if (
      typeof body.token !== "string" ||
      body.token.length === 0 ||
      (body.reason !== "explicit" && body.reason !== "account_switch")
    ) {
      return reply.code(400).send({ error: "A valid token and end reason are required." });
    }
    const reason = body.reason;
    if (request.session) {
      registry.end(request.session.id, body.token, (record) => auditEnd(record, reason));
    }
    return reply.code(204).send();
  });
}

/** Register the start, status, and idempotent end endpoints. */
export function registerMasqueradeRoutes(app: FastifyInstance, dependencies: MasqueradeRouteDependencies): void {
  registerMasqueradeStartRoute(app, dependencies);
  registerMasqueradeStatusRoute(app, dependencies);
  registerMasqueradeEndRoute(app, dependencies);
}
