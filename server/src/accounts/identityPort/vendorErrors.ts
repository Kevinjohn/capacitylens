import { AccountContractError } from "@capacitylens/shared/account/errors";

export function providerFailure(message: string, cause: unknown): AccountContractError {
  return new AccountContractError(
    {
      code: "DEPENDENCY_UNAVAILABLE",
      message,
      retryable: true,
    },
    { cause },
  );
}

export function invalidProviderSession(message: string): AccountContractError {
  return new AccountContractError({
    code: "DEPENDENCY_INVALID_RESPONSE",
    message,
    retryable: false,
  });
}

export function providerErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== "object") return null;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isDuplicateCredentialEmailError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const sqlite = error as { errcode?: unknown; message?: unknown };
  // node:sqlite exposes SQLite's extended SQLITE_CONSTRAINT_UNIQUE code (2067). The credential
  // writer's pinned schema has one user-table uniqueness conflict that means this caller fault:
  // the email column. Other constraints and provider lifecycle messages remain dependency errors.
  return sqlite.errcode === 2067 && sqlite.message === "UNIQUE constraint failed: user.email";
}
