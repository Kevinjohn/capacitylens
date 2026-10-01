import type { FastifyRequest } from "fastify";
import type { AppOptions } from "../app";

// Never let a secret reach the logs. pino strips these exact paths from every record
// when logging is on; remove:true deletes the key (so the value is gone entirely, not printed as
// "[Redacted]"). Defense-in-depth: Fastify's default req/res serializers don't log headers at all
// (req → method/url/hostname/remoteAddress; res → statusCode/responseTime), so today nothing here
// would emit these, but the moment a custom serializer logs headers, or someone logs a raw req/res,
// this is the backstop that keeps Authorization / Cookie / Set-Cookie out of stdout. If such a
// serializer is ever added, extend this list to cover any new path it surfaces.
const LOG_REDACT_PATHS = ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'];

// Keep only the path in access logs so query and fragment data cannot expose one-time credentials.
// The invite token is carried in the path, so mask that exact route segment before taking its pathname.
const INVITE_OPERATION_URL_RE = /^(\/api\/invites\/)[^/?#]+(\/(?:accept|signup|preview))(.*)$/;

// /invite/<token> and /reset-password/<token> are web-app routes whose path carries a single-use
// bearer secret; mask everything after the prefix (the packaged nginx edge drops these log lines entirely).
const WEB_TOKEN_PATH_RE = /^(\/(?:invite|reset-password)\/).*$/;

// `url` is typed unknown because the serializer may also run over a hand-built `{ req: {...} }`
// record (e.g. app.log.info(...)) whose url is absent; a non-string passes through untouched.
export const redactSecretUrl = (url: unknown): string | undefined => {
  if (typeof url !== "string") return undefined;
  const inviteSafe = url.replace(INVITE_OPERATION_URL_RE, "$1[redacted]$2$3");
  let pathname: string;
  try {
    pathname = new URL(inviteSafe, "http://capacitylens.invalid").pathname;
  } catch {
    const suffixIndex = inviteSafe.search(/[?#]/u);
    pathname = suffixIndex < 0 ? inviteSafe : inviteSafe.slice(0, suffixIndex);
  }
  return pathname.replace(WEB_TOKEN_PATH_RE, "$1[redacted]");
};

/** Build the exact structured logger policy consumed by Fastify.
 * Exported so tests can pin redaction before req/res serializers discard header objects. */
export function createRequestLoggerOptions(stream?: AppOptions["logStream"]) {
  return {
    ...(stream ? { stream } : {}),
    redact: { paths: LOG_REDACT_PATHS, remove: true as const },
    serializers: {
      req(req: FastifyRequest) {
        const url = redactSecretUrl(req.url);
        const remotePort = req.socket.remotePort;
        return {
          method: req.method,
          ...(url === undefined ? {} : { url }),
          hostname: req.hostname,
          remoteAddress: req.ip,
          ...(remotePort === undefined ? {} : { remotePort }),
        };
      },
    },
  };
}
