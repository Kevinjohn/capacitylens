import { AccountContractError, retryAfterSeconds } from "@capacitylens/shared/account/errors";

function authorityDenialMessage(reason: string, action: "issue-password-reset" | "revoke-sessions"): string {
  if (reason === "target-not-member") return "The target is not a member of this installation.";
  if (action === "issue-password-reset") {
    return "This member belongs to another account where you lack password-reset authority.";
  }
  return "You lack session-revocation authority for this identity.";
}

export function createAuthorityDenial(
  reason: string,
  action: "issue-password-reset" | "revoke-sessions",
  commandId?: string,
): AccountContractError {
  return new AccountContractError({
    code: reason === "target-not-member" ? "NOT_FOUND" : "FORBIDDEN",
    message: authorityDenialMessage(reason, action),
    retryable: false,
    ...(commandId === undefined ? {} : { commandId }),
  });
}

export function createAuthorityChangedError(commandId: string): AccountContractError {
  return new AccountContractError({
    code: "AUTHORITY_CHANGED",
    message: "Identity-administration authority changed while the operation was in progress.",
    retryable: true,
    commandId,
  });
}

export function isAuthorityDenial(error: unknown): boolean {
  return (
    error instanceof AccountContractError &&
    ["FORBIDDEN", "NOT_MEMBER", "SESSION_NOT_FRESH", "MFA_REQUIRED"].includes(error.failure.code)
  );
}

export function createReplayCapacityError(commandId: string, retryAfterMs: number): AccountContractError {
  return new AccountContractError({
    code: "RATE_LIMITED",
    message: "One-time link issuance is temporarily busy. Retry after the indicated interval.",
    retryable: true,
    retryAfterSeconds: retryAfterSeconds(Math.ceil(retryAfterMs / 1_000)),
    commandId,
  });
}
