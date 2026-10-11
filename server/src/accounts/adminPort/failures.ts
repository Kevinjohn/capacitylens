import { AccountContractError, assertRetryAfterSeconds } from "@capacitylens/shared/account/errors";
import type { AccountErrorCode } from "@capacitylens/shared/account/errors";
import type { InvitationRole, Role } from "@capacitylens/shared/account/types";

/**
 * Creates an account error with its public code, details, and optional command context.
 */
export function createAccountFailure(
  code: AccountErrorCode,
  message: string,
  commandId?: string,
): AccountContractError {
  return new AccountContractError({
    code,
    message,
    retryable: false,
    ...(commandId === undefined ? {} : { commandId }),
  });
}

/**
 * Creates the retryable error returned when the idempotency replay reservation is full.
 */
export function createReplayCapacityFailure(commandId: string, retryAfterMs: number): AccountContractError {
  return new AccountContractError({
    code: "RATE_LIMITED",
    message: "One-time link issuance is temporarily busy. Retry after the indicated interval.",
    retryable: true,
    retryAfterSeconds: assertRetryAfterSeconds(Math.ceil(retryAfterMs / 1_000)),
    commandId,
  });
}

/**
 * Rejects the Owner role because invitations cannot grant account ownership.
 */
export function assertInvitationRole(role: Role, commandId?: string): asserts role is InvitationRole {
  if (role === "owner") {
    throw createAccountFailure(
      "OWNER_TRANSFER_REQUIRED",
      "Owner access cannot be assigned directly. Transfer ownership to an existing member instead.",
      commandId,
    );
  }
}

/**
 * Rejects roles that cannot be redeemed from an invitation.
 */
export function assertRedeemableInvitationRole(role: Role, commandId?: string): asserts role is InvitationRole {
  if (role === "owner") {
    throw createAccountFailure(
      "INVITATION_EXPIRED",
      "This Owner invite is no longer valid. Ownership must be transferred.",
      commandId,
    );
  }
}
