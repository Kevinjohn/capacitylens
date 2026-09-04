import type { FastifyInstance, FastifyRequest } from "fastify";
import type { AccountAdminPort } from "@capacitylens/shared/account/ports";
import type { ApplicationSession } from "@capacitylens/shared/account/types";
import { can } from "@capacitylens/shared/domain/access";
import { accountCreateCapped, countAccounts } from "./accountEntityRoutes";
import { countUsers, DEMO_USER, type Auth, type AuthMode, type SessionUser } from "../auth";
import type { MasqueradeRegistry } from "../masqueradeRegistry";
import { MASQUERADE_ERROR_CODES } from "@capacitylens/shared/domain/masquerade";

type SessionResolution =
  | { kind: "absent_or_invalid" }
  | { kind: "verified"; session: ApplicationSession }
  | { kind: "backend_failure"; error: unknown };

/** Build the absolute URL Better Auth requires from Fastify's relative request URL. Host is
 * proxy/client input, so malformed authority syntax is a bounded caller error, not an exception. */
function authenticationRequestUrl(req: FastifyRequest): URL | null {
  try {
    return new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
  } catch {
    return null;
  }
}

/** CapacityLens's complete public seam into Better Auth. New dependency routes remain closed until
 * they are deliberately classified here and covered by the application's own policy surface. */
function betterAuthProxyRouteAllowed(authMode: Exclude<AuthMode, "off">, method: string, pathname: string): boolean {
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

/** Resolve only an already-issued, verified session for security-event attribution. Submitted
 * identifiers are intentionally never used: a failed sign-in must not be able to claim a user. */
async function resolveAuthenticationUserId(
  auth: Auth,
  headers: Headers,
  req: FastifyRequest,
  logOn: boolean,
): Promise<string | null> {
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

async function userMayCreateAccount(
  administration: AccountAdminPort,
  authMode: AuthMode,
  userId: string,
  count: number,
): Promise<boolean> {
  return (
    count === 0 ||
    authMode === "off" ||
    (await administration.listWorkspacesForPrincipal({ principalId: userId })).some((membership) =>
      can(membership.role, "manageMembers"),
    )
  );
}

export interface AuthProxyRouteDependencies {
  section: "identity" | "proxy";
  authMode: AuthMode;
  auth: Auth | null;
  db: Parameters<typeof countAccounts>[0];
  multiAccount: boolean;
  requireMfa: boolean;
  accountAdminPort: AccountAdminPort;
  masquerades: MasqueradeRegistry;
  resolveIncomingSession: (req: FastifyRequest, force?: boolean) => Promise<SessionResolution>;
  sessionUserFromApplicationSession: (session: ApplicationSession) => SessionUser;
  sessionSatisfiesRequiredMfa: (session: ApplicationSession) => boolean;
  toWebHeaders: (raw: FastifyRequest["headers"]) => Headers;
  logOn: boolean;
}

export function registerAuthProxyRoutes(app: FastifyInstance, dependencies: AuthProxyRouteDependencies): void {
  const {
    authMode,
    auth,
    db,
    multiAccount,
    requireMfa,
    accountAdminPort,
    masquerades,
    resolveIncomingSession,
    sessionUserFromApplicationSession,
    sessionSatisfiesRequiredMfa,
    toWebHeaders,
    logOn,
  } = dependencies;

  if (dependencies.section === "identity") {
    // Thin identity route — exists in EVERY mode so the client never forks on a
    // flag: { authMode, user }. 'off' reports the demo identity unconditionally; other
    // modes report the Better Auth session user, or 401 (with authMode, so the login
    // screen knows which form to show) when there is no session.
    app.get("/api/auth/me", async (req, reply) => {
      // Company-creation capability flags: the client's create-company entry point uses these to
      // hide/disable itself instead of discovering the answer via a failed POST. `canCreateAccount`
      // mirrors POST /api/orgs' full gate — (cap allows) AND userMayCreateAccount, the SAME shared
      // predicate the route enforces — never the cap alone (that told editors/membership-less users
      // "yes" and let them walk into a guaranteed 403). Recomputed PER REQUEST (account counts and
      // memberships change) — never cached — and carried on BOTH success shapes (off + authed) so
      // neither mode forks the client. The 401/503 shapes below are deliberately unchanged (no
      // account facts for a caller who isn't authenticated / whose session state is unknown) — an
      // anon caller on an auth-on instance is never told it can create.
      // The cap arm (WHETHER a new company may exist at all) — POST /api/orgs' GATE 0.
      const capAllows = !accountCreateCapped(db, multiAccount);
      if (authMode === "off") {
        // OFF mode: userMayCreateAccount is trivially true (its authMode arm), so the cap decides.
        return {
          authMode,
          user: DEMO_USER,
          providers: [],
          multiAccount,
          canCreateAccount: capAllows,
        };
      }
      const resolution = await resolveIncomingSession(req, true);
      if (resolution.kind === "absent_or_invalid") {
        // First-run signal: password mode + an EMPTY user table means the setup-token-guarded
        // bootstrap is available (the live gate in auth.ts), so the login screen offers
        // "Create the owner account" instead of a dead-end sign-in. "The user count is zero" is
        // NOT tenant data — the 401 shape still deliberately excludes account facts (the
        // capability flags stay off this branch); it reveals no setup secret or account data.
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
        const session = resolution.session;
        const user = sessionUserFromApplicationSession(session);
        const masquerading = masquerades.lookup(session.id) !== null;
        return {
          authMode,
          user,
          mfaRequired: authMode === "password" && requireMfa && !sessionSatisfiesRequiredMfa(session),
          reauthMethod: session.assurance === "federated" ? "provider" : "password",
          reauthProviderId: session.providerId ?? null,
          providers: auth?.providers ?? [],
          multiAccount,
          canCreateAccount:
            !masquerading &&
            capAllows &&
            (authMode !== "sso" ||
              (session.assurance === "federated" && session.providerId === auth?.strictProvider?.id)) &&
            (await userMayCreateAccount(accountAdminPort, authMode, user.id, countAccounts(db))),
        };
      } catch (e) {
        // The auth backend failed — NOT "no session". Surface a 503 with a clear, DISTINCT message
        // (the client can tell "temporarily unavailable" from a 401 "bad/again credentials") rather
        // than letting it fall through to the generic 500 redaction.
        req.log.error(e);
        return reply.code(503).send({ authMode, error: "Sign-in is temporarily unavailable." });
      }
    });
    return;
  }

  // Better Auth's own endpoints (sign-up/sign-in/sign-out/session/OAuth callbacks),
  // mounted ONLY when auth is on — in 'off' mode this route does not exist (the OFF
  // guarantee: zero new attack surface). The static /api/auth/me above outranks this
  // wildcard in Fastify's router. Translation layer: Fastify req → web Request,
  // web Response → Fastify reply (set-cookie kept as separate headers; content-length
  // recomputed by Fastify).
  if (authMode !== "off" && auth) {
    app.route({
      method: ["GET", "POST"],
      url: "/api/auth/*",
      handler: async (req, reply) => {
        const url = authenticationRequestUrl(req);
        if (!url) return reply.code(400).send({ error: "Invalid request authority." });
        const authPath = new URL(url).pathname.slice("/api/auth".length);
        if (!betterAuthProxyRouteAllowed(authMode, req.method, authPath)) {
          return reply.code(404).send({ error: "Not found." });
        }
        if (
          req.method === "POST" &&
          authPath !== "/sign-out" &&
          req.session !== null &&
          masquerades.lookup(req.session.id)
        ) {
          return reply.code(403).send({
            error: "Masquerade is read-only.",
            code: MASQUERADE_ERROR_CODES.readOnly,
          });
        }
        const requestHeaders = toWebHeaders(req.headers);
        if (requestHeaders.has("cookie") || requestHeaders.has("authorization")) {
          const incoming = await resolveIncomingSession(req);
          req.authenticationUserId = incoming.kind === "verified" ? incoming.session.principal.id : null;
        }
        const response = await auth.handler(
          new Request(url, {
            method: req.method,
            headers: requestHeaders,
            body: req.body === undefined || req.body === null ? undefined : JSON.stringify(req.body),
          }),
        );
        reply.status(response.status);
        response.headers.forEach((value, key) => {
          if (key === "set-cookie" || key === "content-length" || key === "transfer-encoding") return;
          reply.header(key, value);
        });
        const cookies = response.headers.getSetCookie();
        if (cookies.length > 0) reply.header("set-cookie", cookies);
        if (req.authenticationUserId === null && response.status < 400 && cookies.length > 0) {
          req.authenticationUserId = await resolveAuthenticationUserId(
            auth,
            withResponseCookies(requestHeaders, cookies),
            req,
            logOn,
          );
        }
        return reply.send(response.body ? Buffer.from(await response.arrayBuffer()) : null);
      },
    });
  }
}
