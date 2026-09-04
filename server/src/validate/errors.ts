import type { DomainErrorCode } from "@capacitylens/shared/domain/errors";
/** A caller-fault error (bad request body) — mapped to HTTP 400. Distinct from an
 *  unexpected server/db error, which must surface as 500. */
export class ValidationError extends Error {
  readonly code?: DomainErrorCode;

  // Accepts ErrorOptions so a re-tag from a catch can forward `{ cause }` and preserve the full
  // chain (not just the message) — see validateWrite below.
  constructor(message: string, options?: ErrorOptions & { code?: DomainErrorCode }) {
    super(message, options);
    this.name = "ValidationError";
    this.code = options?.code;
  }
}

/**
 * Guard every write path against a missing or non-string id. SQLite TEXT PRIMARY KEY
 * permits NULL, so a POST without an id would store an unaddressable `id: null` row;
 * two such rows can coexist (empirically) and are undeletable by id. Reject early so
 * the constraint never reaches the DB.
 */
export function assertIdPresent(row: Record<string, unknown>): void {
  if (typeof row.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(row.id)) {
    throw new ValidationError(
      "id must be 1–128 URL-safe characters, begin with a letter or number, and contain only letters, numbers, dot, underscore, tilde or hyphen.",
    );
  }
}
