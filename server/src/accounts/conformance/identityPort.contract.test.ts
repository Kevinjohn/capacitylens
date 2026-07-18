import { afterEach, describe, expect, it } from 'vitest'
import { AccountContractError } from '@capacitylens/shared/account/errors'
import type { IdentityPort } from '@capacitylens/shared/account/ports'
import type {
  ActorContext,
  ApplicationSession,
  CommandIdentity,
  LocalPrincipal,
  OperationReceipt,
  PrincipalSummary,
  ProvisionalPrincipal,
  SessionSummary,
} from '@capacitylens/shared/account/types'
import { authFromEnv, runAuthMigrations, type Auth } from '../../auth'
import { openDb } from '../../db'
import { PASSWORD_ENV } from '../../testHelpers'
import { betterAuthIdentityPort } from '../betterAuthIdentityPort'
import { applicationSessionHandle } from '../sessionHandle'
import { recordSessionAssurance } from '../state'
import { trustedLocalIdentityPort } from '../trustedLocalIdentityPort'

const APPLICATION_ID = 'identity-conformance'
const NOW = '2026-07-18T10:00:00.000Z'
const LATER = '2099-07-18T22:00:00.000Z'
const PRINCIPAL: LocalPrincipal = {
  id: 'principal-1',
  displayName: 'Conformance User',
  email: 'conformance@example.com',
  emailVerified: true,
  linkedSubject: null,
}
const ACTOR: ActorContext = {
  principalId: PRINCIPAL.id,
  sessionId: 'session-1',
  assurance: 'password',
  fresh: true,
  mfaSatisfied: false,
}

type Capability =
  | 'durablePrincipalStorage'
  | 'credentials'
  | 'passwordReset'
  | 'administrativeSessionRevocation'

interface Harness {
  port: IdentityPort
  session: ApplicationSession
  actor: ActorContext
  knownPrincipal: PrincipalSummary
  capabilities: Readonly<Record<Capability, boolean>>
  cleanup(): void | Promise<void>
}

type HarnessFactory = () => Harness | Promise<Harness>

const command = (suffix: string): CommandIdentity => ({
  commandId: `command-${suffix}`,
  idempotencyKey: `idempotency-${suffix}`,
})

function expectUnsupported(operation: Promise<unknown>, commandId?: string): Promise<void> {
  return expect(operation).rejects.toMatchObject({
    failure: {
      code: 'UNSUPPORTED_CAPABILITY',
      retryable: false,
      ...(commandId ? { commandId } : {}),
    },
  }) as Promise<void>
}

/**
 * One provider-neutral executable contract. Every implementation runs the same assertions; an
 * adapter may omit a capability only by returning the contract's explicit fail-closed error.
 */
function identityPortContract(name: string, createHarness: HarnessFactory): void {
  describe(`IdentityPort contract: ${name}`, () => {
    let harness: Harness | null = null

    afterEach(async () => {
      await harness?.cleanup()
      harness = null
    })

    async function setup(): Promise<Harness> {
      harness = await createHarness()
      return harness
    }

    it('normalizes the verified application session', async () => {
      const current = await setup()
      await expect(current.port.verifyApplicationSession({ headers: new Headers() }))
        .resolves.toEqual(current.session)
    })

    it('deduplicates known principal summaries and omits unknown principals', async () => {
      const current = await setup()
      const summaries = await current.port.getPrincipalSummaries({
        principalIds: [current.knownPrincipal.id, 'unknown-principal', current.knownPrincipal.id],
      })
      expect(summaries).toEqual([current.knownPrincipal])
    })

    it('does not correlate an unknown upstream identity by email', async () => {
      const current = await setup()
      await expect(current.port.findPrincipalByFederatedSubject({
        subject: { issuer: 'https://unknown-issuer.example', subject: current.knownPrincipal.email ?? '' },
      })).resolves.toBeNull()
    })

    it('returns transport-neutral sign-out mutations and session summaries', async () => {
      const current = await setup()
      const result = await current.port.signOut({ headers: new Headers() })
      expect(Array.isArray(result.setCookies)).toBe(true)
      expect(result.setCookies.every((cookie) => typeof cookie === 'string')).toBe(true)
      const sessions = await current.port.listSessions({ actor: current.actor })
      expect(Array.isArray(sessions)).toBe(true)
      for (const session of sessions) {
        expect(session).toEqual({
          id: expect.any(String),
          createdAt: expect.any(String),
          expiresAt: expect.toSatisfy((value: unknown) => value === null || typeof value === 'string'),
          current: expect.any(Boolean),
        })
        expect(session.id).not.toContain('bearer')
      }
    })

    it('revokes an own-session handle idempotently without exposing a bearer', async () => {
      const current = await setup()
      const operation = command('own-session')
      await expect(current.port.revokeOwnSession({
        actor: current.actor,
        sessionId: current.actor.sessionId,
        command: operation,
      })).resolves.toMatchObject({ commandId: operation.commandId })
      await expect(current.port.revokeOwnSession({
        actor: current.actor,
        sessionId: current.actor.sessionId,
        command: operation,
      })).resolves.toMatchObject({ commandId: operation.commandId })
    })

    it('deprovisions only the requested installation-local principal', async () => {
      const current = await setup()
      const operation = command('deprovision')
      await expect(current.port.deprovisionLocalPrincipal({
        principalId: current.knownPrincipal.id,
        reason: 'identity-erasure',
        command: operation,
      })).resolves.toMatchObject({ commandId: operation.commandId })
      if (current.capabilities.durablePrincipalStorage) {
        await expect(current.port.getPrincipalSummaries({ principalIds: [current.knownPrincipal.id] }))
          .resolves.toEqual([])
      }
    })

    it('implements credential provisioning or rejects the entire capability explicitly', async () => {
      const current = await setup()
      const operation = command('credential')
      const create = current.port.createProvisionalCredentialPrincipal({
        email: 'new-person@example.com',
        displayName: 'New Person',
        password: 'conformance-password-123',
        emailVerified: true,
        command: operation,
      })
      if (!current.capabilities.credentials) {
        await expectUnsupported(create, operation.commandId)
        await expectUnsupported(current.port.compensateProvisionalPrincipal({
          provisional: { principalId: 'unsupported', compensationHandle: 'opaque' },
          reason: 'invitation-claim-failed',
          command: operation,
        }), operation.commandId)
        return
      }

      const provisional = await create
      expect(provisional).toEqual({
        principalId: expect.any(String),
        compensationHandle: expect.any(String),
      })
      expect(provisional.compensationHandle).not.toContain(provisional.principalId)
      await expect(current.port.compensateProvisionalPrincipal({
        provisional,
        reason: 'invitation-claim-failed',
        command: operation,
      })).resolves.toBeUndefined()
      await expect(current.port.getPrincipalSummaries({ principalIds: [provisional.principalId] }))
        .resolves.toEqual([])
    })

    it('implements reset-ceremony issue/revoke or rejects both operations explicitly', async () => {
      const current = await setup()
      const operation = command('password-reset')
      const issue = current.port.issuePasswordReset({
        targetPrincipalId: current.knownPrincipal.id,
        command: operation,
      })
      if (!current.capabilities.passwordReset) {
        await expectUnsupported(issue, operation.commandId)
        await expectUnsupported(current.port.revokePasswordResetCeremony({
          targetPrincipalId: current.knownPrincipal.id,
          ceremonyId: 'unsupported',
          command: operation,
        }), operation.commandId)
        return
      }

      const ceremony = await issue
      expect(ceremony).toEqual({
        ceremonyId: expect.any(String),
        token: expect.any(String),
        expiresAt: expect.any(String),
      })
      expect(ceremony.ceremonyId).not.toBe(ceremony.token)
      await expect(current.port.revokePasswordResetCeremony({
        targetPrincipalId: current.knownPrincipal.id,
        ceremonyId: ceremony.ceremonyId,
        command: operation,
      })).resolves.toBeUndefined()
    })

    it('implements identity-global session revocation or rejects it explicitly', async () => {
      const current = await setup()
      const operation = command('principal-sessions')
      const revoke = current.port.revokePrincipalSessions({
        targetPrincipalId: current.knownPrincipal.id,
        command: operation,
      })
      if (!current.capabilities.administrativeSessionRevocation) {
        await expectUnsupported(revoke, operation.commandId)
        return
      }
      await expect(revoke).resolves.toMatchObject({ commandId: operation.commandId })
      await expect(current.port.listSessions({ actor: current.actor })).resolves.toEqual([])
    })
  })
}

function betterAuthHarness(): Promise<Harness> {
  return (async () => {
    const db = openDb(':memory:')
    const configured = authFromEnv(db, PASSWORD_ENV)
    const realAuth = configured.auth!
    await runAuthMigrations(realAuth)
    const created = await realAuth.createCredentialUser(
      PRINCIPAL.email,
      PRINCIPAL.displayName,
      'conformance-password-123',
      true,
    )
    const token = 'conformance-session-bearer'
    const sessionId = applicationSessionHandle(APPLICATION_ID, token)
    db.prepare(`
      INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, ipAddress, userAgent, userId)
      VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
    `).run('session-row-1', LATER, token, NOW, NOW, created.id)
    recordSessionAssurance(db, sessionId, created.id, 'password')
    const session: ApplicationSession = {
      id: sessionId,
      principal: { ...PRINCIPAL, id: created.id },
      createdAt: NOW,
      expiresAt: LATER,
      freshUntil: '2026-07-18T10:15:00.000Z',
      assurance: 'password',
    }
    const auth: Auth = {
      ...realAuth,
      api: {
        ...realAuth.api,
        getSession: async () => ({
          user: {
            id: created.id,
            name: PRINCIPAL.displayName,
            email: PRINCIPAL.email,
            emailVerified: true,
          },
          session: { id: sessionId, createdAt: NOW, expiresAt: LATER },
        }),
      },
    }
    const actor = { ...ACTOR, principalId: created.id, sessionId }
    return {
      port: betterAuthIdentityPort({
        applicationId: APPLICATION_ID,
        auth,
        authMode: 'password',
        db,
      }),
      session,
      actor,
      knownPrincipal: {
        id: created.id,
        displayName: PRINCIPAL.displayName,
        email: PRINCIPAL.email,
      },
      capabilities: {
        durablePrincipalStorage: true,
        credentials: true,
        passwordReset: true,
        administrativeSessionRevocation: true,
      },
      cleanup: () => db.close(),
    }
  })()
}

function trustedLocalHarness(): Harness {
  const session: ApplicationSession = {
    id: 'trusted-local',
    principal: PRINCIPAL,
    createdAt: '1970-01-01T00:00:00.000Z',
    expiresAt: null,
    freshUntil: null,
    assurance: 'trusted-local',
  }
  return {
    port: trustedLocalIdentityPort(PRINCIPAL),
    session,
    actor: { ...ACTOR, sessionId: session.id, assurance: 'trusted-local' },
    knownPrincipal: {
      id: PRINCIPAL.id,
      displayName: PRINCIPAL.displayName,
      email: PRINCIPAL.email,
    },
    capabilities: {
      durablePrincipalStorage: false,
      credentials: false,
      passwordReset: false,
      administrativeSessionRevocation: false,
    },
    cleanup: () => {},
  }
}

function fakeIdentityHarness(): Harness {
  const principals = new Map<string, PrincipalSummary>([[PRINCIPAL.id, {
    id: PRINCIPAL.id,
    displayName: PRINCIPAL.displayName,
    email: PRINCIPAL.email,
  }]])
  const sessions = new Map<string, SessionSummary>([[ACTOR.sessionId, {
    id: ACTOR.sessionId,
    createdAt: NOW,
    expiresAt: LATER,
    current: true,
  }]])
  const provisional = new Map<string, ProvisionalPrincipal>()
  const receipt = (operation: CommandIdentity): OperationReceipt => ({
    commandId: operation.commandId,
    completedAt: NOW,
  })
  const port: IdentityPort = {
    async verifyApplicationSession() {
      return {
        id: ACTOR.sessionId,
        principal: PRINCIPAL,
        createdAt: NOW,
        expiresAt: LATER,
        freshUntil: '2026-07-18T10:10:00.000Z',
        assurance: 'password',
      }
    },
    async getPrincipalSummaries({ principalIds }) {
      return [...new Set(principalIds)].flatMap((id) => {
        const summary = principals.get(id)
        return summary ? [summary] : []
      })
    },
    async findPrincipalByFederatedSubject() { return null },
    async signOut() { return { setCookies: [] } },
    async listSessions({ actor }) {
      return [...sessions.values()].filter(() => actor.principalId === PRINCIPAL.id)
    },
    async revokeOwnSession({ sessionId, command: operation }) {
      sessions.delete(sessionId)
      return receipt(operation)
    },
    async createProvisionalCredentialPrincipal({ email, displayName, command: operation }) {
      const value = {
        principalId: `fake-${operation.commandId}`,
        compensationHandle: `opaque-${operation.idempotencyKey}`,
      }
      provisional.set(value.principalId, value)
      principals.set(value.principalId, { id: value.principalId, displayName, email })
      return value
    },
    async compensateProvisionalPrincipal({ provisional: value }) {
      if (!provisional.delete(value.principalId)) throw new Error('unknown provisional principal')
      principals.delete(value.principalId)
    },
    async deprovisionLocalPrincipal({ principalId, command: operation }) {
      principals.delete(principalId)
      return receipt(operation)
    },
    async issuePasswordReset({ command: operation }) {
      return {
        ceremonyId: `ceremony-${operation.commandId}`,
        token: `token-${operation.idempotencyKey}`,
        expiresAt: LATER,
      }
    },
    async revokePasswordResetCeremony() {},
    async revokePrincipalSessions({ command: operation }) {
      sessions.clear()
      return receipt(operation)
    },
  }
  return {
    port,
    session: {
      id: ACTOR.sessionId,
      principal: PRINCIPAL,
      createdAt: NOW,
      expiresAt: LATER,
      freshUntil: '2026-07-18T10:10:00.000Z',
      assurance: 'password',
    },
    actor: ACTOR,
    knownPrincipal: principals.get(PRINCIPAL.id)!,
    capabilities: {
      durablePrincipalStorage: true,
      credentials: true,
      passwordReset: true,
      administrativeSessionRevocation: true,
    },
    cleanup: () => {},
  }
}

identityPortContract('Better Auth adapter', betterAuthHarness)
identityPortContract('trusted-local adapter', trustedLocalHarness)
identityPortContract('vendor-free fake', fakeIdentityHarness)

describe('IdentityPort conformance calibration', () => {
  it('uses the canonical contract error for unsupported capabilities', () => {
    const error = new AccountContractError({
      code: 'UNSUPPORTED_CAPABILITY',
      message: 'unsupported',
      retryable: false,
    })
    expect(error.failure.code).toBe('UNSUPPORTED_CAPABILITY')
  })
})
