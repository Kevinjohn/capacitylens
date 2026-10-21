import { AccountContractError } from "@capacitylens/shared/account/errors";

/**
 * Creates the account error used when the identity provider operation fails.
 */
export function createProviderFailure(message: string, cause: unknown): AccountContractError {
  return new AccountContractError(
    {
      code: "DEPENDENCY_UNAVAILABLE",
      message,
      retryable: true,
    },
    { cause },
  );
}

/**
 * Creates the account error used when a provider returns an invalid session.
 */
export function createInvalidProviderSessionError(message: string): AccountContractError {
  return new AccountContractError({
    code: "DEPENDENCY_INVALID_RESPONSE",
    message,
    retryable: false,
  });
}

/**
 * Extracts a provider error code only when the supplied value contains a recognized string code.
 */
export function parseProviderErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/**
 * Recognizes the provider error that reports an already-used credential email.
 */
export function isDuplicateCredentialEmailError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const sqlite = error as { errcode?: unknown; message?: unknown };
  // node:sqlite exposes SQLite's extended SQLITE_CONSTRAINT_UNIQUE code (2067). The credential
  // writer's pinned schema has one user-table uniqueness conflict that means this caller fault:
  // the email column. Other constraints and provider lifecycle messages remain dependency errors.
  return sqlite.errcode === 2067 && sqlite.message === "UNIQUE constraint failed: user.email";
}
