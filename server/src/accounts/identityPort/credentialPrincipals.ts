import { allowsPasswordSignIn } from "@capacitylens/shared/account/types";
import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { IdentityPort } from "@capacitylens/shared/account/ports";
import type { OperationReceipt, ProvisionalPrincipal } from "@capacitylens/shared/account/types";
import { inspectCredentialInput } from "@capacitylens/shared/account/validation";
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
>;
type CredentialPrincipalInput = Parameters<IdentityPort["createProvisionalCredentialPrincipal"]>[0];

function resolveCredentialValidationMessage(
  validation: NonNullable<ReturnType<typeof inspectCredentialInput>>,
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
  if (!allowsPasswordSignIn(authMode)) {
    throw new AccountContractError({
      code: "UNSUPPORTED_CAPABILITY",
      message: "Credential identities are disabled for this installation.",
      retryable: false,
      commandId: input.command.commandId,
    });
  }
  const validation = inspectCredentialInput(input);
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
    createCompensationHandle: IdentityPortContext["createCompensationHandle"];
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
      compensationHandle: dependencies.createCompensationHandle(created.id, input.command.commandId),
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

/** Creates and compensates credential principals through narrow local identity operations. */
export function createCredentialPrincipals(context: {
  input: Pick<IdentityPortContext["input"], "auth" | "authMode" | "db" | "masqueradeSessions">;
  createCompensationHandle: IdentityPortContext["createCompensationHandle"];
  assertCompensationHandle: IdentityPortContext["assertCompensationHandle"];
  eraseLocalPrincipalsInTx: IdentityPortContext["eraseLocalPrincipalsInTx"];
}): CredentialsPort {
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
  };
}
