import { REPLY_ERRORS } from "./replyErrors";

/** Maximum request body size accepted by Fastify. Oversized bodies receive 413. */
export const BODY_LIMIT = 5 * 1024 * 1024;

/** Bounds how long a request may remain open when the server is directly exposed. */
export const REQUEST_TIMEOUT_MS = 30_000;

/** Bounds how long an idle connection may remain open. */
export const CONNECTION_TIMEOUT_MS = 30_000;

/** Maximum number of simultaneous server connections. */
export const MAX_SERVER_CONNECTIONS = 512;

// Only these parsing errors have messages we intentionally preserve for clients. Return canonical
// text rather than trusting even an allow-listed error object's message to remain harmless.
const SAFE_CLIENT_ERRORS = new Map<string, { status: number; message: string }>([
  ["FST_ERR_CTP_BODY_TOO_LARGE", { status: 413, message: REPLY_ERRORS.requestBodyTooLarge }],
  ["FST_ERR_CTP_INVALID_MEDIA_TYPE", { status: 415, message: REPLY_ERRORS.unsupportedMediaType }],
  ["FST_ERR_CTP_INVALID_CONTENT_LENGTH", { status: 400, message: REPLY_ERRORS.contentLengthMismatch }],
  ["FST_ERR_CTP_EMPTY_JSON_BODY", { status: 400, message: REPLY_ERRORS.emptyJsonBody }],
  ["FST_ERR_CTP_INVALID_JSON_BODY", { status: 400, message: REPLY_ERRORS.invalidJsonBody }],
  ["CAPACITYLENS_INVALID_JSON_BOUNDARY", { status: 400, message: REPLY_ERRORS.invalidJsonBody }],
  ["CAPACITYLENS_MALFORMED_CSP_REPORT", { status: 400, message: REPLY_ERRORS.malformedCspReport }],
  ["CAPACITYLENS_RATE_LIMITED", { status: 429, message: REPLY_ERRORS.rateLimited }],
]);

/** Returns a canonical client error only for recognized Fastify parsing failures. */
export function resolveSafeClientError(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof Error)) return null;
  const candidate = error as Error & { code?: unknown; statusCode?: unknown };
  if (typeof candidate.code !== "string") return null;
  const safe = SAFE_CLIENT_ERRORS.get(candidate.code);
  return safe && candidate.statusCode === safe.status ? safe : null;
}

/** Minimum byte length required for a bootstrap token. */
export const MIN_BOOTSTRAP_TOKEN_BYTES = 32;
