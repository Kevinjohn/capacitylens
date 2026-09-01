import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountMode, Role } from "@capacitylens/shared/account/types";
import type { AccountAuditPort, IdentityPort } from "@capacitylens/shared/account/ports";
import {
  MASQUERADE_ERROR_CODES,
  type ClientMasqueradeEndReason,
  type MasqueradeEndReason,
  type MasqueradeState,
} from "@capacitylens/shared/domain/masquerade";
import type { Action } from "@capacitylens/shared/domain/access";
import { cleanText } from "@capacitylens/shared/lib/strings";
import {
  MasqueradeAlreadyActiveError,
  MasqueradeRegistry,
  type MasqueradeRecord,
  type StoredMasqueradeRecord,
} from "../masqueradeRegistry";

/** Dependencies required by the session-scoped masquerade HTTP adapter. */
export interface MasqueradeRouteDependencies {
  authMode: AccountMode;
  applicationId: string;
  accountAudit: AccountAuditPort;
  registry: MasqueradeRegistry;
  identity: IdentityPort;
  authorize(request: FastifyRequest, reply: FastifyReply, accountId: string, action: Action): boolean;
  roleForPrincipal(principalId: string, accountId: string): Role | null;
  effectiveRole(request: FastifyRequest, accountId: string): { role: Role | null; ended: boolean };
}

/** Construct the durable lifecycle event written before any registry state change. */
export function enqueueMasqueradeEndAudit(
  accountAudit: AccountAuditPort,
  applicationId: string,
  record: Readonly<StoredMasqueradeRecord>,
  reason: MasqueradeEndReason,
): void {
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

async function stateForRecord(
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

/** Register the start, status, and idempotent end endpoints. */
export function registerMasqueradeRoutes(app: FastifyInstance, dependencies: MasqueradeRouteDependencies): void {
  const { authMode, applicationId, accountAudit, registry, identity, authorize, roleForPrincipal, effectiveRole } =
    dependencies;
  const auditEnd = (record: Readonly<StoredMasqueradeRecord>, reason: MasqueradeEndReason): void =>
    enqueueMasqueradeEndAudit(accountAudit, applicationId, record, reason);

  app.post("/api/accounts/:accountId/masquerade", async (request, reply) => {
    const session = request.session;
    if (session && registry.lookup(session.id)) {
      return reply
        .code(409)
        .send({ error: "This session is already masquerading.", code: MASQUERADE_ERROR_CODES.active });
    }
    if (authMode === "off" || !session) return reply.code(403).send({ error: "Forbidden." });
    const { accountId } = request.params as { accountId: string };
    if (!authorize(request, reply, accountId, "masquerade")) return;
    const body = (request.body ?? {}) as { targetUserId?: unknown };
    if (typeof body.targetUserId !== "string" || body.targetUserId.length === 0) {
      return reply.code(400).send({ error: "targetUserId must be a non-empty string." });
    }
    if (body.targetUserId === session.principal.id) {
      return reply.code(400).send({ error: "You cannot masquerade as yourself." });
    }
    const effectiveRole = roleForPrincipal(body.targetUserId, accountId);
    if (effectiveRole === null) return reply.code(404).send({ error: "Member not found." });
    if (session.expiresAt === null) {
      return reply.code(503).send({ error: "The session expiry could not be verified." });
    }
    const record: MasqueradeRecord = {
      sessionHandle: session.id,
      userId: session.principal.id,
      accountId,
      targetUserId: body.targetUserId,
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
    return reply.code(200).send(await stateForRecord(record, identity, effectiveRole));
  });

  app.get("/api/masquerade", async (request, reply) => {
    if (authMode === "off") return reply.code(403).send({ error: "Forbidden." });
    const session = request.session;
    if (!session) return reply.code(401).send({ error: "Sign in to continue." });
    const record = registry.lookup(session.id);
    if (!record) return { active: false };
    const resolved = effectiveRole(request, record.accountId);
    if (resolved.ended) {
      return reply.code(403).send({ error: "Masquerade ended.", code: MASQUERADE_ERROR_CODES.ended });
    }
    if (resolved.role === null) return reply.code(403).send({ error: "Forbidden." });
    return { active: true, ...(await stateForRecord(record, identity, resolved.role)) };
  });

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
    const reason = body.reason as ClientMasqueradeEndReason;
    if (request.session) {
      registry.end(request.session.id, body.token, (record) => auditEnd(record, reason));
    }
    return reply.code(204).send();
  });
}
