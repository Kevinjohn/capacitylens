import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort } from "@capacitylens/shared/account/ports";
import type { OperationReceipt, ProvisionalPrincipal } from "@capacitylens/shared/account/types";
import { validateCredentialInput } from "@capacitylens/shared/account/validation";
import { createHash } from "node:crypto";
import { RESET_LINK_TTL_SECONDS, mintPasswordResetToken, revokeResetTokensForUser } from "../../auth";
import { tx } from "../../txn";
import { receipt } from "../accountFlowRuntime";
import { erasePrincipalCommandHistoryInTx } from "../state";
import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityPort } from "./contracts";
import { isDuplicateCredentialEmailError, providerErrorCode, providerFailure } from "./vendorErrors";
import { MalformedVerificationStateError, invalidVerificationState } from "./verificationState";

export function createCredentials(
  context: Pick<
    IdentityPortContext,
    "input" | "makeCompensationHandle" | "assertCompensationHandle" | "eraseLocalPrincipalsInTx"
  >,
): Pick<
  SsoCutoverIdentityPort,
  | "createProvisionalCredentialPrincipal"
  | "createCorrelatedProvisionalCredentialPrincipal"
  | "compensateProvisionalPrincipal"
  | "deprovisionLocalPrincipal"
  | "issuePasswordReset"
  | "revokePasswordResetCeremony"
> {
  const { input, makeCompensationHandle, assertCompensationHandle, eraseLocalPrincipalsInTx } = context;
  const { applicationId, auth, authMode, db } = input;
  const createCredentialPrincipal = async (
    input: Parameters<IdentityPort["createProvisionalCredentialPrincipal"]>[0],
    correlateInTransaction?: (principalId: string) => void,
  ): Promise<ProvisionalPrincipal> => {
    const { email, displayName, password, emailVerified, command } = input;
    if (authMode !== "password") {
      throw new AccountContractError({
        code: "UNSUPPORTED_CAPABILITY",
        message: "Credential identities are disabled for this installation.",
        retryable: false,
        commandId: command.commandId,
      });
    }
    const validation = validateCredentialInput({ email, displayName, password });
    if (validation) {
      throw new AccountContractError({
        code: "VALIDATION_FAILED",
        message:
          validation === "password-length"
            ? "The password does not meet the configured length policy."
            : validation === "email"
              ? "The email address is not normalized or valid."
              : "The display name is not valid.",
        retryable: false,
        commandId: command.commandId,
      });
    }
    try {
      const created = await auth.createCredentialUser(
        email,
        displayName,
        password,
        emailVerified,
        correlateInTransaction,
      );
      return {
        principalId: created.id,
        compensationHandle: makeCompensationHandle(created.id, command.commandId),
      };
    } catch (error) {
      if (["PASSWORD_COMPROMISED", "PASSWORD_CONTEXT_REJECTED"].includes(providerErrorCode(error) ?? "")) {
        throw new AccountContractError(
          {
            code: "VALIDATION_FAILED",
            message:
              error instanceof Error && error.message
                ? error.message
                : "The password does not meet the configured security policy.",
            retryable: false,
            commandId: command.commandId,
          },
          { cause: error },
        );
      }
      if (isDuplicateCredentialEmailError(error)) {
        throw new AccountContractError(
          {
            code: "IDENTITY_ALREADY_EXISTS",
            message: "A sign-in identity already exists for that email address.",
            retryable: false,
            commandId: command.commandId,
          },
          { cause: error },
        );
      }
      throw providerFailure("Identity creation is temporarily unavailable.", error);
    }
  };
  return {
    async createProvisionalCredentialPrincipal(input): Promise<ProvisionalPrincipal> {
      return createCredentialPrincipal(input);
    },
    async createCorrelatedProvisionalCredentialPrincipal({
      correlatePrincipalInTransaction,
      ...input
    }): Promise<ProvisionalPrincipal> {
      return createCredentialPrincipal(input, correlatePrincipalInTransaction);
    },
    async compensateProvisionalPrincipal({ provisional, command }): Promise<void> {
      assertCompensationHandle(provisional, command.commandId);
      try {
        const masqueradeHandles = tx(db, () => {
          erasePrincipalCommandHistoryInTx(db, provisional.principalId, command.commandId);
          return eraseLocalPrincipalsInTx(db, [provisional.principalId], input.masqueradeSessions);
        });
        input.masqueradeSessions?.commit(masqueradeHandles);
      } catch (error) {
        if (error instanceof MalformedVerificationStateError) {
          throw invalidVerificationState(command.commandId, error);
        }
        throw providerFailure("Provisional identity compensation failed.", error);
      }
    },
    async deprovisionLocalPrincipal({ principalId, command }): Promise<OperationReceipt> {
      try {
        // This deletes only the installation-local user and local provider-link rows. It never calls
        // an upstream IdP deletion or management API.
        const masqueradeHandles = tx(db, () => {
          erasePrincipalCommandHistoryInTx(db, principalId, command.commandId);
          return eraseLocalPrincipalsInTx(db, [principalId], input.masqueradeSessions);
        });
        input.masqueradeSessions?.commit(masqueradeHandles);
        return receipt(command.commandId);
      } catch (error) {
        if (error instanceof MalformedVerificationStateError) {
          throw invalidVerificationState(command.commandId, error);
        }
        throw providerFailure("Local identity deprovisioning failed.", error);
      }
    },
    async issuePasswordReset({ targetPrincipalId, command }) {
      if (authMode !== "password") {
        throw new AccountContractError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "Password reset is unavailable for an SSO-only installation.",
          retryable: false,
          commandId: command.commandId,
        });
      }
      try {
        const row = db.prepare(`SELECT email FROM user WHERE id = ?`).get(targetPrincipalId) as
          { email: string } | undefined;
        if (!row?.email) {
          throw new AccountContractError({
            code: "NOT_FOUND",
            message: "No local sign-in identity exists for this member.",
            retryable: false,
            commandId: command.commandId,
          });
        }
        const token = await mintPasswordResetToken(auth, row.email);
        if (!token) {
          throw new AccountContractError({
            code: "NOT_FOUND",
            message: "No local sign-in identity exists for this member.",
            retryable: false,
            commandId: command.commandId,
          });
        }
        return {
          ceremonyId: createHash("sha256")
            .update(`${applicationId}-reset-ceremony\0`)
            .update(token)
            .digest("base64url"),
          token,
          expiresAt: new Date(Date.now() + RESET_LINK_TTL_SECONDS * 1000).toISOString(),
        };
      } catch (error) {
        if (error instanceof AccountContractError) throw error;
        throw providerFailure("Password-reset issuance is temporarily unavailable.", error);
      }
    },
    async revokePasswordResetCeremony({ targetPrincipalId }): Promise<void> {
      try {
        // Better Auth hashes ceremony identifiers at rest, so targeted deletion is unavailable.
        // Conservatively revoking every outstanding ceremony for this principal is fail-closed.
        revokeResetTokensForUser(db, targetPrincipalId);
      } catch (error) {
        throw providerFailure("Password-reset ceremony revocation failed.", error);
      }
    },
  };
}
