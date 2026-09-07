import { AccountContractError } from "@capacitylens/shared/account/errors";
import type { LocalPrincipal } from "@capacitylens/shared/account/types";
import { createOperationReceipt } from "./accountFlowRuntime";
import type { LocalIdentityPort } from "./betterAuthIdentityPort";

function throwUnsupportedOperation(commandId?: string): never {
  throw new AccountContractError({
    code: "UNSUPPORTED_CAPABILITY",
    message: "This identity operation is unavailable in trusted-local mode.",
    retryable: false,
    ...(commandId === undefined ? {} : { commandId }),
  });
}

/** Zero-provider identity implementation for the open-source trusted-local profile. */
export function createTrustedLocalIdentityPort(principal: LocalPrincipal): LocalIdentityPort {
  return {
    deprovisionLocalPrincipalInTx: () => [],
    deprovisionLocalPrincipalsInTx: () => [],
    commitMasqueradeSessionEnds: () => {},
    async verifyApplicationSession() {
      return {
        id: "trusted-local",
        principal: {
          id: principal.id,
          displayName: principal.displayName,
          email: principal.email,
          emailVerified: true,
          image: principal.image ?? null,
          linkedSubject: null,
        },
        createdAt: "1970-01-01T00:00:00.000Z",
        expiresAt: null,
        freshUntil: null,
        assurance: "trusted-local",
      };
    },
    async getPrincipalSummaries({ principalIds }) {
      return principalIds.includes(principal.id)
        ? [{ id: principal.id, displayName: principal.displayName, email: principal.email }]
        : [];
    },
    async findPrincipalByFederatedSubject() {
      return null;
    },
    async signOut() {
      return { setCookies: [] };
    },
    async listSessions() {
      return [];
    },
    async revokeOwnSession({ command }) {
      return createOperationReceipt({ commandId: command.commandId, changed: false });
    },
    async createProvisionalCredentialPrincipal({ command }) {
      return throwUnsupportedOperation(command.commandId);
    },
    async createCorrelatedProvisionalCredentialPrincipal({ command }) {
      return throwUnsupportedOperation(command.commandId);
    },
    async compensateProvisionalPrincipal({ command }) {
      return throwUnsupportedOperation(command.commandId);
    },
    async deprovisionLocalPrincipal({ command }) {
      return createOperationReceipt({ commandId: command.commandId });
    },
    async issuePasswordReset({ command }) {
      return throwUnsupportedOperation(command.commandId);
    },
    async revokePasswordResetCeremony({ command }) {
      return throwUnsupportedOperation(command.commandId);
    },
    async revokePrincipalSessions({ command }) {
      return throwUnsupportedOperation(command.commandId);
    },
  };
}
