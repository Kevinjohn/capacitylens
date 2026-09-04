import type { FastifyRequest } from "fastify";
import type { AppOptions } from "../app";

// P0.5.5: NEVER let a secret reach the logs. pino strips these exact paths from every record
// when logging is on; remove:true DELETES the key (so the value is gone entirely, not printed as
// "[Redacted]"). DEFENSE-IN-DEPTH: Fastify's default req/res serializers don't log headers at all
// (req → method/url/hostname/remoteAddress; res → statusCode/responseTime), so today nothing here
// would emit these — but the moment a custom serializer logs headers, or someone logs a raw req/res,
// this is the backstop that keeps Authorization / Cookie / Set-Cookie out of stdout. If such a
// serializer is ever added, extend this list to cover any new path it surfaces.
const LOG_REDACT_PATHS = ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'];

// Mask the bearer token in every token-scoped invite URL before it reaches the access log. The token
// is the ONLY path-borne secret in the API; every other URL passes through unchanged. Anchored to
// the exact `/api/invites/<token>/accept` shape (optionally with a query string) so a normal path
// is never mangled. The match is on the path-with-query string pino logs (req.url).
const INVITE_OPERATION_URL_RE = /^(\/api\/invites\/)[^/?#]+(\/(?:accept|signup|preview))(.*)$/;

// `url` is typed unknown because the serializer may also run over a hand-built `{ req: {...} }`
// record (e.g. app.log.info(...)) whose url is absent; a non-string passes through untouched.
export const redactSecretUrl = (url: unknown): string | undefined => {
  if (typeof url !== "string") return undefined;
  const inviteSafe = url.replace(INVITE_OPERATION_URL_RE, "$1[redacted]$2$3");
  try {
    const parsed = new URL(inviteSafe, "http://capacitylens.invalid");
    for (const key of ["token", "code", "state"]) {
      if (parsed.searchParams.has(key)) parsed.searchParams.set(key, "[redacted]");
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return inviteSafe;
  }
};

/** Build the exact structured logger policy consumed by Fastify.
 *  Exported so tests can pin redaction before req/res serializers discard header objects. */
export function requestLoggerOptions(stream?: AppOptions["logStream"]) {
  return {
    ...(stream ? { stream } : {}),
    redact: { paths: LOG_REDACT_PATHS, remove: true as const },
    serializers: {
      req(req: FastifyRequest) {
        return {
          method: req.method,
          url: redactSecretUrl(req.url),
          hostname: req.hostname,
          remoteAddress: req.ip,
          remotePort: req.socket?.remotePort,
        };
      },
    },
  };
}
