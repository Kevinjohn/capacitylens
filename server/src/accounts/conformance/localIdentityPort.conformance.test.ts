import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Auth, SessionUser } from '../../auth'
import { openDb, type Db } from '../../db'
import { betterAuthIdentityPort } from '../betterAuthIdentityPort'
import {
  bindFederatedProvider,
  getAccountCommand,
  recordSessionAssurance,
  reserveAccountCommand,
} from '../state'

const sessionUser: SessionUser = {
  id: 'principal-1',
  name: 'One',
  email: 'same@example.com',
  emailVerified: true,
}

function auth(getSession: Auth['api']['getSession']): Auth {
  return {
    handler: vi.fn(async () => new Response(null, { status: 200 })),
    api: { getSession, requestPasswordReset: vi.fn(async () => ({ status: true })) },
    options: {},
    providers: [],
    federatedIssuers: new Map([['sso', 'https://issuer.example']]),
    ensureProviderBindings: vi.fn(),
    createCredentialUser: vi.fn(async () => ({ id: 'created-principal' })),
    deleteCredentialUser: vi.fn(async () => {}),
    revokeUserSessions: vi.fn(async () => {}),
  }
}

function identityTables(db: Db): void {
  db.exec(`
    CREATE TABLE user (
      id TEXT PRIMARY KEY,
      name TEXT,
      email TEXT NOT NULL
    );
    CREATE TABLE account (
      id TEXT PRIMARY KEY,
      providerId TEXT NOT NULL,
      accountId TEXT NOT NULL,
      userId TEXT NOT NULL
    );
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL
    );
    CREATE TABLE verification (
      id TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `)
}

describe('local IdentityPort conformance', () => {
  let db: Db | null = null

  afterEach(() => {
    db?.close()
    db = null
  })

  it('normalizes a federated application session without exposing provider records', async () => {
    db = openDb(':memory:')
    identityTables(db)
    db.prepare(`INSERT INTO user (id, name, email) VALUES (?, ?, ?)`).run(
      sessionUser.id,
      sessionUser.name,
      sessionUser.email,
    )
    db.prepare(`INSERT INTO account (id, providerId, accountId, userId) VALUES (?, ?, ?, ?)`).run(
      'link-1',
      'sso',
      'upstream-subject-1',
      sessionUser.id,
    )
    bindFederatedProvider(db, 'conformance-app', 'https://issuer.example', 'sso')
    recordSessionAssurance(db, 'local-session-1', sessionUser.id, 'federated', 'sso')
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: 'local-session-1',
          createdAt: '2026-07-18T00:00:00.000Z',
          expiresAt: '2026-07-18T12:00:00.000Z',
        },
      })),
      authMode: 'sso',
      db,
    })

    await expect(port.verifyApplicationSession({ headers: new Headers() })).resolves.toMatchObject({
      id: 'local-session-1',
      assurance: 'federated',
      principal: {
        id: 'principal-1',
        emailVerified: true,
        linkedSubject: { issuer: 'https://issuer.example', subject: 'upstream-subject-1' },
      },
    })
  })

  it('correlates only by issuer and subject, never by equal email', async () => {
    db = openDb(':memory:')
    identityTables(db)
    db.prepare(`INSERT INTO user (id, name, email) VALUES (?, ?, ?), (?, ?, ?)`).run(
      'principal-1', 'One', 'same@example.com',
      'principal-2', 'Two', 'same@example.com',
    )
    db.prepare(`INSERT INTO account (id, providerId, accountId, userId) VALUES (?, ?, ?, ?), (?, ?, ?, ?)`).run(
      'link-1', 'sso', 'subject-1', 'principal-1',
      'link-2', 'sso', 'subject-2', 'principal-2',
    )
    bindFederatedProvider(db, 'conformance-app', 'https://issuer.example', 'sso')
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: auth(async () => null),
      authMode: 'sso',
      db,
    })

    await expect(port.findPrincipalByFederatedSubject({
      subject: { issuer: 'https://issuer.example', subject: 'subject-2' },
    })).resolves.toEqual({ id: 'principal-2', displayName: 'Two', email: 'same@example.com' })
    await expect(port.findPrincipalByFederatedSubject({
      subject: { issuer: 'https://different.example', subject: 'subject-2' },
    })).resolves.toBeNull()
  })

  it('does not upgrade a password-authenticated session merely because the user has a federated link', async () => {
    db = openDb(':memory:')
    identityTables(db)
    db.prepare(`INSERT INTO user (id, name, email) VALUES (?, ?, ?)`).run(
      sessionUser.id,
      sessionUser.name,
      sessionUser.email,
    )
    db.prepare(`INSERT INTO account (id, providerId, accountId, userId) VALUES (?, ?, ?, ?)`).run(
      'link-1',
      'sso',
      'upstream-subject-1',
      sessionUser.id,
    )
    recordSessionAssurance(db, 'password-session-1', sessionUser.id, 'password')
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: 'password-session-1',
          createdAt: '2026-07-18T00:00:00.000Z',
          expiresAt: '2026-07-18T12:00:00.000Z',
        },
      })),
      authMode: 'password',
      db,
    })

    await expect(port.verifyApplicationSession({ headers: new Headers() })).resolves.toMatchObject({
      assurance: 'password',
      principal: { linkedSubject: null },
    })
  })

  it('does not infer per-session MFA assurance from account-level MFA enrollment', async () => {
    db = openDb(':memory:')
    identityTables(db)
    db.prepare(`INSERT INTO account (id, providerId, accountId, userId) VALUES (?, ?, ?, ?)`).run(
      'credential-link',
      'credential',
      sessionUser.id,
      sessionUser.id,
    )
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: auth(async () => ({
        user: { ...sessionUser, twoFactorEnabled: true },
        session: {
          id: 'legacy-session-without-assurance',
          createdAt: '2026-07-18T00:00:00.000Z',
          expiresAt: '2026-07-18T12:00:00.000Z',
        },
      })),
      authMode: 'password',
      db,
    })

    await expect(port.verifyApplicationSession({ headers: new Headers() }))
      .resolves.toMatchObject({ assurance: 'password' })
  })

  it('fails closed when a mixed or external legacy session lacks provenance metadata', async () => {
    db = openDb(':memory:')
    identityTables(db)
    db.prepare(`INSERT INTO account (id, providerId, accountId, userId) VALUES (?, ?, ?, ?)`).run(
      'external-link',
      'sso',
      'upstream-subject',
      sessionUser.id,
    )
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: 'legacy-external-session-without-assurance',
          createdAt: '2026-07-18T00:00:00.000Z',
          expiresAt: '2026-07-18T12:00:00.000Z',
        },
      })),
      authMode: 'password',
      db,
    })

    await expect(port.verifyApplicationSession({ headers: new Headers() }))
      .rejects.toMatchObject({ failure: { code: 'DEPENDENCY_INVALID_RESPONSE' } })
  })

  it('fails closed when an SSO session has no federated assurance record', async () => {
    db = openDb(':memory:')
    identityTables(db)
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: 'unclassified-sso-session',
          createdAt: '2026-07-18T00:00:00.000Z',
          expiresAt: '2026-07-18T12:00:00.000Z',
        },
      })),
      authMode: 'sso',
      db,
    })

    await expect(port.verifyApplicationSession({ headers: new Headers() }))
      .rejects.toMatchObject({
        failure: { code: 'DEPENDENCY_INVALID_RESPONSE', retryable: false },
      })
  })

  it('fails closed when a federated assurance record has no issuer/subject link', async () => {
    db = openDb(':memory:')
    identityTables(db)
    recordSessionAssurance(db, 'orphaned-federated-session', sessionUser.id, 'federated', 'sso')
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: auth(async () => ({
        user: sessionUser,
        session: {
          id: 'orphaned-federated-session',
          createdAt: '2026-07-18T00:00:00.000Z',
          expiresAt: '2026-07-18T12:00:00.000Z',
        },
      })),
      authMode: 'sso',
      db,
    })

    await expect(port.verifyApplicationSession({ headers: new Headers() }))
      .rejects.toMatchObject({
        failure: { code: 'DEPENDENCY_INVALID_RESPONSE', retryable: false },
      })
  })

  it('validates credential input before calling the identity provider', async () => {
    db = openDb(':memory:')
    identityTables(db)
    const configuredAuth = auth(async () => null)
    const create = vi.mocked(configuredAuth.createCredentialUser)
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: configuredAuth,
      authMode: 'password',
      db,
    })

    await expect(port.createProvisionalCredentialPrincipal({
      email: ' Person@Example.com ',
      displayName: 'Person',
      password: 'a-valid-length-password',
      emailVerified: true,
      command: { commandId: 'invalid-command', idempotencyKey: 'invalid-idempotency' },
    })).rejects.toMatchObject({ failure: { code: 'VALIDATION_FAILED' } })
    expect(create).not.toHaveBeenCalled()
  })

  it('maps provider password-policy rejection to a terminal validation failure', async () => {
    db = openDb(':memory:')
    identityTables(db)
    const configuredAuth = auth(async () => null)
    vi.mocked(configuredAuth.createCredentialUser).mockRejectedValue(Object.assign(
      new Error('This password appears in a known breach. Choose a different password.'),
      { body: { code: 'PASSWORD_COMPROMISED' } },
    ))
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: configuredAuth,
      authMode: 'password',
      db,
    })

    await expect(port.createProvisionalCredentialPrincipal({
      email: 'person@example.com',
      displayName: 'Person',
      password: 'a-valid-length-password',
      emailVerified: true,
      command: { commandId: 'policy-command', idempotencyKey: 'policy-idempotency' },
    })).rejects.toMatchObject({
      failure: {
        code: 'VALIDATION_FAILED',
        retryable: false,
        commandId: 'policy-command',
      },
    })
  })

  it('erases command-ledger correlation when compensating a provisional principal', async () => {
    db = openDb(':memory:')
    identityTables(db)
    const configuredAuth = auth(async () => null)
    const port = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: configuredAuth,
      authMode: 'password',
      db,
    })
    const command = { commandId: 'parent-command', idempotencyKey: 'parent-key' }
    const provisional = await port.createProvisionalCredentialPrincipal({
      email: 'person@example.com',
      displayName: 'Person',
      password: 'a-valid-length-password',
      emailVerified: true,
      command,
    })
    for (const [operation, commandId, idempotencyKey] of [
      ['parent', command.commandId, command.idempotencyKey],
      ['child', 'child-command', 'child-key'],
    ] as const) {
      reserveAccountCommand(db, {
        applicationId: 'conformance-app',
        operation,
        idempotencyKey,
        commandId,
        actorPrincipalId: null,
        targetPrincipalId: provisional.principalId,
        payloadHash: 'a'.repeat(64),
      })
    }

    await port.compensateProvisionalPrincipal({
      provisional,
      reason: 'invitation-claim-failed',
      command,
    })

    expect(getAccountCommand(db, 'conformance-app', 'child', 'child-key')).toBeNull()
    expect(getAccountCommand(db, 'conformance-app', 'parent', 'parent-key'))
      .toMatchObject({ targetPrincipalId: null })
  })

  it('keeps no session distinct from a retryable provider failure', async () => {
    db = openDb(':memory:')
    identityTables(db)
    const absent = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: auth(async () => null),
      authMode: 'sso',
      db,
    })
    await expect(absent.verifyApplicationSession({ headers: new Headers() })).resolves.toBeNull()

    const failed = betterAuthIdentityPort({
      applicationId: 'conformance-app',
      auth: auth(async () => { throw new Error('provider unavailable') }),
      authMode: 'sso',
      db,
    })
    await expect(failed.verifyApplicationSession({ headers: new Headers() })).rejects.toMatchObject({
      failure: { code: 'DEPENDENCY_UNAVAILABLE', retryable: true },
    })
  })
})
