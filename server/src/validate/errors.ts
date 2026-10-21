import type { DomainErrorCode } from "@capacitylens/shared/domain/errors";
/** A caller-fault error (bad request body), mapped to HTTP 400. Distinct from an
 * unexpected server/db error, which must surface as 500. */
export class ValidationError extends Error {
  readonly code?: DomainErrorCode;

  // Retain the caught cause when retagging a failure so the diagnostic chain remains available.
  constructor(message: string, options?: ErrorOptions & { code?: DomainErrorCode }) {
    super(message, options);
    this.name = "ValidationError";
    if (options?.code !== undefined) this.code = options.code;
  }
}

/** Rejects missing or malformed IDs before storage.
 * IDs must be 1–128 URL-safe characters beginning with a letter or number.
 * @throws ValidationError when the ID cannot be safely addressed by the API.
 */
export function assertIdPresent(row: Record<string, unknown>): void {
  if (typeof row.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/.test(row.id)) {
    throw new ValidationError(
      "id must be 1–128 URL-safe characters, begin with a letter or number, and contain only letters, numbers, dot, underscore, tilde or hyphen.",
    );
  }
}
