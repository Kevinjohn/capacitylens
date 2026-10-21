import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { allowsPasswordSignIn, allowsProviderSignIn } from "@capacitylens/shared/account/types";
import type { ApplicationSession } from "@capacitylens/shared/account/types";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";

import type { AccountMode, Auth } from "../auth";
import type { MasqueradeRegistry } from "../MasqueradeRegistry";
import type { ResolveIncomingSessionInput } from "./appSessionResolution";
import { REPLY_ERRORS } from "./replyErrors";

type SessionResolutionResult =
  | { kind: "absent_or_invalid" }
  | { kind: "verified"; session: ApplicationSession }
  | { kind: "backend_failure"; error: unknown };

// Malformed client or proxy Host input cannot establish an auth request URL.
function parseAuthenticationRequestUrl(req: FastifyRequest): URL | null {
  try {
    return new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  } catch {
    return null;
  }
}

// Expose only classified Better Auth routes; new library endpoints remain closed by default.
function isBetterAuthProxyRouteAllowed(
  policy: { authMode: Exclude<AccountMode, "off">; mailEnabled: boolean },
  method: string,
  pathname: string,
): boolean {
  const { authMode, mailEnabled } = policy;
  const common = new Set(["GET /get-session", "POST /sign-out", "POST /sign-in/social"]);
  if (common.has(`${method} ${pathname}`)) {
    return pathname !== "/sign-in/social" || allowsProviderSignIn(authMode);
  }
  if ((method === "GET" || method === "POST") && /^\/callback\/[a-z0-9_-]+$/.test(pathname)) {
    return allowsProviderSignIn(authMode);
  }
  if (!allowsPasswordSignIn(authMode)) return false;
  if (method === "POST" && pathname === "/request-password-reset") return mailEnabled;
  return new Set(["POST /sign-up/email", "POST /sign-in/email", "POST /reset-password", "POST /change-password"]).has(
    `${method} ${pathname}`,
  );
}

interface ResolveAuthenticationUserIdInput {
  auth: Auth;
  headers: Headers;
  req: FastifyRequest;
  logOn: boolean;
}

// Attribute security events to resolved sessions, never submitted identity fields.
async function resolveAuthenticationUserId({
  auth,
  headers,
  req,
  logOn,
}: ResolveAuthenticationUserIdInput): Promise<string | null> {
  try {
    return (await auth.api.getSession({ headers }))?.user.id ?? null;
  } catch (error) {
    // Log failed telemetry attribution and leave the actor unknown; submitted identifiers must never substitute for a resolved session.
    if (logOn) req.log.error(error, "authentication security-event attribution failed");
    else console.error("capacitylens-server: authentication security-event attribution failed", error);
    return null;
  }
}

// Response cookies replace request-cookie values by name without copying Set-Cookie attributes.
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

/** Dependencies required to forward the explicitly classified Better Auth HTTP surface. */
export interface AuthProxyRouteDependencies {
  authMode: AccountMode;
  auth: Auth | null;
  masquerades: MasqueradeRegistry;
  resolveIncomingSession: (input: ResolveIncomingSessionInput) => Promise<SessionResolutionResult>;
  toWebHeaders: (raw: FastifyRequest["headers"]) => Headers;
  logOn: boolean;
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
  response.headers.forEach((value, key) => {
    if (key === "set-cookie" || key === "content-length" || key === "transfer-encoding") return;
    reply.header(key, value);
  });
  if (cookies.length > 0) reply.header("set-cookie", cookies);
  const body = response.body ? Buffer.from(await response.arrayBuffer()) : null;
  return reply.code(response.status).send(body);
}

function hasAuthenticationCredentials(headers: Headers): boolean {
  return headers.has("cookie") || headers.has("authorization");
}

function shouldResolveIssuedSession(req: FastifyRequest, response: Response, cookies: readonly string[]): boolean {
  return req.authenticationUserId === null && response.status < 400 && cookies.length > 0;
}

function submitsDirectMicrosoftIdToken(req: FastifyRequest, authPath: string): boolean {
  if (authPath !== "/sign-in/social" || req.method !== "POST") return false;
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return false;
  const social = body as Record<string, unknown>;
  return social.provider === "microsoft" && (social.idToken !== undefined || social.id_token !== undefined);
}

function rejectsNonCompanySocialSignIn(input: {
  req: FastifyRequest;
  authPath: string;
  auth: Auth;
  authMode: AccountMode;
}): boolean {
  const { req, authPath, auth, authMode } = input;
  if (authMode !== "sso-only" || authPath !== "/sign-in/social" || req.method !== "POST") return false;
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return true;
  const providerId = (body as Record<string, unknown>).provider;
  return typeof providerId !== "string" || !auth.permittedCompanyProviderIds?.has(providerId);
}

function socialSignInError(input: { req: FastifyRequest; authPath: string; auth: Auth; authMode: AccountMode }): {
  status: number;
  error: string;
  code: string;
} | null {
  const { req, authPath, auth, authMode } = input;
  if (submitsDirectMicrosoftIdToken(req, authPath)) {
    return {
      status: 400,
      error: REPLY_ERRORS.microsoftCallbackRequired,
      code: "CODE_FLOW_REQUIRED",
    };
  }
  if (rejectsNonCompanySocialSignIn({ req, authPath, auth, authMode })) {
    return { status: 403, error: REPLY_ERRORS.companyProviderRequired, code: "COMPANY_PROVIDER_REQUIRED" };
  }
  return null;
}

function collectProxyCookies(input: { auth: Auth; authPath: string; response: Response; headers: Headers }): string[] {
  const { auth, authPath, response, headers } = input;
  const cookies = response.headers.getSetCookie();
  if (authPath === "/sign-out" && response.ok && auth.microsoftProof) cookies.push(auth.microsoftProof.cancel(headers));
  return cookies;
}

async function forwardAuthenticationRequest(
  req: FastifyRequest,
  reply: FastifyReply,
  dependencies: AuthProxyRouteDependencies,
) {
  const { auth, authMode, logOn, masquerades, resolveIncomingSession, toWebHeaders } = dependencies;
  if (authMode === "off" || !auth) return reply.code(404).send({ error: REPLY_ERRORS.routeUnavailable });
  const url = parseAuthenticationRequestUrl(req);
  if (!url) return reply.code(400).send({ error: REPLY_ERRORS.invalidRequestAuthority });
  const authPath = url.pathname.slice("/api/auth".length);
  if (!isBetterAuthProxyRouteAllowed({ authMode, mailEnabled: auth.mail != null }, req.method, authPath)) {
    return reply.code(404).send({ error: REPLY_ERRORS.routeUnavailable });
  }
  const socialError = socialSignInError({ req, authPath, auth, authMode });
  if (socialError) return reply.code(socialError.status).send({ error: socialError.error, code: socialError.code });
  if (isMasqueradeWrite(req, authPath, masquerades)) {
    return reply.code(403).send({ error: REPLY_ERRORS.masqueradeReadOnly, code: MASQUERADE_ERROR_CODES.readOnly });
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
  const cookies = collectProxyCookies({ auth, authPath, response, headers: requestHeaders });
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

/** Registers the closed Better Auth proxy seam. Off mode exposes no vendor wildcard. */
export function registerAuthProxyRoutes(app: FastifyInstance, dependencies: AuthProxyRouteDependencies): void {
  // Off mode mounts no vendor wildcard, preserving its zero-additional-auth-surface guarantee.
  if (dependencies.authMode === "off" || !dependencies.auth) return;
  app.route({
    method: ["GET", "POST"],
    url: "/api/auth/*",
    handler: (req, reply) => forwardAuthenticationRequest(req, reply, dependencies),
  });
}
