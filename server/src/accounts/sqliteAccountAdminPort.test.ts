import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AccountAuditEvent } from '@capacitylens/shared/account/audit'
import type { ActorContext } from '@capacitylens/shared/account/types'
import { upsertMember } from '../controlTables'
import { openDb, insertRow, type Db } from '../db'
import { KeyedOperationLock } from './operationLock'
import { sqliteAccountAdminPort } from './sqliteAccountAdminPort'

const actor: ActorContext = {
  principalId: 'owner-1',
  sessionId: 'session-1',
  assurance: 'mfa',
  fresh: true,
  mfaSatisfied: true,
}

const command = { commandId: 'command-1', idempotencyKey: 'idempotency-1' }

describe('sqliteAccountAdminPort invitation secrecy', () => {
  let db: Db | null = null

  afterEach(() => {
    db?.close()
    db = null
  })

  it('never persists a raw invitation token in the durable command ledger', async () => {
    db = openDb(':memory:')
    insertRow(db, 'accounts', {
      id: 'workspace-1',
      name: 'Workspace',
      color: '#6366f1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const port = sqliteAccountAdminPort({
      applicationId: 'test-application',
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    })

    const created = await port.createInvitation({
      actor,
      workspaceId: 'workspace-1',
      role: 'editor',
      preauthorizedEmail: 'person@example.com',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      command,
    })
    const persisted = db.prepare(
      `SELECT resultJson FROM account_commands WHERE commandId = ?`,
    ).get(command.commandId) as { resultJson: string }

    expect(created.token).toHaveLength(43)
    expect(persisted.resultJson).not.toContain(created.token)
    expect(JSON.parse(persisted.resultJson)).not.toHaveProperty('token')

    await expect(port.createInvitation({
      actor,
      workspaceId: 'workspace-1',
      role: 'editor',
      preauthorizedEmail: 'person@example.com',
      expiresAt: created.expiresAt,
      command,
    })).resolves.toEqual(created)
  })

  it('does not reconstruct a write-once token after an adapter restart', async () => {
    db = openDb(':memory:')
    insertRow(db, 'accounts', {
      id: 'workspace-1',
      name: 'Workspace',
      color: '#6366f1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const input = {
      applicationId: 'test-application',
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    }
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
    await sqliteAccountAdminPort(input).createInvitation({
      actor,
      workspaceId: 'workspace-1',
      role: 'editor',
      preauthorizedEmail: null,
      expiresAt,
      command,
    })

    await expect(sqliteAccountAdminPort(input).createInvitation({
      actor,
      workspaceId: 'workspace-1',
      role: 'editor',
      preauthorizedEmail: null,
      expiresAt,
      command,
    })).rejects.toMatchObject({ failure: { code: 'CONFLICT' } })
  })

  it('removes the write-once replay copy before a successful invitation claim releases its lock', async () => {
    db = openDb(':memory:')
    insertRow(db, 'accounts', {
      id: 'workspace-1',
      name: 'Workspace',
      color: '#6366f1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const port = sqliteAccountAdminPort({
      applicationId: 'test-application',
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    })
    const createInput = {
      actor,
      workspaceId: 'workspace-1',
      role: 'editor' as const,
      preauthorizedEmail: null,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      command,
    }
    const created = await port.createInvitation(createInput)
    await port.claimInvitationForPrincipal({
      token: created.token,
      principalId: 'invitee-1',
      principalEmail: 'invitee@example.com',
      emailVerified: false,
      passwordMode: true,
      command: { commandId: 'claim-command', idempotencyKey: 'claim-idempotency' },
    })

    await expect(port.createInvitation(createInput))
      .rejects.toMatchObject({ failure: { code: 'CONFLICT' } })
  })

  it('rechecks current invitation authority before replaying a write-once token', async () => {
    db = openDb(':memory:')
    insertRow(db, 'accounts', {
      id: 'workspace-1',
      name: 'Workspace',
      color: '#6366f1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    upsertMember(db, {
      accountId: 'workspace-1',
      userId: actor.principalId,
      role: 'owner',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const port = sqliteAccountAdminPort({
      applicationId: 'test-application',
      db,
      lock: new KeyedOperationLock(),
    })
    const input = {
      actor,
      workspaceId: 'workspace-1',
      role: 'editor' as const,
      preauthorizedEmail: 'person@example.com',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      command,
    }

    await expect(port.createInvitation(input)).resolves.toMatchObject({ token: expect.any(String) })
    upsertMember(db, {
      accountId: 'workspace-1',
      userId: actor.principalId,
      role: 'viewer',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    })

    await expect(port.createInvitation(input))
      .rejects.toMatchObject({ failure: { code: 'FORBIDDEN' } })
  })

  it('validates invitation email syntax at the transport-independent port boundary', async () => {
    db = openDb(':memory:')
    insertRow(db, 'accounts', {
      id: 'workspace-1',
      name: 'Workspace',
      color: '#6366f1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    const port = sqliteAccountAdminPort({
      applicationId: 'test-application',
      db,
      lock: new KeyedOperationLock(),
      trustedLocal: true,
    })

    await expect(port.createInvitation({
      actor,
      workspaceId: 'workspace-1',
      role: 'editor',
      preauthorizedEmail: 'not-an-email',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      command: { commandId: 'invalid-email-command', idempotencyKey: 'invalid-email-key' },
    })).rejects.toMatchObject({ failure: { code: 'VALIDATION_FAILED' } })
  })

  it('enforces fresh MFA-backed administration and emits normalized success and denial audits', async () => {
    db = openDb(':memory:')
    insertRow(db, 'accounts', {
      id: 'workspace-1',
      name: 'Workspace',
      color: '#6366f1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    upsertMember(db, {
      accountId: 'workspace-1',
      userId: actor.principalId,
      role: 'owner',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
    })
    const events: AccountAuditEvent[] = []
    const audit = { append: vi.fn((event: AccountAuditEvent) => { events.push(event); return true }) }
    const port = sqliteAccountAdminPort({
      applicationId: 'test-application',
      db,
      lock: new KeyedOperationLock(),
      requireMfa: true,
      audit,
    })
    const expiresAt = new Date(Date.now() + 60_000).toISOString()
    const staleActor = { ...actor, fresh: false }
    const passwordActor = { ...actor, assurance: 'password' as const, mfaSatisfied: false }

    await expect(port.createInvitation({
      actor: staleActor,
      workspaceId: 'workspace-1',
      role: 'editor',
      preauthorizedEmail: 'person@example.com',
      expiresAt,
      command: { commandId: 'stale-command', idempotencyKey: 'stale-idempotency' },
    })).rejects.toMatchObject({ failure: { code: 'SESSION_NOT_FRESH' } })
    await expect(port.createInvitation({
      actor: passwordActor,
      workspaceId: 'workspace-1',
      role: 'editor',
      preauthorizedEmail: 'person@example.com',
      expiresAt,
      command: { commandId: 'mfa-command', idempotencyKey: 'mfa-idempotency' },
    })).rejects.toMatchObject({ failure: { code: 'MFA_REQUIRED' } })
    const created = await port.createInvitation({
      actor,
      workspaceId: 'workspace-1',
      role: 'editor',
      preauthorizedEmail: 'person@example.com',
      expiresAt,
      command: { commandId: 'success-command', idempotencyKey: 'success-idempotency' },
    })

    expect(events.map(({ action, outcome, commandId }) => ({ action, outcome, commandId }))).toEqual([
      { action: 'invitation.created', outcome: 'denied', commandId: 'stale-command' },
      { action: 'invitation.created', outcome: 'denied', commandId: 'mfa-command' },
      { action: 'invitation.created', outcome: 'success', commandId: 'success-command' },
    ])
    expect(JSON.stringify(events)).not.toContain(created.token)
    expect(events[2]).toMatchObject({
      applicationId: 'test-application',
      workspaceId: 'workspace-1',
      actorPrincipalId: actor.principalId,
      changedFields: ['role', 'preauthorizedEmail', 'expiresAt'],
    })
  })
})

describe('sqliteAccountAdminPort authority integrity', () => {
  it('does not expose or administer membership rows for an erased workspace', async () => {
    const db = openDb(':memory:')
    try {
      upsertMember(db, {
        accountId: 'erased-workspace',
        userId: actor.principalId,
        role: 'owner',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      const port = sqliteAccountAdminPort({
        applicationId: 'test-application',
        db,
        lock: new KeyedOperationLock(),
      })

      await expect(port.getMembership({
        principalId: actor.principalId,
        workspaceId: 'erased-workspace',
      })).resolves.toBeNull()
      await expect(port.listMemberships({
        actor,
        workspaceId: 'erased-workspace',
      })).rejects.toMatchObject({ failure: { code: 'NOT_FOUND' } })
      await expect(port.changeMemberRole({
        actor,
        workspaceId: 'erased-workspace',
        targetPrincipalId: actor.principalId,
        nextRole: 'admin',
        command: { commandId: 'dangling-role-command', idempotencyKey: 'dangling-role-key' },
      })).rejects.toMatchObject({ failure: { code: 'NOT_FOUND' } })
    } finally {
      db.close()
    }
  })

  it('enforces administrative session assurance at privileged read port boundaries', async () => {
    const db = openDb(':memory:')
    try {
      insertRow(db, 'accounts', {
        id: 'workspace-1',
        name: 'Workspace',
        color: '#6366f1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      upsertMember(db, {
        accountId: 'workspace-1',
        userId: actor.principalId,
        role: 'owner',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      const port = sqliteAccountAdminPort({
        applicationId: 'test-application',
        db,
        lock: new KeyedOperationLock(),
        requireMfa: true,
      })

      await expect(port.listMemberships({
        actor: { ...actor, fresh: false },
        workspaceId: 'workspace-1',
      })).rejects.toMatchObject({ failure: { code: 'SESSION_NOT_FRESH' } })
      await expect(port.listInvitations({
        actor: { ...actor, assurance: 'password', mfaSatisfied: false },
        workspaceId: 'workspace-1',
      })).rejects.toMatchObject({ failure: { code: 'MFA_REQUIRED' } })
    } finally {
      db.close()
    }
  })

  it('does not let an inactive control row confer workspace administration authority', async () => {
    const db = openDb(':memory:')
    try {
      insertRow(db, 'accounts', {
        id: 'workspace-1',
        name: 'Workspace',
        color: '#6366f1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      upsertMember(db, {
        accountId: 'workspace-1',
        userId: actor.principalId,
        role: 'owner',
        status: 'invited' as never,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      const port = sqliteAccountAdminPort({
        applicationId: 'test-application',
        db,
        lock: new KeyedOperationLock(),
      })

      expect(port.roleForPrincipalInWorkspace(actor.principalId, 'workspace-1')).toBeNull()
      await expect(port.createInvitation({
        actor,
        workspaceId: 'workspace-1',
        role: 'editor',
        preauthorizedEmail: 'person@example.com',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        command: { commandId: 'inactive-actor-command', idempotencyKey: 'inactive-actor-key' },
      })).rejects.toMatchObject({ failure: { code: 'NOT_MEMBER' } })
    } finally {
      db.close()
    }
  })

  it('reactivates an inactive invitee with the invitation role rather than its stale role', async () => {
    const db = openDb(':memory:')
    try {
      insertRow(db, 'accounts', {
        id: 'workspace-1',
        name: 'Workspace',
        color: '#6366f1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
      upsertMember(db, {
        accountId: 'workspace-1',
        userId: 'invitee-1',
        role: 'owner',
        status: 'invited' as never,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      const port = sqliteAccountAdminPort({
        applicationId: 'test-application',
        db,
        lock: new KeyedOperationLock(),
        trustedLocal: true,
      })
      const invitation = await port.createInvitation({
        actor,
        workspaceId: 'workspace-1',
        role: 'viewer',
        preauthorizedEmail: null,
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        command: { commandId: 'inactive-create-command', idempotencyKey: 'inactive-create-key' },
      })

      await expect(port.claimInvitationForPrincipal({
        token: invitation.token,
        principalId: 'invitee-1',
        principalEmail: 'invitee@example.com',
        emailVerified: false,
        passwordMode: true,
        command: { commandId: 'inactive-claim-command', idempotencyKey: 'inactive-claim-key' },
      })).resolves.toMatchObject({ role: 'viewer', status: 'active' })
      expect(port.roleForPrincipalInWorkspace('invitee-1', 'workspace-1')).toBe('viewer')
    } finally {
      db.close()
    }
  })

  it('ignores dangling membership rows when evaluating identity-global authority', async () => {
    const db = openDb(':memory:')
    try {
      upsertMember(db, {
        accountId: 'erased-workspace',
        userId: actor.principalId,
        role: 'owner',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      upsertMember(db, {
        accountId: 'erased-workspace',
        userId: 'target-1',
        role: 'viewer',
        status: 'active',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
      const port = sqliteAccountAdminPort({
        applicationId: 'test-application',
        db,
        lock: new KeyedOperationLock(),
      })

      await expect(port.evaluateIdentityAdminAuthority({
        actor,
        targetPrincipalId: 'target-1',
        action: 'issue-password-reset',
      })).resolves.toEqual({ allowed: false, reason: 'target-not-member' })
    } finally {
      db.close()
    }
  })
})
