// ~5 MB request cap. A normal account is far smaller; an over-cap body is rejected
// by Fastify with 413 before our handlers run (mirrors the client's import guard).
export const BODY_LIMIT = 5 * 1024 * 1024;

// Fastify defaults BOTH to 0 (disabled). The documented deploy fronts this server with Nginx,
// which buffers/queues the client connection — 30s is generous headroom for that hop, and it's
// the guard that protects the documented DIRECT-EXPOSURE mode (no reverse proxy) from a
// slowloris-style slow-body/slow-read socket exhaustion attack that an unbounded timeout permits.
export const REQUEST_TIMEOUT_MS = 30_000;

export const CONNECTION_TIMEOUT_MS = 30_000;

export const MAX_SERVER_CONNECTIONS = 512;

// Only these parsing errors have messages we intentionally preserve for clients. Return canonical
// text rather than trusting even an allow-listed error object's message to remain harmless.
const SAFE_CLIENT_ERRORS = new Map<string, { status: number; message: string }>([
  ["FST_ERR_CTP_BODY_TOO_LARGE", { status: 413, message: "Request body is too large" }],
  ["FST_ERR_CTP_INVALID_MEDIA_TYPE", { status: 415, message: "Unsupported Media Type" }],
  [
    "FST_ERR_CTP_INVALID_CONTENT_LENGTH",
    {
      status: 400,
      message: "Request body size did not match Content-Length",
    },
  ],
  [
    "FST_ERR_CTP_EMPTY_JSON_BODY",
    {
      status: 400,
      message: "Body cannot be empty when content-type is set to 'application/json'",
    },
  ],
  [
    "FST_ERR_CTP_INVALID_JSON_BODY",
    {
      status: 400,
      message: "Body is not valid JSON but content-type is set to 'application/json'",
    },
  ],
  ["CAPACITYLENS_MALFORMED_CSP_REPORT", { status: 400, message: "Malformed CSP report" }],
  ["CAPACITYLENS_RATE_LIMITED", { status: 429, message: "Rate limit exceeded" }],
]);

export function safeClientError(error: unknown): { status: number; message: string } | null {
  if (!(error instanceof Error)) return null;
  const candidate = error as Error & { code?: unknown; statusCode?: unknown };
  if (typeof candidate.code !== "string") return null;
  const safe = SAFE_CLIENT_ERRORS.get(candidate.code);
  return safe && candidate.statusCode === safe.status ? safe : null;
}

export const MIN_BOOTSTRAP_TOKEN_BYTES = 32;
