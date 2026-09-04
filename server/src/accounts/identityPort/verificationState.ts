import { AccountContractError } from "@capacitylens/shared/account/errors";

export const MALFORMED_STRUCTURED_VERIFICATION =
  "Identity erasure cannot classify malformed structured verification state.";

export class MalformedVerificationStateError extends Error {
  override name = "MalformedVerificationStateError";
}

export function invalidVerificationState(
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

/**
 * Return the principal linked by Better Auth's JSON OAuth state. Opaque scalar ceremonies (reset
 * tokens and similar values) are intentionally unrelated unless they exactly equal the principal.
 * An object-shaped value is different: if it cannot be decoded, erasure cannot prove that it is
 * unrelated, so throw and let the caller's transaction roll back instead of reporting completion.
 */
export function accountLinkUserId(value: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (cause) {
    if (value.trimStart().startsWith("{")) {
      throw new MalformedVerificationStateError(MALFORMED_STRUCTURED_VERIFICATION, { cause });
    }
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  if (!Object.hasOwn(parsed, "link")) return null;
  const link = (parsed as { link: unknown }).link;
  if (typeof link !== "object" || link === null || Array.isArray(link)) {
    throw new MalformedVerificationStateError(MALFORMED_STRUCTURED_VERIFICATION);
  }
  const userId = (link as { userId?: unknown }).userId;
  if (typeof userId === "string" && userId.length > 0) return userId;
  if (typeof userId === "number" && Number.isFinite(userId)) return String(userId);
  throw new MalformedVerificationStateError(MALFORMED_STRUCTURED_VERIFICATION);
}
