import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import type { ApplicationSession } from "@capacitylens/shared/account/types";
import { can } from "@capacitylens/shared/domain/access";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";

import { countUsers, DEMO_USER } from "../auth";
import type { AccountMode, Auth, SessionUser } from "../auth";
import type { MasqueradeRegistry } from "../MasqueradeRegistry";
import { countAccounts, isAccountCreateCapped } from "./accountEntityRoutes";
import type { ResolveIncomingSessionInput } from "./appSessionResolution";

type SessionResolutionResult =
  | { kind: "absent_or_invalid" }
  | { kind: "verified"; session: ApplicationSession }
  | { kind: "backend_failure"; error: unknown };

/** Build the absolute URL Better Auth requires from Fastify's relative request URL. Host is
 * proxy/client input, so malformed authority syntax is a bounded caller error, not an exception. */
function parseAuthenticationRequestUrl(req: FastifyRequest): URL | null {
  try {
    return new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  } catch {
    return null;
  }
}

/** CapacityLens's complete public seam into Better Auth. New dependency routes remain closed until
 * they are deliberately classified here and covered by the application's own policy surface. */
function isBetterAuthProxyRouteAllowed(
  authMode: Exclude<AccountMode, "off">,
  method: string,
  pathname: string,
): boolean {
  const common = new Set(["GET /get-session", "POST /sign-out", "POST /sign-in/oauth2", "POST /sign-in/social"]);
  if (common.has(`${method} ${pathname}`)) return true;
  if (
    (method === "GET" || method === "POST") &&
    (/^\/oauth2\/callback\/[a-z0-9_-]+$/.test(pathname) || /^\/callback\/[a-z0-9_-]+$/.test(pathname))
  ) {
    return true;
  }
  if (method === "GET" && /^\/oidc\/authorize\/[a-z0-9_-]+$/.test(pathname)) return true;
  if (authMode !== "password") return false;
  return new Set([
    "POST /sign-up/email",
    "POST /sign-in/email",
    "POST /reset-password",
    "POST /change-password",
    "POST /two-factor/enable",
    "POST /two-factor/disable",
    "POST /two-factor/generate-backup-codes",
    "POST /two-factor/verify-totp",
    "POST /two-factor/verify-backup-code",
  ]).has(`${method} ${pathname}`);
}

interface ResolveAuthenticationUserIdInput {
  auth: Auth;
  headers: Headers;
  req: FastifyRequest;
  logOn: boolean;
}

/** Resolve only an already-issued, verified session for security-event attribution. Submitted
 * identifiers are intentionally never used: a failed sign-in must not be able to claim a user. */
async function resolveAuthenticationUserId({
  auth,
  headers,
  req,
  logOn,
}: ResolveAuthenticationUserIdInput): Promise<string | null> {
  try {
    return (await auth.api.getSession({ headers }))?.user.id ?? null;
  } catch (error) {
    if (logOn) req.log.error(error, "authentication security-event attribution failed");
    else console.error("capacitylens-server: authentication security-event attribution failed", error);
    return null;
  }
}

/** Turn Set-Cookie response fields into the Cookie header used to verify a newly issued session.
 * Response values replace request values with the same name (for example an MFA challenge cookie
 * replaced by the final session cookie); attributes never cross into the request header. */
function withResponseCookies(requestHeaders: Headers, setCookies: readonly string[]): Headers {
  const cookies = new Map<string, string>();
  for (const pair of (requestHeaders.get("cookie") ?? "").split(";")) {
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    if (name) cookies.set(name, pair.slice(separator + 1).trim());
  }
  for (const setCookie of setCookies) {
    const pair = setCookie.split(";", 1)[0];
    if (!pair) continue;
    const separator = pair.indexOf("=");
    if (separator < 1) continue;
    const name = pair.slice(0, separator).trim();
    if (!name) continue;
    const value = pair.slice(separator + 1).trim();
    if (value) cookies.set(name, value);
    else cookies.delete(name);
  }
  const headers = new Headers(requestHeaders);
  if (cookies.size > 0) headers.set("cookie", [...cookies].map(([name, value]) => `${name}=${value}`).join("; "));
  else headers.delete("cookie");
  return headers;
}

interface CanUserCreateAccountInput {
  administration: AccountAdminPort;
  authMode: AccountMode;
  userId: string;
  count: number;
}

async function canUserCreateAccount({
  administration,
  authMode,
  userId,
  count,
}: CanUserCreateAccountInput): Promise<boolean> {
  return (
    count === 0 ||
    authMode === "off" ||
    (await administration.listWorkspacesForPrincipal({ principalId: userId })).some((membership) =>
      can(membership.role, "manageMembers"),
    )
  );
}

/** Capabilities required to expose the identity endpoint or the Better Auth proxy seam. */
export interface AuthProxyRouteDependencies {
  section: "identity" | "proxy";
  authMode: AccountMode;
  auth: Auth | null;
  db: Parameters<typeof countAccounts>[0];
  multiAccount: boolean;
  requireMfa: boolean;
  accountAdminPort: AccountAdminPort;
  masquerades: MasqueradeRegistry;
  resolveIncomingSession: (input: ResolveIncomingSessionInput) => Promise<SessionResolutionResult>;
  sessionUserFromApplicationSession: (session: ApplicationSession) => SessionUser;
  sessionSatisfiesRequiredMfa: (session: ApplicationSession) => boolean;
  toWebHeaders: (raw: FastifyRequest["headers"]) => Headers;
  logOn: boolean;
}

interface IdentityRouteDependencies {
  accountAdminPort: AccountAdminPort;
  auth: Auth | null;
  authMode: AccountMode;
  db: Parameters<typeof countAccounts>[0];
  masquerades: MasqueradeRegistry;
  multiAccount: boolean;
  requireMfa: boolean;
  resolveIncomingSession: (input: ResolveIncomingSessionInput) => Promise<SessionResolutionResult>;
  sessionSatisfiesRequiredMfa: (session: ApplicationSession) => boolean;
  sessionUserFromApplicationSession: (session: ApplicationSession) => SessionUser;
}

interface ProxyRouteDependencies {
  auth: Auth | null;
  authMode: AccountMode;
  logOn: boolean;
  masquerades: MasqueradeRegistry;
  resolveIncomingSession: (input: ResolveIncomingSessionInput) => Promise<SessionResolutionResult>;
  toWebHeaders: (raw: FastifyRequest["headers"]) => Headers;
}

interface CanAuthenticatedUserCreateAccountInput {
  dependencies: IdentityRouteDependencies;
  session: ApplicationSession;
  userId: string;
  capAllows: boolean;
}

async function canAuthenticatedUserCreateAccount({
  dependencies,
  session,
  userId,
  capAllows,
}: CanAuthenticatedUserCreateAccountInput): Promise<boolean> {
  const { accountAdminPort, auth, authMode, db, masquerades } = dependencies;
  // The capability mirrors POST /api/orgs: masquerades and untrusted SSO sessions fail closed,
  // then both the account cap and workspace authority must allow creation.
  const trustedSsoSession =
    authMode !== "sso" || (session.assurance === "federated" && session.providerId === auth?.strictProvider?.id);
  if (masquerades.lookup(session.id) !== undefined || !capAllows || !trustedSsoSession) return false;
  return canUserCreateAccount({
    administration: accountAdminPort,
    authMode,
    userId,
    count: countAccounts(db),
  });
}

async function readAuthenticatedIdentity(
  dependencies: IdentityRouteDependencies,
  session: ApplicationSession,
  capAllows: boolean,
) {
  const { auth, authMode, multiAccount, requireMfa } = dependencies;
  const user = dependencies.sessionUserFromApplicationSession(session);
  const canCreateAccount = await canAuthenticatedUserCreateAccount({
    dependencies,
    session,
    userId: user.id,
    capAllows,
  });
  return {
    authMode,
    user,
    mfaRequired: authMode === "password" && requireMfa && !dependencies.sessionSatisfiesRequiredMfa(session),
    reauthMethod: session.assurance === "federated" ? "provider" : "password",
    reauthProviderId: session.providerId ?? null,
    providers: auth?.providers ?? [],
    multiAccount,
    canCreateAccount,
  };
}

async function sendIdentity(req: FastifyRequest, reply: FastifyReply, dependencies: IdentityRouteDependencies) {
  const { auth, authMode, db, multiAccount, resolveIncomingSession } = dependencies;
  const capAllows = !isAccountCreateCapped({ db, multiAccount });
  if (authMode === "off") {
    return { authMode, user: DEMO_USER, providers: [], multiAccount, canCreateAccount: capAllows };
  }
  const resolution = await resolveIncomingSession({ req, force: true });
  if (resolution.kind === "absent_or_invalid") {
    // Zero users is only a bootstrap-availability signal; no tenant facts enter the 401 response.
    const needsSetup = authMode === "password" && countUsers(db) === 0;
    return reply.code(401).send({
      authMode,
      providers: auth?.providers ?? [],
      error: "Sign in to continue.",
      ...(needsSetup ? { needsSetup: true } : {}),
    });
  }
  if (resolution.kind === "backend_failure") {
    req.log.error(resolution.error);
    return reply.code(503).send({ authMode, error: "Sign-in is temporarily unavailable." });
  }
  try {
    return await readAuthenticatedIdentity(dependencies, resolution.session, capAllows);
  } catch (error) {
    // Backend failure is distinct from an absent session and must retain its 503 surface.
    req.log.error(error);
    return reply.code(503).send({ authMode, error: "Sign-in is temporarily unavailable." });
  }
}

function registerIdentityRoute(app: FastifyInstance, dependencies: IdentityRouteDependencies): void {
  app.get("/api/auth/me", (req, reply) => sendIdentity(req, reply, dependencies));
}

function isMasqueradeWrite(req: FastifyRequest, authPath: string, masquerades: MasqueradeRegistry): boolean {
  return (
    req.method === "POST" &&
    authPath !== "/sign-out" &&
    req.session !== null &&
    masquerades.lookup(req.session.id) !== undefined
  );
}

async function sendProxyResponse(reply: FastifyReply, response: Response, cookies: readonly string[]) {
  reply.status(response.status);
  response.headers.forEach((value, key) => {
    if (key === "set-cookie" || key === "content-length" || key === "transfer-encoding") return;
    reply.header(key, value);
  });
  if (cookies.length > 0) reply.header("set-cookie", cookies);
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  return reply.send(body);
}

function hasAuthenticationCredentials(headers: Headers): boolean {
  return headers.has("cookie") || headers.has("authorization");
}

function shouldResolveIssuedSession(req: FastifyRequest, response: Response, cookies: readonly string[]): boolean {
  return req.authenticationUserId === null && response.status < 400 && cookies.length > 0;
}

async function forwardAuthenticationRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  dependencies: ProxyRouteDependencies,
) {
  const { auth, authMode, logOn, masquerades, resolveIncomingSession, toWebHeaders } = dependencies;
  if (authMode === "off" || !auth) return reply.code(404).send({ error: "Not found." });
  const url = parseAuthenticationRequestUrl(req);
  if (!url) return reply.code(400).send({ error: "Invalid request authority." });
  const authPath = url.pathname.slice("/api/auth".length);
  if (!isBetterAuthProxyRouteAllowed(authMode, req.method, authPath)) {
    return reply.code(404).send({ error: "Not found." });
  }
  if (isMasqueradeWrite(req, authPath, masquerades)) {
    return reply.code(403).send({ error: "Masquerade is read-only.", code: MASQUERADE_ERROR_CODES.readOnly });
  }
  const requestHeaders = toWebHeaders(req.headers);
  if (hasAuthenticationCredentials(requestHeaders)) {
    const incoming = await resolveIncomingSession({ req });
    req.authenticationUserId = incoming.kind === "verified" ? incoming.session.principal.id : null;
  }
  const response = await auth.handler(
    new Request(url, {
      method: req.method,
      headers: requestHeaders,
      ...(req.body === undefined || req.body === null ? {} : { body: JSON.stringify(req.body) }),
    }),
  );
  const cookies = response.headers.getSetCookie();
  if (shouldResolveIssuedSession(req, response, cookies)) {
    req.authenticationUserId = await resolveAuthenticationUserId({
      auth,
      headers: withResponseCookies(requestHeaders, cookies),
      req,
      logOn,
    });
  }
  return sendProxyResponse(reply, response, cookies);
}

function registerProxyRoute(app: FastifyInstance, dependencies: ProxyRouteDependencies): void {
  // Off mode mounts no vendor wildcard, preserving its zero-additional-auth-surface guarantee.
  if (dependencies.authMode === "off" || !dependencies.auth) return;
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: (req, reply) => forwardAuthenticationRequest(req, reply, dependencies),
  });
}

/** Register either the identity endpoint or the closed Better Auth proxy seam. */
export function registerAuthProxyRoutes(app: FastifyInstance, dependencies: AuthProxyRouteDependencies): void {
  if (dependencies.section === "identity") registerIdentityRoute(app, dependencies);
  else registerProxyRoute(app, dependencies);
}
