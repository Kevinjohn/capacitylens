import type { FastifyReply, FastifyRequest } from "fastify";
import { ValidationError } from "../validate";

// SQLite extended constraint codes that describe caller-supplied row data. Deliberately exclude
// TRIGGER (1811), FUNCTION (1043), VTAB (2323), COMMIT_HOOK (531) and other internal constraint
// sources: those are server/storage failures and must remain logged 500s.
const SQLITE_CALLER_DATA_CONSTRAINT_CODES = new Set([
  275, // SQLITE_CONSTRAINT_CHECK
  787, // SQLITE_CONSTRAINT_FOREIGNKEY
  1299, // SQLITE_CONSTRAINT_NOTNULL
  1555, // SQLITE_CONSTRAINT_PRIMARYKEY
  2067, // SQLITE_CONSTRAINT_UNIQUE
  2579, // SQLITE_CONSTRAINT_ROWID
  3091, // SQLITE_CONSTRAINT_DATATYPE
]);

/** node:sqlite exposes SQLite's extended numeric result in `errcode`. Require both its error code
 * and one recognized row-data constraint subtype so unrelated prose and internal trigger aborts
 * can never be hidden as caller faults. */
function isSqliteConstraintError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const sqlite = err as Error & { code?: unknown; errcode?: unknown };
  return (
    sqlite.code === "ERR_SQLITE_ERROR" &&
    typeof sqlite.errcode === "number" &&
    Number.isInteger(sqlite.errcode) &&
    SQLITE_CALLER_DATA_CONSTRAINT_CODES.has(sqlite.errcode)
  );
}

// Map a thrown error to an HTTP status. Caller-fault errors — domain validation
// (ValidationError) and DB constraint/FK violations — are 400; anything else is an
// unexpected server/db bug and must surface as 500 (not be hidden as a 400).
// Exported for unit testing the classification.
export function statusFor(err: unknown): number {
  if (err instanceof ValidationError) return 400;
  if (isSqliteConstraintError(err)) return 400;
  return 500;
}

/** Resolve the client identity consistently for rate limiting and security telemetry. */
export function requestClientIp(request: Pick<FastifyRequest, "headers" | "ip">, trustProxyHeaders: boolean): string {
  if (trustProxyHeaders) {
    const forwarded = request.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.ip;
}

export function fail(reply: FastifyReply, err: unknown, logError: (e: unknown) => void = console.error) {
  const status = statusFor(err);
  // A 500 is an unexpected server/db bug: log the real error server-side but return a
  // GENERIC body so we never leak internals (stack-ish messages, SQL, paths).
  if (status === 500) {
    logError(err);
    return reply.code(500).send({ error: "Internal server error" });
  }
  // 400s: a curated ValidationError message is safe AND useful (it's a friendly sentence we
  // authored). A raw DB-constraint message (e.g. "NOT NULL constraint failed: clients.color")
  // leaks schema internals — genericise it, mirroring the 500 redaction one tier down.
  const message =
    err instanceof ValidationError
      ? err.message
      : "That change references missing data or conflicts with an existing record.";
  return reply.code(status).send({
    error: message,
    ...(err instanceof ValidationError && err.code ? { code: err.code } : {}),
  });
}
