import { AccountContractError } from '@capacitylens/shared/account/errors'
import type { LocalPrincipal, OperationReceipt } from '@capacitylens/shared/account/types'
import type { LocalIdentityPort } from './betterAuthIdentityPort'

function unsupported(): never {
  throw new AccountContractError({
    code: 'UNSUPPORTED_CAPABILITY',
    message: 'This identity operation is unavailable in trusted-local mode.',
    retryable: false,
  })
}

function receipt(commandId: string): OperationReceipt {
  return { commandId, completedAt: new Date().toISOString() }
}

/** Zero-provider identity implementation for the open-source trusted-local profile. */
export function trustedLocalIdentityPort(principal: LocalPrincipal): LocalIdentityPort {
  return {
    deprovisionLocalPrincipalInTx: () => {},
    async verifyApplicationSession() {
      return {
        id: 'trusted-local',
        principal: {
          id: principal.id,
          displayName: principal.displayName,
          email: principal.email,
          emailVerified: true,
          linkedSubject: null,
        },
        createdAt: '1970-01-01T00:00:00.000Z',
        expiresAt: null,
        freshUntil: null,
        assurance: 'trusted-local',
      }
    },
    async getPrincipalSummaries({ principalIds }) {
      return principalIds.includes(principal.id)
        ? [{ id: principal.id, displayName: principal.displayName, email: principal.email }]
        : []
    },
    async findPrincipalByFederatedSubject() { return null },
    async signOut() { return { setCookies: [] } },
    async listSessions() { return [] },
    async revokeOwnSession({ command }) { return receipt(command.commandId) },
    async createProvisionalCredentialPrincipal() { return unsupported() },
    async compensateProvisionalPrincipal() { return unsupported() },
    async deprovisionLocalPrincipal({ command }) { return receipt(command.commandId) },
    async issuePasswordReset() { return unsupported() },
    async revokePasswordResetCeremony() { return unsupported() },
    async revokePrincipalSessions() { return unsupported() },
  }
}
