import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort } from "@capacitylens/shared/account/ports";
import type { OperationReceipt, ProvisionalPrincipal } from "@capacitylens/shared/account/types";
import { validateCredentialInput } from "@capacitylens/shared/account/validation";
import { createHash } from "node:crypto";
import { RESET_LINK_TTL_SECONDS, mintPasswordResetToken, revokeResetTokensForUser } from "../../auth";
import { tx } from "../../txn";
import { createOperationReceipt } from "../accountFlowRuntime";
import { erasePrincipalCommandHistoryInTx } from "../state";
import type { IdentityPortContext } from "./contracts";
import type { SsoCutoverIdentityPort } from "./contracts";
import { isDuplicateCredentialEmailError, parseProviderErrorCode, createProviderFailure } from "./vendorErrors";
import { MalformedVerificationStateError, createInvalidVerificationStateError } from "./verificationState";

type CredentialsPort = Pick<
  SsoCutoverIdentityPort,
  | "createProvisionalCredentialPrincipal"
  | "createCorrelatedProvisionalCredentialPrincipal"
  | "compensateProvisionalPrincipal"
  | "deprovisionLocalPrincipal"
  | "issuePasswordReset"
  | "revokePasswordResetCeremony"
>;

type CredentialPrincipalInput = Parameters<IdentityPort["createProvisionalCredentialPrincipal"]>[0];

function resolveCredentialValidationMessage(
  validation: NonNullable<ReturnType<typeof validateCredentialInput>>,
): string {
  switch (validation) {
    case "password-length":
      return "The password does not meet the configured length policy.";
    case "email":
      return "The email address is not normalized or valid.";
    case "display-name":
      return "The display name is not valid.";
  }
}

function assertCredentialInput(
  authMode: IdentityPortContext["input"]["authMode"],
  input: CredentialPrincipalInput,
): void {
  if (authMode !== "password") {
    throw new AccountContractError({
      code: "UNSUPPORTED_CAPABILITY",
      message: "Credential identities are disabled for this installation.",
      retryable: false,
      commandId: input.command.commandId,
    });
  }
  const validation = validateCredentialInput(input);
  if (validation) {
    throw new AccountContractError({
      code: "VALIDATION_FAILED",
      message: resolveCredentialValidationMessage(validation),
      retryable: false,
      commandId: input.command.commandId,
    });
  }
}

async function createCredentialPrincipal(
  dependencies: {
    input: Pick<IdentityPortContext["input"], "auth" | "authMode">;
    makeCompensationHandle: IdentityPortContext["makeCompensationHandle"];
  },
  input: CredentialPrincipalInput,
  correlateInTransaction?: (principalId: string) => void,
): Promise<ProvisionalPrincipal> {
  const { auth, authMode } = dependencies.input;
  assertCredentialInput(authMode, input);
  try {
    const created = await auth.createCredentialUser({
      email: input.email,
      name: input.displayName,
      password: input.password,
      emailVerified: input.emailVerified,
      correlateInTransaction,
    });
    return {
      principalId: created.id,
      compensationHandle: dependencies.makeCompensationHandle(created.id, input.command.commandId),
    };
  } catch (error) {
    if (["PASSWORD_COMPROMISED", "PASSWORD_CONTEXT_REJECTED"].includes(parseProviderErrorCode(error) ?? "")) {
      throw new AccountContractError(
        {
          code: "VALIDATION_FAILED",
          message:
            error instanceof Error && error.message
              ? error.message
              : "The password does not meet the configured security policy.",
          retryable: false,
          commandId: input.command.commandId,
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
          commandId: input.command.commandId,
        },
        { cause: error },
      );
    }
    throw createProviderFailure("Identity creation is temporarily unavailable.", error);
  }
}

function createPrincipalLifecycle(context: {
  input: Pick<IdentityPortContext["input"], "db" | "masqueradeSessions">;
  assertCompensationHandle: IdentityPortContext["assertCompensationHandle"];
  eraseLocalPrincipalsInTx: IdentityPortContext["eraseLocalPrincipalsInTx"];
}): Pick<CredentialsPort, "compensateProvisionalPrincipal" | "deprovisionLocalPrincipal"> {
  const { input, assertCompensationHandle, eraseLocalPrincipalsInTx } = context;
  return {
    async compensateProvisionalPrincipal({ provisional, command }): Promise<void> {
      assertCompensationHandle(provisional, command.commandId);
      try {
        const masqueradeHandles = tx(input.db, () => {
          erasePrincipalCommandHistoryInTx(input.db, provisional.principalId, command.commandId);
          return eraseLocalPrincipalsInTx(input.db, [provisional.principalId], input.masqueradeSessions);
        });
        input.masqueradeSessions?.commit(masqueradeHandles);
      } catch (error) {
        if (error instanceof MalformedVerificationStateError) {
          throw createInvalidVerificationStateError(command.commandId, error);
        }
        throw createProviderFailure("Provisional identity compensation failed.", error);
      }
    },
    async deprovisionLocalPrincipal({ principalId, command }): Promise<OperationReceipt> {
      try {
        // This deletes only the installation-local user and local provider-link rows. It never calls
        // an upstream IdP deletion or management API.
        const masqueradeHandles = tx(input.db, () => {
          erasePrincipalCommandHistoryInTx(input.db, principalId, command.commandId);
          return eraseLocalPrincipalsInTx(input.db, [principalId], input.masqueradeSessions);
        });
        input.masqueradeSessions?.commit(masqueradeHandles);
        return createOperationReceipt({ commandId: command.commandId });
      } catch (error) {
        if (error instanceof MalformedVerificationStateError) {
          throw createInvalidVerificationStateError(command.commandId, error);
        }
        throw createProviderFailure("Local identity deprovisioning failed.", error);
      }
    },
  };
}

function createPasswordReset(
  input: Pick<IdentityPortContext["input"], "applicationId" | "auth" | "authMode" | "db">,
): Pick<CredentialsPort, "issuePasswordReset" | "revokePasswordResetCeremony"> {
  return {
    async issuePasswordReset({ targetPrincipalId, command }) {
      if (input.authMode !== "password") {
        throw new AccountContractError({
          code: "UNSUPPORTED_CAPABILITY",
          message: "Password reset is unavailable for an SSO-only installation.",
          retryable: false,
          commandId: command.commandId,
        });
      }
      try {
        const row = input.db.prepare(`SELECT email FROM user WHERE id = ?`).get(targetPrincipalId) as
          { email: string } | undefined;
        if (!row?.email) {
          throw new AccountContractError({
            code: "NOT_FOUND",
            message: "No local sign-in identity exists for this member.",
            retryable: false,
            commandId: command.commandId,
          });
        }
        const token = await mintPasswordResetToken(input.auth, row.email);
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
            .update(`${input.applicationId}-reset-ceremony\0`)
            .update(token)
            .digest("base64url"),
          token,
          expiresAt: new Date(Date.now() + RESET_LINK_TTL_SECONDS * 1000).toISOString(),
        };
      } catch (error) {
        if (error instanceof AccountContractError) throw error;
        throw createProviderFailure("Password-reset issuance is temporarily unavailable.", error);
      }
    },
    async revokePasswordResetCeremony({ targetPrincipalId }): Promise<void> {
      try {
        // Better Auth hashes ceremony identifiers at rest, so targeted deletion is unavailable.
        // Conservatively revoking every outstanding ceremony for this principal is fail-closed.
        revokeResetTokensForUser(input.db, targetPrincipalId);
      } catch (error) {
        throw createProviderFailure("Password-reset ceremony revocation failed.", error);
      }
    },
  };
}

export function createCredentials(
  context: Pick<
    IdentityPortContext,
    "input" | "makeCompensationHandle" | "assertCompensationHandle" | "eraseLocalPrincipalsInTx"
  >,
): CredentialsPort {
  return {
    async createProvisionalCredentialPrincipal(input): Promise<ProvisionalPrincipal> {
      return createCredentialPrincipal(context, input);
    },
    async createCorrelatedProvisionalCredentialPrincipal({
      correlatePrincipalInTransaction,
      ...input
    }): Promise<ProvisionalPrincipal> {
      return createCredentialPrincipal(context, input, correlatePrincipalInTransaction);
    },
    ...createPrincipalLifecycle(context),
    ...createPasswordReset(context.input),
  };
}
