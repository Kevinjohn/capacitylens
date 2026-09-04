import { AccountContractError, retryAfterSeconds, type AccountErrorCode } from "@capacitylens/shared/account/errors";
import type { InvitationRole, Role } from "@capacitylens/shared/account/types";

export function failure(code: AccountErrorCode, message: string, commandId?: string): AccountContractError {
  return new AccountContractError({
    code,
    message,
    retryable: false,
    commandId,
  });
}

export function replayCapacityFailure(commandId: string, retryAfterMs: number): AccountContractError {
  return new AccountContractError({
    code: "RATE_LIMITED",
    message: "One-time link issuance is temporarily busy. Retry after the indicated interval.",
    retryable: true,
    retryAfterSeconds: retryAfterSeconds(Math.ceil(retryAfterMs / 1_000)),
    commandId,
  });
}

export function assertInvitationRole(role: Role, commandId?: string): asserts role is InvitationRole {
  if (role === "owner") {
    throw failure(
      "OWNER_TRANSFER_REQUIRED",
      "Owner access cannot be assigned directly. Transfer ownership to an existing member instead.",
      commandId,
    );
  }
}

export function assertRedeemableInvitationRole(role: Role, commandId?: string): asserts role is InvitationRole {
  if (role === "owner") {
    throw failure(
      "INVITATION_EXPIRED",
      "This Owner invite is no longer valid. Ownership must be transferred.",
      commandId,
    );
  }
}
