import type { FastifyRequest } from "fastify";
import type { FastifyInstance, FastifyReply } from "fastify";
import { REPLY_ERRORS } from "./replyErrors";

/** Returns the matching configured origin, or null when the request origin is not allowed. */
export function resolveCorsOrigin(reqOrigin: string | undefined, allow: ReadonlySet<string>): string | null {
  for (const allowedOrigin of allow) {
    if (allowedOrigin === reqOrigin) return allowedOrigin;
  }
  return null;
}

interface IsSameRequestOriginInput {
  req: FastifyRequest;
  reqOrigin: string;
  trustForwarded: boolean;
}

/** Returns whether the origin matches the request host under the configured proxy policy. */
export function isSameRequestOrigin({ req, reqOrigin, trustForwarded }: IsSameRequestOriginInput): boolean {
  const host = req.headers.host;
  if (!host) return false;
  const forwardedProto = req.headers["x-forwarded-proto"];
  const candidate = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  const protocol = trustForwarded && (candidate === "http" || candidate === "https") ? candidate : req.protocol;
  let origin: URL;
  let reconstructed: URL;
  // Total function: both the browser-set Origin and the reconstructed `${protocol}://${host}` are
  // untrusted, attacker-/proxy-influenced strings. A broken reverse proxy (or a hand-forged request)
  // can present a Host that `new URL` rejects ('exa mple.com', '[', 'host:port:port') so the
  // reconstructed URL stays inside the guard alongside the Origin parse. Either parse failing
  // means "cannot prove same-origin", which fails closed: return false so the CSRF gate answers a
  // clean 403, never a 500.
  try {
    origin = new URL(reqOrigin);
    reconstructed = new URL(`${protocol}://${host}`);
  } catch {
    return false;
  }
  if (origin.origin === reconstructed.origin) return true;
  // TLS-termination fallback (no Fetch Metadata, forwarded-proto not trusted). The standard
  // reverse-proxy pattern terminates HTTPS at the edge and forwards cleartext to this process, so
  // the browser-set Origin claims `https://<host>` while req.protocol only ever sees `http`. When
  // the Origin's host:port matches our Host header and the only difference is that scheme upgrade,
  // treat it as same-origin. This is safe because the browser, not the caller, populates the
  // Origin host: an attacker on another site cannot forge `https://<our-host>` as their Origin.
  // The residual accepted risk is narrow: a misconfigured deployment that genuinely serves plain
  // HTTP on the same host:port it advertises as HTTPS would be treated as same-origin, an operator
  // error, not an attacker-reachable one. We deliberately do not accept the reverse (Origin http
  // while we are https) and never accept any host:port mismatch.
  return origin.protocol === "https:" && reconstructed.protocol === "http:" && origin.host === reconstructed.host;
}

interface TrustedOriginInput {
  req: FastifyRequest;
  listedOrigin: string | null;
  fetchSite: string | undefined;
  trustForwarded: boolean;
}

function resolveTrustedOrigin({ req, listedOrigin, fetchSite, trustForwarded }: TrustedOriginInput): string | null {
  if (listedOrigin !== null) return listedOrigin;
  const reqOrigin = req.headers.origin;
  if (reqOrigin === undefined) return null;
  if (fetchSite === "same-origin" || isSameRequestOrigin({ req, reqOrigin, trustForwarded })) return reqOrigin;
  return null;
}

/** Installs the root-origin gate so API routes, preflights and not-found responses share policy. */
export function installOriginPolicy(input: {
  app: FastifyInstance;
  corsOrigins: ReadonlySet<string>;
  securityEvent: (event: Record<string, unknown>) => void;
  trustProxyHeaders: boolean;
}): void {
  const { app, corsOrigins, securityEvent, trustProxyHeaders } = input;
  app.addHook("onRequest", async function enforceOriginPolicy(req: FastifyRequest, reply: FastifyReply) {
    const reqOrigin = req.headers.origin;
    const listedOrigin = resolveCorsOrigin(reqOrigin, corsOrigins);
    const fetchSite = req.headers["sec-fetch-site"];
    // Sec-Fetch-Site is browser-controlled and covers packaged proxy requests whose public origin
    // cannot be reconstructed from the app's local protocol and host.
    const origin = resolveTrustedOrigin({
      req,
      listedOrigin,
      fetchSite,
      trustForwarded: trustProxyHeaders,
    });
    const unsafe = !["GET", "HEAD", "OPTIONS"].includes(req.method);
    // Only a listed origin or same-origin signal may send an unsafe browser request.
    if (unsafe && origin === null && (reqOrigin !== undefined || fetchSite === "cross-site")) {
      securityEvent({
        event: "cross_site_request",
        outcome: "blocked",
        method: req.method,
        path: req.url,
        origin: reqOrigin,
        fetchSite,
      });
      return reply.code(403).send({ error: REPLY_ERRORS.crossSiteRequest });
    }
    // Same-origin admission needs no CORS permission; only configuration grants cross-origin access.
    if (listedOrigin !== null) {
      reply.header("Access-Control-Allow-Origin", listedOrigin);
      reply.header("Vary", "Origin");
      reply.header("Access-Control-Allow-Credentials", "true");
    }
    reply.header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
    reply.header("Access-Control-Expose-Headers", "x-capacitylens-audit-warning");
    // Never reflect arbitrary requested headers on credentialed origins.
    reply.header(
      "Access-Control-Allow-Headers",
      "Content-Type, Idempotency-Key, x-account-command-id, x-capacitylens-bootstrap-token, x-capacitylens-setup-token, x-capacitylens-sync-session, x-capacitylens-sync-sequence",
    );
    if (req.method === "OPTIONS") return reply.code(204).send();
  });
}
