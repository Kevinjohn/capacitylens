import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { AccountContractError } from '@capacitylens/shared/account/errors'
import type { IdentityPort } from '@capacitylens/shared/account/ports'
import type {
  ApplicationSession,
  OperationReceipt,
  PrincipalSummary,
  ProvisionalPrincipal,
  SessionSummary,
} from '@capacitylens/shared/account/types'
import { validateCredentialInput } from '@capacitylens/shared/account/validation'
import {
  RESET_LINK_TTL_SECONDS,
  SESSION_ABSOLUTE_TTL_SECONDS,
  SESSION_FRESH_AGE_SECONDS,
  SESSION_INACTIVITY_TTL_SECONDS,
  mintPasswordResetToken,
  revokeResetTokensForUser,
  type Auth,
  type AuthMode,
} from '../auth'
import type { Db } from '../db'
import { tx } from '../txn'
import {
  erasePrincipalCommandHistoryInTx,
  getSessionAuthentication,
  providerIdForIssuer,
  removePrincipalSessionAssurance,
  removeSecurityRevision,
  removeSessionAssurance,
} from './state'
import { applicationSessionHandle } from './sessionHandle'

export interface LocalIdentityPort extends IdentityPort {
  /** Embedded-only capability used while the coordinator already owns the SQLite transaction. */
  deprovisionLocalPrincipalInTx(principalId: string, exceptCommandId?: string): void
}

function providerFailure(message: string, cause: unknown): AccountContractError {
  return new AccountContractError({
    code: 'DEPENDENCY_UNAVAILABLE',
    message,
    retryable: true,
  }, { cause })
}

function invalidProviderSession(message: string): AccountContractError {
  return new AccountContractError({
    code: 'DEPENDENCY_INVALID_RESPONSE',
    message,
    retryable: false,
  })
}

function providerErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const body = (error as { body?: unknown }).body
  if (!body || typeof body !== 'object') return null
  const code = (body as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

function stableFallbackSessionId(applicationId: string, principalId: string, createdAt: string): string {
  return createHash('sha256')
    .update(`${applicationId}-session-id\0`)
    .update(principalId)
    .update('\0')
    .update(createdAt)
    .digest('base64url')
}

function iso(value: string | number): string {
  return new Date(timestampMs(value)).toISOString()
}

function timestampMs(value: string | number): number {
  const numeric = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value
  return typeof numeric === 'number' && numeric < 10_000_000_000
    ? numeric * 1000
    : new Date(numeric).getTime()
}

function receipt(commandId: string): OperationReceipt {
  return { commandId, completedAt: new Date().toISOString() }
}

function tableExists(db: Db, table: string): boolean {
  return db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(table) !== undefined
}

function accountLinkUserId(value: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const link = (parsed as { link?: unknown }).link
  if (typeof link !== 'object' || link === null) return null
  const userId = (link as { userId?: unknown }).userId
  if (typeof userId === 'string') return userId
  return typeof userId === 'number' && Number.isFinite(userId) ? String(userId) : null
}

/** Delete only this installation's Better Auth identity state inside the caller's transaction. */
function eraseLocalPrincipalInTx(db: Db, principalId: string): void {
  if (!tableExists(db, 'user')) return

  removePrincipalSessionAssurance(db, principalId)
  if (tableExists(db, 'verification')) {
    const rows = db.prepare(`SELECT id, value FROM verification`).all() as Array<{
      id: string
      value: string
    }>
    const removeVerification = db.prepare(`DELETE FROM verification WHERE id = ?`)
    for (const row of rows) {
      if (row.value === principalId || accountLinkUserId(row.value) === principalId) {
        removeVerification.run(row.id)
      }
    }
  }

  if (tableExists(db, 'session')) {
    db.prepare(`DELETE FROM session WHERE userId = ?`).run(principalId)
  }
  if (tableExists(db, 'account')) {
    db.prepare(`DELETE FROM account WHERE userId = ?`).run(principalId)
  }
  if (tableExists(db, 'twoFactor')) {
    db.prepare(`DELETE FROM twoFactor WHERE userId = ?`).run(principalId)
  }
  db.prepare(`DELETE FROM user WHERE id = ?`).run(principalId)
  removeSecurityRevision(db, principalId)
}

/** Better Auth and SQLite mechanics narrowed behind the provider-neutral IdentityPort. */
export function betterAuthIdentityPort(input: {
  applicationId: string
  auth: Auth
  authMode: Exclude<AuthMode, 'off'>
  db: Db
  publicBaseUrl?: string
}): LocalIdentityPort {
  const { applicationId, auth, authMode, db } = input
  const compensationKey = randomBytes(32)

  const makeCompensationHandle = (principalId: string, commandId: string): string =>
    createHash('sha256')
      .update(compensationKey)
      .update('\0')
      .update(principalId)
      .update('\0')
      .update(commandId)
      .digest('base64url')

  const assertCompensationHandle = (
    provisional: ProvisionalPrincipal,
    commandId: string,
  ): void => {
    const expected = Buffer.from(makeCompensationHandle(provisional.principalId, commandId))
    const actual = Buffer.from(provisional.compensationHandle)
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new AccountContractError({
        code: 'FORBIDDEN',
        message: 'The provisional-principal compensation handle is invalid.',
        retryable: false,
        commandId,
      })
    }
  }

  return {
    deprovisionLocalPrincipalInTx(principalId, exceptCommandId): void {
      erasePrincipalCommandHistoryInTx(db, principalId, exceptCommandId)
      eraseLocalPrincipalInTx(db, principalId)
    },
    async verifyApplicationSession({ headers }): Promise<ApplicationSession | null> {
      try {
        const resolved = await auth.api.getSession({ headers })
        if (!resolved) return null
        // A nonstandard adapter may omit the timestamp. Preserve authentication for ordinary reads,
        // but make the session provably stale so privileged freshness gates fail closed.
        const createdAt = resolved.session?.createdAt ?? resolved.user.sessionCreatedAt ?? '1970-01-01T00:00:00.000Z'
        const authentication = getSessionAuthentication(db, resolved.session?.id ?? '')
        if (!authentication) {
          const providerRows = tableExists(db, 'account')
            ? db.prepare(`SELECT providerId FROM account WHERE userId = ?`)
              .all(resolved.user.id) as Array<{ providerId: string }>
            : []
          // Sessions created before the assurance migration may continue only when the principal is
          // unambiguously credential-only. An external or mixed principal without per-session
          // provenance must sign in again; treating it as password-authenticated would erase the
          // issuer/subject binding and could weaken an MFA or SSO policy.
          if (providerRows.length === 0 || providerRows.some((row) => row.providerId !== 'credential')) {
            throw invalidProviderSession(
              'The session has no trustworthy authentication-method provenance.',
            )
          }
        }
        const linkedRows = authentication?.assurance === 'federated' && authentication.providerId && tableExists(db, 'account')
          ? db.prepare(`
              SELECT providerId, accountId
                FROM account
               WHERE userId = ? AND providerId = ?
               ORDER BY providerId, accountId
               LIMIT 2
            `).all(resolved.user.id, authentication.providerId) as Array<{ providerId: string; accountId: string }>
          : []
        if (linkedRows.length > 1) {
          throw invalidProviderSession(
            'The federated session maps to more than one immutable local issuer/subject binding.',
          )
        }
        const linked = linkedRows[0]
        const linkedIssuer = linked ? auth.federatedIssuers.get(linked.providerId) : undefined
        if (authentication?.assurance === 'federated' && (!linked || !linkedIssuer)) {
          throw invalidProviderSession(
            'The federated session has no active immutable local issuer/subject binding.',
          )
        }
        if (authMode === 'sso' && authentication?.assurance !== 'federated') {
          throw invalidProviderSession(
            'The SSO-only profile received a session without federated assurance metadata.',
          )
        }
        const assurance = authentication?.assurance === 'federated' && linked
          ? 'federated'
          : authentication?.assurance === 'mfa'
            ? 'mfa'
            : 'password'
        return {
          id: resolved.session?.id ?? stableFallbackSessionId(applicationId, resolved.user.id, createdAt),
          principal: {
            id: resolved.user.id,
            displayName: resolved.user.name,
            email: resolved.user.email,
            emailVerified: resolved.user.emailVerified,
            linkedSubject: linked
              ? {
                  issuer: linkedIssuer!,
                  subject: linked.accountId,
                }
              : null,
          },
          createdAt,
          expiresAt: resolved.session?.expiresAt ?? new Date(
            Date.parse(createdAt) + SESSION_ABSOLUTE_TTL_SECONDS * 1000,
          ).toISOString(),
          freshUntil: new Date(
            Date.parse(createdAt) + SESSION_FRESH_AGE_SECONDS * 1000,
          ).toISOString(),
          assurance,
        }
      } catch (error) {
        if (error instanceof AccountContractError) throw error
        throw providerFailure('Session verification is temporarily unavailable.', error)
      }
    },

    async getPrincipalSummaries({ principalIds }): Promise<readonly PrincipalSummary[]> {
      if (principalIds.length === 0) return []
      try {
        const unique = [...new Set(principalIds)]
        const summaries: PrincipalSummary[] = []
        for (let offset = 0; offset < unique.length; offset += 500) {
          const chunk = unique.slice(offset, offset + 500)
          const placeholders = chunk.map(() => '?').join(', ')
          summaries.push(...db.prepare(
            `SELECT id, name, email FROM user WHERE id IN (${placeholders})`,
          ).all(...chunk).map((row) => {
            const value = row as { id: string; name: string | null; email: string | null }
            return { id: value.id, displayName: value.name, email: value.email }
          }))
        }
        return summaries
      } catch (error) {
        throw providerFailure('Identity summaries are temporarily unavailable.', error)
      }
    },

    async findPrincipalByFederatedSubject({ subject }): Promise<PrincipalSummary | null> {
      try {
        // The identity key is the provider/issuer plus upstream subject pair. Email is deliberately
        // absent from this lookup and can never correlate two product identities.
        const providerId = providerIdForIssuer(db, applicationId, subject.issuer)
        if (!providerId) return null
        const rows = db.prepare(`
          SELECT u.id, u.name, u.email
            FROM account AS a
            JOIN user AS u ON u.id = a.userId
           WHERE a.providerId = ? AND a.accountId = ?
           LIMIT 2
        `).all(providerId, subject.subject) as Array<{
          id: string
          name: string | null
          email: string | null
        }>
        if (rows.length > 1) {
          throw invalidProviderSession('The federated subject maps to more than one local principal.')
        }
        const row = rows[0]
        return row ? { id: row.id, displayName: row.name, email: row.email } : null
      } catch (error) {
        if (error instanceof AccountContractError) throw error
        throw providerFailure('Federated identity lookup is temporarily unavailable.', error)
      }
    },

    async signOut({ headers }) {
      try {
        const configuredBaseUrl = typeof auth.options.baseURL === 'string'
          ? auth.options.baseURL
          : 'http://localhost'
        const response = await auth.handler(new Request(
          new URL('/api/auth/sign-out', input.publicBaseUrl ?? configuredBaseUrl),
          { method: 'POST', headers },
        ))
        if (!response.ok) throw new Error(`Identity provider returned HTTP ${response.status}.`)
        // Better Auth's session-delete database hook removes the assurance row in the same delete
        // path. Do not pre-resolve the session here: the sign-out endpoint already resolves it and a
        // second lookup would double the authenticated request's database work.
        const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
        return {
          setCookies: getSetCookie
            ? getSetCookie.call(response.headers)
            : response.headers.get('set-cookie')
              ? [response.headers.get('set-cookie')!]
              : [],
        }
      } catch (error) {
        throw providerFailure('Sign-out is temporarily unavailable.', error)
      }
    },

    async listSessions({ actor }): Promise<readonly SessionSummary[]> {
      try {
        const rows = db.prepare(`
          SELECT id, token, createdAt, updatedAt, expiresAt
            FROM session
           WHERE userId = ?
           ORDER BY createdAt DESC
        `).all(actor.principalId) as Array<{
          id: string
          token: string
          createdAt: string | number
          updatedAt: string | number
          expiresAt: string | number | null
        }>
        const now = Date.now()
        const active: SessionSummary[] = []
        tx(db, () => {
          for (const row of rows) {
            const createdAt = timestampMs(row.createdAt)
            const updatedAt = timestampMs(row.updatedAt)
            const providerExpiry = row.expiresAt === null ? null : timestampMs(row.expiresAt)
            const stale =
              !Number.isFinite(createdAt) ||
              !Number.isFinite(updatedAt) ||
              (providerExpiry !== null && !Number.isFinite(providerExpiry)) ||
              now >= createdAt + SESSION_ABSOLUTE_TTL_SECONDS * 1000 ||
              now >= updatedAt + SESSION_INACTIVITY_TTL_SECONDS * 1000 ||
              (providerExpiry !== null && now >= providerExpiry)
            const handle = applicationSessionHandle(applicationId, row.token)
            if (stale) {
              db.prepare(`DELETE FROM session WHERE id = ? AND userId = ?`).run(row.id, actor.principalId)
              removeSessionAssurance(db, handle)
              continue
            }
            active.push({
              id: handle,
              createdAt: iso(row.createdAt),
              expiresAt: row.expiresAt === null ? null : iso(row.expiresAt),
              current: handle === actor.sessionId,
            })
          }
        })
        return active
      } catch (error) {
        throw providerFailure('Session listing is temporarily unavailable.', error)
      }
    },

    async revokeOwnSession({ actor, sessionId, command }): Promise<OperationReceipt> {
      try {
        const rows = db.prepare(`SELECT id, token FROM session WHERE userId = ?`)
          .all(actor.principalId) as Array<{ id: string; token: string }>
        const row = rows.find((candidate) =>
          applicationSessionHandle(applicationId, candidate.token) === sessionId)
        if (row) {
          tx(db, () => {
            db.prepare(`DELETE FROM session WHERE id = ? AND userId = ?`).run(row.id, actor.principalId)
            removeSessionAssurance(db, sessionId)
          })
        }
        return receipt(command.commandId)
      } catch (error) {
        throw providerFailure('Session revocation is temporarily unavailable.', error)
      }
    },

    async createProvisionalCredentialPrincipal({
      email,
      displayName,
      password,
      emailVerified,
      command,
    }): Promise<ProvisionalPrincipal> {
      if (authMode !== 'password') {
        throw new AccountContractError({
          code: 'UNSUPPORTED_CAPABILITY',
          message: 'Credential identities are disabled for this installation.',
          retryable: false,
          commandId: command.commandId,
        })
      }
      const validation = validateCredentialInput({ email, displayName, password })
      if (validation) {
        throw new AccountContractError({
          code: 'VALIDATION_FAILED',
          message: validation === 'password-length'
            ? 'The password does not meet the configured length policy.'
            : validation === 'email'
              ? 'The email address is not normalized or valid.'
              : 'The display name is not valid.',
          retryable: false,
          commandId: command.commandId,
        })
      }
      try {
        const created = await auth.createCredentialUser(email, displayName, password, emailVerified)
        return {
          principalId: created.id,
          compensationHandle: makeCompensationHandle(created.id, command.commandId),
        }
      } catch (error) {
        if (providerErrorCode(error) === 'PASSWORD_COMPROMISED') {
          throw new AccountContractError({
            code: 'VALIDATION_FAILED',
            message: error instanceof Error && error.message
              ? error.message
              : 'The password does not meet the configured security policy.',
            retryable: false,
            commandId: command.commandId,
          }, { cause: error })
        }
        const message = error instanceof Error ? error.message : ''
        if (/unique|already|exists/i.test(message)) {
          throw new AccountContractError({
            code: 'IDENTITY_ALREADY_EXISTS',
            message: 'A sign-in identity already exists for that email address.',
            retryable: false,
            commandId: command.commandId,
          }, { cause: error })
        }
        throw providerFailure('Identity creation is temporarily unavailable.', error)
      }
    },

    async compensateProvisionalPrincipal({ provisional, command }): Promise<void> {
      assertCompensationHandle(provisional, command.commandId)
      try {
        tx(db, () => {
          erasePrincipalCommandHistoryInTx(db, provisional.principalId, command.commandId)
          eraseLocalPrincipalInTx(db, provisional.principalId)
        })
      } catch (error) {
        throw providerFailure('Provisional identity compensation failed.', error)
      }
    },

    async deprovisionLocalPrincipal({ principalId, command }): Promise<OperationReceipt> {
      try {
        // This deletes only the installation-local user and local provider-link rows. It never calls
        // an upstream IdP deletion or management API.
        tx(db, () => {
          erasePrincipalCommandHistoryInTx(db, principalId, command.commandId)
          eraseLocalPrincipalInTx(db, principalId)
        })
        return receipt(command.commandId)
      } catch (error) {
        throw providerFailure('Local identity deprovisioning failed.', error)
      }
    },

    async issuePasswordReset({ targetPrincipalId, command }) {
      if (authMode !== 'password') {
        throw new AccountContractError({
          code: 'UNSUPPORTED_CAPABILITY',
          message: 'Password reset is unavailable for an SSO-only installation.',
          retryable: false,
          commandId: command.commandId,
        })
      }
      try {
        const row = db.prepare(`SELECT email FROM user WHERE id = ?`).get(targetPrincipalId) as
          | { email: string }
          | undefined
        if (!row?.email) {
          throw new AccountContractError({
            code: 'NOT_FOUND',
            message: 'No local sign-in identity exists for this member.',
            retryable: false,
            commandId: command.commandId,
          })
        }
        const token = await mintPasswordResetToken(auth, row.email)
        if (!token) {
          throw new AccountContractError({
            code: 'NOT_FOUND',
            message: 'No local sign-in identity exists for this member.',
            retryable: false,
            commandId: command.commandId,
          })
        }
        return {
          ceremonyId: createHash('sha256')
            .update(`${applicationId}-reset-ceremony\0`)
            .update(token)
            .digest('base64url'),
          token,
          expiresAt: new Date(Date.now() + RESET_LINK_TTL_SECONDS * 1000).toISOString(),
        }
      } catch (error) {
        if (error instanceof AccountContractError) throw error
        throw providerFailure('Password-reset issuance is temporarily unavailable.', error)
      }
    },

    async revokePasswordResetCeremony({ targetPrincipalId }): Promise<void> {
      try {
        // Better Auth hashes ceremony identifiers at rest, so targeted deletion is unavailable.
        // Conservatively revoking every outstanding ceremony for this principal is fail-closed.
        revokeResetTokensForUser(db, targetPrincipalId)
      } catch (error) {
        throw providerFailure('Password-reset ceremony revocation failed.', error)
      }
    },

    async revokePrincipalSessions({ targetPrincipalId, command }): Promise<OperationReceipt> {
      try {
        const sessions = db.prepare(`SELECT token FROM session WHERE userId = ?`)
          .all(targetPrincipalId) as Array<{ token: string }>
        await auth.revokeUserSessions(targetPrincipalId)
        for (const session of sessions) {
          removeSessionAssurance(db, applicationSessionHandle(applicationId, session.token))
        }
        return receipt(command.commandId)
      } catch (error) {
        throw providerFailure('Session revocation is temporarily unavailable.', error)
      }
    },
  }
}
