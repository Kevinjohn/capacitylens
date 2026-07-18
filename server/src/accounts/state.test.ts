import { afterEach, describe, expect, it } from 'vitest'
import { openDb, type Db } from '../db'
import { accountPayloadHash, beginCommand } from './commands'
import {
  assertAccountBoundaryStateCurrent,
  bindFederatedProvider,
  closeAccountCommandReconciliation,
  correlatePendingAccountCommand,
  erasePrincipalCommandHistoryInTx,
  eraseWorkspaceCommandHistoryInTx,
  finishAccountCommand,
  getAccountCommand,
  getAccountCommandByIdForReconciliation,
  getSessionAuthentication,
  recordSessionAssurance,
  reserveAccountCommand,
} from './state'

const hash = 'a'.repeat(64)

describe('account boundary durable state', () => {
  let db: Db | null = null

  afterEach(() => {
    db?.close()
    db = null
  })

  it('canonicalizes object order while retaining array positions in payload hashes', () => {
    expect(accountPayloadHash({ b: 2, a: 1 })).toBe(accountPayloadHash({ a: 1, b: 2 }))
    expect(accountPayloadHash([undefined])).toBe(accountPayloadHash([null]))
    expect(accountPayloadHash([undefined])).not.toBe(accountPayloadHash([]))
  })

  it('turns stale pending commands into explicit reconciliation work', () => {
    db = openDb(':memory:')
    reserveAccountCommand(db, {
      applicationId: 'app', operation: 'operation', idempotencyKey: 'key', commandId: 'command',
      actorPrincipalId: 'actor', payloadHash: hash, now: '2026-01-01T00:00:00.000Z',
    })

    const repeated = reserveAccountCommand(db, {
      applicationId: 'app', operation: 'operation', idempotencyKey: 'key', commandId: 'command',
      actorPrincipalId: 'actor', payloadHash: hash, now: '2026-01-01T00:16:00.000Z',
    })

    expect(repeated).toMatchObject({
      kind: 'existing',
      record: { status: 'reconciliation_required', failureCode: 'DEPENDENCY_UNAVAILABLE' },
    })
  })

  it('ages an abandoned pending command during a reconciliation read without a mutation retry', () => {
    db = openDb(':memory:')
    reserveAccountCommand(db, {
      applicationId: 'app', operation: 'operation', idempotencyKey: 'key', commandId: 'command',
      actorPrincipalId: 'actor', payloadHash: hash, now: '2026-01-01T00:00:00.000Z',
    })

    expect(getAccountCommandByIdForReconciliation(
      db,
      'app',
      'command',
      Date.parse('2026-01-01T00:16:00.000Z'),
    )).toMatchObject({
      status: 'reconciliation_required',
      failureCode: 'DEPENDENCY_UNAVAILABLE',
      resultJson: JSON.stringify({ kind: 'stale-pending' }),
    })
  })

  it('distinguishes an in-flight command from a terminal conflict', () => {
    db = openDb(':memory:')
    const scope = { applicationId: 'app', operation: 'operation', actorPrincipalId: 'actor' }
    const command = { commandId: 'command', idempotencyKey: 'key' }
    expect(beginCommand(db, scope, command, { value: 1 })).toMatchObject({ kind: 'execute' })
    expect(() => beginCommand(db!, scope, command, { value: 1 })).toThrow(expect.objectContaining({
      failure: expect.objectContaining({ code: 'COMMAND_IN_PROGRESS', retryable: true }),
    }))
  })

  it('still reports an idempotency conflict when a stale pending retry changes payload', () => {
    db = openDb(':memory:')
    reserveAccountCommand(db, {
      applicationId: 'app', operation: 'operation', idempotencyKey: 'key', commandId: 'command',
      actorPrincipalId: 'actor', payloadHash: hash, now: '2026-01-01T00:00:00.000Z',
    })

    expect(reserveAccountCommand(db, {
      applicationId: 'app', operation: 'operation', idempotencyKey: 'key', commandId: 'command',
      actorPrincipalId: 'actor', payloadHash: 'b'.repeat(64), now: '2026-01-01T00:16:00.000Z',
    })).toMatchObject({ kind: 'conflict', record: { status: 'reconciliation_required' } })
  })

  it('prunes closed terminal commands but retains pending and reconciliation work', () => {
    db = openDb(':memory:')
    for (const commandId of ['old-terminal', 'old-pending', 'old-reconciliation']) {
      reserveAccountCommand(db, {
        applicationId: 'app', operation: commandId, idempotencyKey: commandId, commandId,
        actorPrincipalId: 'actor', payloadHash: hash, now: '2026-01-01T00:00:00.000Z',
      })
    }
    finishAccountCommand(db, {
      applicationId: 'app', operation: 'old-terminal', idempotencyKey: 'old-terminal',
      status: 'completed', resultJson: '{}', now: '2026-01-01T00:01:00.000Z',
    })
    finishAccountCommand(db, {
      applicationId: 'app', operation: 'old-reconciliation', idempotencyKey: 'old-reconciliation',
      status: 'reconciliation_required', failureCode: 'DEPENDENCY_UNAVAILABLE',
      now: '2026-01-01T00:01:00.000Z',
    })

    reserveAccountCommand(db, {
      applicationId: 'app', operation: 'new', idempotencyKey: 'new', commandId: 'new',
      actorPrincipalId: 'actor', payloadHash: hash, now: '2026-02-02T00:00:00.000Z',
    })

    expect(getAccountCommand(db, 'app', 'old-terminal', 'old-terminal')).toBeNull()
    expect(getAccountCommand(db, 'app', 'old-pending', 'old-pending')).not.toBeNull()
    expect(getAccountCommand(db, 'app', 'old-reconciliation', 'old-reconciliation'))
      .toMatchObject({ status: 'reconciliation_required' })
  })

  it('normalizes command-id reuse across another operation instead of leaking a database error', () => {
    db = openDb(':memory:')
    reserveAccountCommand(db, {
      applicationId: 'app', operation: 'first', idempotencyKey: 'first-key', commandId: 'same-command',
      actorPrincipalId: 'actor', payloadHash: hash,
    })

    expect(reserveAccountCommand(db, {
      applicationId: 'app', operation: 'second', idempotencyKey: 'second-key', commandId: 'same-command',
      actorPrincipalId: 'actor', payloadHash: hash,
    })).toMatchObject({ kind: 'conflict', record: { operation: 'first' } })
    expect(() => beginCommand(
      db!,
      { applicationId: 'app', operation: 'second', actorPrincipalId: 'actor' },
      { commandId: 'same-command', idempotencyKey: 'second-key' },
      {},
    )).toThrow(expect.objectContaining({
      failure: expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }),
    }))
  })

  it('does not let an idempotency key bind to a second command id', () => {
    db = openDb(':memory:')
    reserveAccountCommand(db, {
      applicationId: 'app', operation: 'operation', idempotencyKey: 'same-key', commandId: 'first-command',
      actorPrincipalId: 'actor', payloadHash: hash,
    })

    expect(reserveAccountCommand(db, {
      applicationId: 'app', operation: 'operation', idempotencyKey: 'same-key', commandId: 'second-command',
      actorPrincipalId: 'actor', payloadHash: hash,
    })).toMatchObject({ kind: 'conflict', record: { commandId: 'first-command' } })
  })

  it('adds immutable privacy coordinates only while a command is pending', () => {
    db = openDb(':memory:')
    reserveAccountCommand(db, {
      applicationId: 'app', operation: 'signup', idempotencyKey: 'key', commandId: 'command',
      actorPrincipalId: null, payloadHash: hash,
    })
    correlatePendingAccountCommand(db, {
      applicationId: 'app', operation: 'signup', idempotencyKey: 'key', workspaceId: 'workspace-1',
    })
    correlatePendingAccountCommand(db, {
      applicationId: 'app', operation: 'signup', idempotencyKey: 'key',
      workspaceId: 'workspace-1', targetPrincipalId: 'principal-1',
    })
    expect(getAccountCommand(db, 'app', 'signup', 'key')).toMatchObject({
      workspaceId: 'workspace-1',
      targetPrincipalId: 'principal-1',
    })
    expect(() => correlatePendingAccountCommand(db!, {
      applicationId: 'app', operation: 'signup', idempotencyKey: 'key', workspaceId: 'workspace-2',
    })).toThrow(/rebound/)
    finishAccountCommand(db, {
      applicationId: 'app', operation: 'signup', idempotencyKey: 'key', status: 'completed', resultJson: '{}',
    })
    expect(() => correlatePendingAccountCommand(db!, {
      applicationId: 'app', operation: 'signup', idempotencyKey: 'key', targetPrincipalId: 'principal-1',
    })).toThrow(/pending/)
  })

  it('supports operator closure only for reconciliation-required commands with a hashed reference', () => {
    db = openDb(':memory:')
    reserveAccountCommand(db, {
      applicationId: 'app', operation: 'operation', idempotencyKey: 'key', commandId: 'command',
      actorPrincipalId: 'actor', payloadHash: hash,
    })
    finishAccountCommand(db, {
      applicationId: 'app', operation: 'operation', idempotencyKey: 'key',
      status: 'reconciliation_required', failureCode: 'DEPENDENCY_UNAVAILABLE',
    })

    expect(() => closeAccountCommandReconciliation(db!, 'app', 'command', 'operator-note'))
      .toThrow(/sha-256/i)
    expect(closeAccountCommandReconciliation(db, 'app', 'command', 'b'.repeat(64))).toBe(true)
    expect(closeAccountCommandReconciliation(db, 'app', 'command', 'b'.repeat(64))).toBe(false)
    expect(getAccountCommand(db, 'app', 'operation', 'key')).toMatchObject({
      status: 'compensated',
      resultJson: expect.stringContaining('referenceHash'),
    })
  })

  it('erases workspace-scoped command history while retaining the erasure command', () => {
    db = openDb(':memory:')
    for (const [operation, commandId, workspaceId] of [
      ['invite', 'invite-command', 'workspace-1'],
      ['erase', 'erase-command', 'workspace-1'],
      ['other', 'other-command', 'workspace-2'],
    ] as const) {
      reserveAccountCommand(db, {
        applicationId: 'app', operation, idempotencyKey: commandId, commandId,
        actorPrincipalId: 'actor', workspaceId, payloadHash: hash,
      })
    }

    eraseWorkspaceCommandHistoryInTx(db, 'workspace-1', 'erase-command')
    expect(getAccountCommand(db, 'app', 'invite', 'invite-command')).toBeNull()
    expect(getAccountCommand(db, 'app', 'erase', 'erase-command')).toMatchObject({ workspaceId: null })
    expect(getAccountCommand(db, 'app', 'other', 'other-command')).not.toBeNull()
  })

  it('erases all workspace-scoped command history for an enclosing legacy transaction', () => {
    db = openDb(':memory:')
    for (const [operation, workspaceId] of [
      ['workspace-command', 'workspace-1'],
      ['other-command', 'workspace-2'],
    ] as const) {
      reserveAccountCommand(db, {
        applicationId: 'app', operation, idempotencyKey: operation, commandId: operation,
        actorPrincipalId: 'actor', workspaceId, payloadHash: hash,
      })
    }

    eraseWorkspaceCommandHistoryInTx(db, 'workspace-1')
    expect(getAccountCommand(db, 'app', 'workspace-command', 'workspace-command')).toBeNull()
    expect(getAccountCommand(db, 'app', 'other-command', 'other-command')).not.toBeNull()
  })

  it('erases principal correlation while retaining an anonymized erasure command for replay', () => {
    db = openDb(':memory:')
    for (const [operation, commandId, actorPrincipalId, targetPrincipalId] of [
      ['reset', 'reset-command', 'other-actor', 'principal-1'],
      ['erase', 'erase-command', 'principal-1', null],
      ['unrelated', 'unrelated-command', 'other-actor', 'principal-2'],
    ] as const) {
      reserveAccountCommand(db, {
        applicationId: 'app', operation, idempotencyKey: commandId, commandId,
        actorPrincipalId, targetPrincipalId, payloadHash: hash,
      })
    }

    erasePrincipalCommandHistoryInTx(db, 'principal-1', 'erase-command')
    expect(getAccountCommand(db, 'app', 'reset', 'reset-command')).toBeNull()
    expect(getAccountCommand(db, 'app', 'erase', 'erase-command')).toMatchObject({
      actorPrincipalId: null,
      targetPrincipalId: null,
    })
    expect(getAccountCommand(db, 'app', 'unrelated', 'unrelated-command')).not.toBeNull()
  })

  it('bounds assurance metadata to the absolute session lifetime', () => {
    db = openDb(':memory:')
    recordSessionAssurance(db, 'expired', 'principal-1', 'password', null, '2026-01-01T00:00:00.000Z')
    recordSessionAssurance(db, 'current', 'principal-1', 'federated', 'sso', '2026-01-01T13:00:00.000Z')

    expect(getSessionAuthentication(db, 'expired')).toBeNull()
    expect(getSessionAuthentication(db, 'current')).toEqual({ assurance: 'federated', providerId: 'sso' })
  })

  it('rejects impossible assurance/provider combinations', () => {
    db = openDb(':memory:')
    expect(() => recordSessionAssurance(db!, 'federated-without-provider', 'principal-1', 'federated'))
      .toThrow(/provider id/i)
    expect(() => recordSessionAssurance(db!, 'password-with-provider', 'principal-1', 'password', 'sso'))
      .toThrow(/provider id/i)
  })

  it('makes issuer/provider bindings immutable in both directions', () => {
    db = openDb(':memory:')
    bindFederatedProvider(db, 'app', 'https://issuer.example', 'sso')
    expect(() => bindFederatedProvider(db!, 'app', 'https://issuer.example', 'renamed'))
      .toThrow(/immutable/i)
    expect(() => bindFederatedProvider(db!, 'app', 'https://different.example', 'sso'))
      .toThrow(/already bound/i)
  })

  it('refuses extra columns and misleadingly named indexes in boundary schema', () => {
    db = openDb(':memory:')
    db.exec(`ALTER TABLE account_commands ADD COLUMN unexpected TEXT`)
    expect(() => assertAccountBoundaryStateCurrent(db!)).toThrow(/unexpected account_commands\.unexpected/)
    db.close()

    db = openDb(':memory:')
    db.exec(`DROP INDEX idx_account_commands_status; CREATE INDEX idx_account_commands_status ON account_commands(operation)`)
    expect(() => assertAccountBoundaryStateCurrent(db!)).toThrow(/does not cover exactly account_commands\.status/)
    db.close()

    db = openDb(':memory:')
    db.exec(`
      DROP INDEX idx_account_session_assurance_principalId;
      CREATE INDEX idx_account_session_assurance_principalId ON account_security_revisions(principalId)
    `)
    expect(() => assertAccountBoundaryStateCurrent(db!))
      .toThrow(/does not cover exactly account_session_assurance\.principalId/)
  })
})
