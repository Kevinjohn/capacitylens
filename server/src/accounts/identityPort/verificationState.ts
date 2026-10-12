import { AccountContractError } from "@capacitylens/shared/account/errors";

/**
 * Explains why identity erasure must stop when structured verification state is malformed.
 */
export const MALFORMED_STRUCTURED_VERIFICATION =
  "Identity erasure cannot classify malformed structured verification state.";

/**
 * Signals that structured identity verification state cannot be safely interpreted.
 */
export class MalformedVerificationStateError extends Error {
  override name = "MalformedVerificationStateError";
}

/**
 * Creates the typed error raised when stored verification state is malformed.
 */
export function createInvalidVerificationStateError(
  commandId: string,
  cause: MalformedVerificationStateError,
): AccountContractError {
  return new AccountContractError(
    {
      code: "DEPENDENCY_INVALID_RESPONSE",
      message: MALFORMED_STRUCTURED_VERIFICATION,
      retryable: false,
      commandId,
    },
    { cause },
  );
}

function parseStructuredVerification(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch (cause) {
    // Opaque scalar tokens may be non-JSON; malformed object-shaped state must abort erasure because its principal correlation is unknown.
    if (value.trimStart().startsWith("{")) {
      throw new MalformedVerificationStateError(MALFORMED_STRUCTURED_VERIFICATION, { cause });
    }
    return null;
  }
}

function readLinkUserId(link: unknown): string | null {
  if (typeof link !== "object" || link === null || Array.isArray(link)) {
    throw new MalformedVerificationStateError(MALFORMED_STRUCTURED_VERIFICATION);
  }
  const userId = (link as { userId?: unknown }).userId;
  if (typeof userId === "string" && userId.length > 0) return userId;
  if (typeof userId === "number" && Number.isFinite(userId)) return String(userId);
  throw new MalformedVerificationStateError(MALFORMED_STRUCTURED_VERIFICATION);
}

/**
 * Returns the principal named by structured OAuth account-link state, or null for unrelated scalar or unlinked state.
 * @throws MalformedVerificationStateError when object-shaped state cannot be safely classified;
 * callers must abort identity erasure rather than leave potentially correlated state behind.
 */
export function parseAccountLinkUserId(value: string): string | null {
  const parsed = parseStructuredVerification(value);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  if (!Object.hasOwn(parsed, "link")) return null;
  return readLinkUserId((parsed as { link: unknown }).link);
}
