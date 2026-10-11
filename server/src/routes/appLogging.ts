import type { FastifyRequest } from "fastify";
import type { AppOptions } from "../app";

// Redact credential headers even if a caller supplies a raw request or response to the logger.
// Serializer omission alone cannot protect arbitrary structured log records.
const LOG_REDACT_PATHS = ["req.headers.authorization", "req.headers.cookie", 'res.headers["set-cookie"]'];

// Keep only the path in access logs so query and fragment data cannot expose one-time credentials.
// The invite token is carried in the path, so mask that exact route segment before taking its pathname.
const INVITE_OPERATION_URL_RE = /^(\/api\/invites\/)[^/?#]+(\/(?:accept|signup|preview))(.*)$/;

// /invite/<token> and /reset-password/<token> are web-app routes whose path carries a single-use
// bearer secret; mask everything after the prefix (the packaged nginx edge drops these log lines entirely).
const WEB_TOKEN_PATH_RE = /^(\/(?:invite|reset-password)\/).*$/;

/** Removes query and fragment data and masks bearer-token path segments.
 * Non-string input returns undefined so malformed log fields are omitted.
 */
export const redactSecretUrl = (url: unknown): string | undefined => {
  if (typeof url !== "string") return undefined;
  const inviteSafe = url.replace(INVITE_OPERATION_URL_RE, "$1[redacted]$2$3");
  let pathname: string;
  try {
    pathname = new URL(inviteSafe, "http://capacitylens.invalid").pathname;
  } catch {
    // Strip query and fragment before redacting token paths when URL parsing fails.
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
