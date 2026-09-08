import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AccountAuditPort, IdentityPort } from "@capacitylens/shared/account/ports";
import type { ApplicationSession } from "@capacitylens/shared/account/types";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { buildActorContextFromSession } from "../accounts/createLocalAccountFlows";
import type { AccountMode } from "../auth";
import { DEMO_USER } from "../auth";
import type { AppOptions } from "../app";
import type { MasqueradeRegistry, StoredMasqueradeRecord } from "../MasqueradeRegistry";
import type { resolveAppConfig } from "./appConfig";
import { resolveRequestClientIp } from "./appErrors";
import { buildSessionUser, hasRequiredSessionMfa, toWebHeaders } from "./appRequestAdapters";
import type { createAppRuntime } from "./appRuntime";
import { enqueueMasqueradeEndAudit } from "./masqueradeRoutes";

export interface ResolveIncomingSessionInput {
  req: FastifyRequest;
  force?: boolean | undefined;
}

interface InstallSessionResolutionInput {
  app: FastifyInstance;
  runtime: ReturnType<typeof createAppRuntime>;
  config: ReturnType<typeof resolveAppConfig>;
  options: AppOptions;
  securityEvent: (event: Record<string, unknown>) => void;
}

type SessionResolutionResult =
  | { kind: "absent_or_invalid" }
  | { kind: "verified"; session: ApplicationSession }
  | { kind: "backend_failure"; error: unknown };

interface CreateIncomingSessionResolverInput {
  authMode: AccountMode;
  identityPort: Pick<IdentityPort, "verifyApplicationSession">;
}

function createIncomingSessionResolver({ authMode, identityPort }: CreateIncomingSessionResolverInput) {
  const resolutions = new WeakMap<FastifyRequest, Promise<SessionResolutionResult>>();
  return ({ req, force = false }: ResolveIncomingSessionInput): Promise<SessionResolutionResult> => {
    const existing = resolutions.get(req);
    if (existing) return existing;
    const credentialsPresent = req.headers.cookie !== undefined || req.headers.authorization !== undefined;
    if (authMode === "off" || (!credentialsPresent && !force)) {
      return Promise.resolve({ kind: "absent_or_invalid" });
    }
    const resolution = Promise.resolve()
      .then(() => identityPort.verifyApplicationSession({ headers: toWebHeaders(req.headers) }))
      .then((session): SessionResolutionResult =>
        session ? { kind: "verified", session } : { kind: "absent_or_invalid" },
      )
      .catch((error: unknown): SessionResolutionResult => ({ kind: "backend_failure", error }));
    resolutions.set(req, resolution);
    return resolution;
  };
}

function attachVerifiedSession(req: FastifyRequest, session: ApplicationSession): void {
  req.session = session;
  req.user = buildSessionUser(session);
  req.accountActor = buildActorContextFromSession(session);
  req.authenticationProviderId = session.assurance === "federated" ? session.providerId : null;
}

function isPublicApiPath(path: string): boolean {
  return path === "/api/health" || path === "/api/security/csp-report";
}

function isMasqueradeWriteExempt(method: string, path: string): boolean {
  return (
    (method === "POST" && /^\/api\/accounts\/[^/]+\/masquerade$/.test(path)) ||
    (method === "DELETE" && path === "/api/masquerade") ||
    (method === "POST" && path === "/api/account/sign-out") ||
    (method === "POST" && path === "/api/auth/sign-out")
  );
}

function isUnauthenticatedApplicationPath(method: string, path: string): boolean {
  return (
    /^\/api\/invites\/[^/]+\/signup$/.test(path) ||
    (method === "GET" && /^\/api\/invites\/[^/]+\/preview$/.test(path)) ||
    (method === "POST" && path === "/api/account-commands/reconcile")
  );
}

interface EndMasqueradeInput {
  accountAudit: AccountAuditPort;
  applicationId: string;
  masquerades: MasqueradeRegistry;
  activeMasquerade: Readonly<StoredMasqueradeRecord>;
}

function endMasqueradeForSignOut(input: EndMasqueradeInput): void {
  input.masquerades.end(input.activeMasquerade.sessionHandle, null, (record) =>
    enqueueMasqueradeEndAudit({
      accountAudit: input.accountAudit,
      applicationId: input.applicationId,
      record,
      reason: "sign_out",
    }),
  );
}

function attachTrustedLocalActor(req: FastifyRequest): void {
  req.user = DEMO_USER;
  req.accountActor = {
    principalId: DEMO_USER.id,
    sessionId: "trusted-local",
    assurance: "trusted-local",
    fresh: true,
    mfaSatisfied: true,
  };
}

interface CreateSessionPreHandlerInput {
  accountAudit: AccountAuditPort;
  applicationId: string;
  authMode: AccountMode;
  masquerades: MasqueradeRegistry;
  requireMfa: boolean;
  resolveIncomingSession: (input: ResolveIncomingSessionInput) => Promise<SessionResolutionResult>;
  securityEvent: (event: Record<string, unknown>) => void;
  trustProxyHeaders: boolean;
}

interface ApplyMasqueradePolicyInput {
  dependencies: CreateSessionPreHandlerInput;
  path: string;
  reply: FastifyReply;
  req: FastifyRequest;
  resolution: SessionResolutionResult;
  unsafe: boolean;
}

async function applyMasqueradePolicy(input: ApplyMasqueradePolicyInput): Promise<boolean> {
  const { dependencies, path, reply, req, resolution, unsafe } = input;
  const activeMasquerade =
    resolution.kind === "verified" ? dependencies.masquerades.lookup(resolution.session.id) : null;
  if (activeMasquerade && unsafe && !isMasqueradeWriteExempt(req.method, path)) {
    dependencies.securityEvent({
      event: "authorization",
      outcome: "denied",
      action: "masquerade_read_only",
      userId: resolution.kind === "verified" ? resolution.session.principal.id : undefined,
      method: req.method,
      path,
    });
    await reply.code(403).send({ error: "Masquerade is read-only.", code: MASQUERADE_ERROR_CODES.readOnly });
    return true;
  }
  const signingOut =
    activeMasquerade && req.method === "POST" && (path === "/api/account/sign-out" || path === "/api/auth/sign-out");
  if (signingOut) {
    endMasqueradeForSignOut({
      accountAudit: dependencies.accountAudit,
      applicationId: dependencies.applicationId,
      masquerades: dependencies.masquerades,
      activeMasquerade,
    });
  }
  return false;
}

interface RequireApplicationSessionInput {
  dependencies: CreateSessionPreHandlerInput;
  path: string;
  reply: FastifyReply;
  req: FastifyRequest;
  resolution: SessionResolutionResult;
}

async function requireApplicationSession(input: RequireApplicationSessionInput): Promise<void> {
  const { dependencies, path, reply, req } = input;
  let { resolution } = input;
  if (resolution.kind === "absent_or_invalid") {
    resolution = await dependencies.resolveIncomingSession({ req, force: true });
    if (resolution.kind === "verified") attachVerifiedSession(req, resolution.session);
  }
  if (resolution.kind === "backend_failure") {
    req.log.error(resolution.error);
    await reply.code(503).send({ error: "Sign-in is temporarily unavailable." });
    return;
  }
  if (resolution.kind === "absent_or_invalid") {
    dependencies.securityEvent({
      event: "authentication_required",
      outcome: "blocked",
      method: req.method,
      path,
      remoteIp: resolveRequestClientIp({ request: req, trustProxyHeaders: dependencies.trustProxyHeaders }),
    });
    await reply.code(401).send({ error: "Sign in to continue." });
    return;
  }
  const user = buildSessionUser(resolution.session);
  if (dependencies.authMode === "password" && dependencies.requireMfa && !hasRequiredSessionMfa(resolution.session)) {
    dependencies.securityEvent({
      event: "mfa_required",
      outcome: "blocked",
      method: req.method,
      path,
      userId: user.id,
    });
    await reply.code(403).send({
      error: "Multi-factor authentication enrollment is required.",
      code: "MFA_ENROLLMENT_REQUIRED",
    });
  }
}

function createSessionPreHandler(dependencies: CreateSessionPreHandlerInput) {
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const path = req.url.split("?", 1)[0] ?? req.url;
    if (!path.startsWith("/api/") || isPublicApiPath(path)) return;
    let resolution = await dependencies.resolveIncomingSession({ req });
    if (resolution.kind === "verified") attachVerifiedSession(req, resolution.session);
    const unsafe = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    if (await applyMasqueradePolicy({ dependencies, path, reply, req, resolution, unsafe })) return;
    if (resolution.kind === "backend_failure" && unsafe) {
      req.log.error(resolution.error);
      await reply.code(503).send({ error: "Sign-in is temporarily unavailable." });
      return;
    }
    if (path.startsWith("/api/auth/") || isUnauthenticatedApplicationPath(req.method, path)) return;
    if (dependencies.authMode === "off") return attachTrustedLocalActor(req);
    await requireApplicationSession({ dependencies, path, reply, req, resolution });
  };
}

export function installSessionResolution({
  app,
  runtime,
  config,
  options,
  securityEvent,
}: InstallSessionResolutionInput) {
  app.decorateRequest("user", null);
  app.decorateRequest("accountActor", null);
  app.decorateRequest("authenticationUserId", null);
  app.decorateRequest("authenticationProviderId", null);
  app.decorateRequest("session", null);
  const resolveIncomingSession = createIncomingSessionResolver({
    authMode: config.authMode,
    identityPort: runtime.identityPort,
  });
  app.addHook(
    "preHandler",
    createSessionPreHandler({
      accountAudit: runtime.accountAudit,
      applicationId: config.application.applicationId,
      authMode: config.authMode,
      masquerades: runtime.masquerades,
      requireMfa: options.requireMfa === true,
      resolveIncomingSession,
      securityEvent,
      trustProxyHeaders: options.trustProxyHeaders === true,
    }),
  );

  return { resolveIncomingSession };
}
