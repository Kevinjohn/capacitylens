import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DEMO_USER } from "../auth";
import { type ApplicationSession } from "@capacitylens/shared/account/types";
import { actorContextFromSession } from "../accounts/localAccountFlows";
import { enqueueMasqueradeEndAudit } from "./masqueradeRoutes";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";
import { toWebHeaders, sessionUserFromApplicationSession, sessionSatisfiesRequiredMfa } from "./appRequestAdapters";
import { requestClientIp } from "./appErrors";
import type { resolveAppConfig } from "./appConfig";
import type { createAppRuntime } from "./appRuntime";
import type { AppOptions } from "../app";

export function installSessionResolution(
  app: FastifyInstance,
  runtime: ReturnType<typeof createAppRuntime>,
  config: ReturnType<typeof resolveAppConfig>,
  opts: AppOptions,
  securityEvent: (event: Record<string, unknown>) => void,
) {
  const { accountAudit, identityPort, masquerades } = runtime;
  const { application, authMode } = config;
  // requireUser — ONE gate for everything under /api/ except /api/health (the
  // uptime monitor has no session) and /api/auth/* (the login machinery itself; our
  // /api/auth/me handles its own 401). Root-level so child routes inherit it; preHandler
  // only fires for MATCHED routes, so 404s and the CORS preflight 204 are unaffected.
  // 'off' attaches the synthetic demo identity and continues — no request that succeeds
  // today may fail. Other modes resolve the Better Auth session or 401.
  app.decorateRequest("user", null);
  app.decorateRequest("accountActor", null);
  app.decorateRequest("authenticationUserId", null);
  app.decorateRequest("authenticationProviderId", null);
  app.decorateRequest("session", null);
  type SessionResolution =
    | { kind: "absent_or_invalid" }
    | { kind: "verified"; session: ApplicationSession }
    | { kind: "backend_failure"; error: unknown };
  const incomingSessionResolutions = new WeakMap<FastifyRequest, Promise<SessionResolution>>();
  const resolveIncomingSession = (req: FastifyRequest, force = false): Promise<SessionResolution> => {
    const existing = incomingSessionResolutions.get(req);
    if (existing) return existing;
    const credentialsPresent = req.headers.cookie !== undefined || req.headers.authorization !== undefined;
    if (authMode === "off" || (!credentialsPresent && !force)) {
      return Promise.resolve({ kind: "absent_or_invalid" });
    }
    const resolution = (async (): Promise<SessionResolution> => {
      try {
        const session = await identityPort!.verifyApplicationSession({ headers: toWebHeaders(req.headers) });
        return session ? { kind: "verified", session } : { kind: "absent_or_invalid" };
      } catch (error) {
        return { kind: "backend_failure", error };
      }
    })();
    incomingSessionResolutions.set(req, resolution);
    return resolution;
  };
  const attachVerifiedSession = (req: FastifyRequest, session: ApplicationSession): void => {
    const user = sessionUserFromApplicationSession(session);
    req.session = session;
    req.user = user;
    req.accountActor = actorContextFromSession(session);
    req.authenticationProviderId = session.assurance === "federated" ? session.providerId : null;
  };
  app.addHook("preHandler", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = req.url.split("?", 1)[0];
    if (!path.startsWith("/api/") || path === "/api/health" || path === "/api/security/csp-report") return;
    let resolution = await resolveIncomingSession(req);
    if (resolution.kind === "verified") attachVerifiedSession(req, resolution.session);
    const activeMasquerade = resolution.kind === "verified" ? masquerades.lookup(resolution.session.id) : null;
    const unsafe = req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS";
    const masqueradeExempt =
      activeMasquerade && unsafe
        ? (req.method === "POST" && /^\/api\/accounts\/[^/]+\/masquerade$/.test(path)) ||
          (req.method === "DELETE" && path === "/api/masquerade") ||
          (req.method === "POST" && path === "/api/account/sign-out") ||
          (req.method === "POST" && path === "/api/auth/sign-out")
        : false;
    if (activeMasquerade && unsafe && !masqueradeExempt) {
      securityEvent({
        event: "authorization",
        outcome: "denied",
        action: "masquerade_read_only",
        userId: resolution.kind === "verified" ? resolution.session.principal.id : undefined,
        method: req.method,
        path,
      });
      return reply.code(403).send({
        error: "Masquerade is read-only.",
        code: MASQUERADE_ERROR_CODES.readOnly,
      });
    }
    const signingOut =
      activeMasquerade && req.method === "POST" && (path === "/api/account/sign-out" || path === "/api/auth/sign-out");
    if (signingOut) {
      masquerades.end(activeMasquerade.sessionHandle, null, (record) =>
        enqueueMasqueradeEndAudit(accountAudit, application.applicationId, record, "sign_out"),
      );
    }
    if (resolution.kind === "backend_failure" && unsafe) {
      req.log.error(resolution.error);
      return reply.code(503).send({ error: "Sign-in is temporarily unavailable." });
    }
    if (path.startsWith("/api/auth/")) return;
    // A genuinely new password user has no session yet. Signup is authorized by the unexpired
    // single-use invite bearer token. Preview is also bearer-authorized and returns only the company
    // display name, proposed role and expiry — never tenant rows, members or identity facts.
    if (/^\/api\/invites\/[^/]+\/signup$/.test(path)) return;
    if (req.method === "GET" && /^\/api\/invites\/[^/]+\/preview$/.test(path)) return;
    if (req.method === "POST" && path === "/api/account-commands/reconcile") return;
    if (authMode === "off") {
      req.user = DEMO_USER;
      req.accountActor = {
        principalId: DEMO_USER.id,
        sessionId: "trusted-local",
        assurance: "trusted-local",
        fresh: true,
        mfaSatisfied: true,
      };
      return;
    }
    if (resolution.kind === "absent_or_invalid") {
      resolution = await resolveIncomingSession(req, true);
      if (resolution.kind === "verified") attachVerifiedSession(req, resolution.session);
    }
    if (resolution.kind === "backend_failure") {
      req.log.error(resolution.error);
      return reply.code(503).send({ error: "Sign-in is temporarily unavailable." });
    }
    if (resolution.kind === "absent_or_invalid") {
      securityEvent({
        event: "authentication_required",
        outcome: "blocked",
        method: req.method,
        path,
        remoteIp: requestClientIp(req, opts.trustProxyHeaders === true),
      });
      return reply.code(401).send({ error: "Sign in to continue." });
    }
    const session = resolution.session;
    const user = sessionUserFromApplicationSession(session);
    if (authMode === "password" && opts.requireMfa === true && !sessionSatisfiesRequiredMfa(session)) {
      securityEvent({
        event: "mfa_required",
        outcome: "blocked",
        method: req.method,
        path,
        userId: user.id,
      });
      return reply.code(403).send({
        error: "Multi-factor authentication enrollment is required.",
        code: "MFA_ENROLLMENT_REQUIRED",
      });
    }
  });

  return { resolveIncomingSession };
}
