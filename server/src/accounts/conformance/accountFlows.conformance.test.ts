import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountContractError } from '@capacitylens/shared/account/errors'
import type { AccountAuditPort, IdentityPort } from '@capacitylens/shared/account/ports'
import type { AccountAuditEvent } from '@capacitylens/shared/account/audit'
import type {
  ActorContext,
  ApplicationSession,
  IdentityAdminAuthorityDecision,
  Membership,
  PasswordResetCeremony,
} from '@capacitylens/shared/account/types'
import { openDb, type Db } from '../../db'
import type { LocalIdentityPort } from '../betterAuthIdentityPort'
import { localAccountFlows } from '../localAccountFlows'
import { KeyedOperationLock } from '../operationLock'
import type { LocalAccountAdminPort } from '../sqliteAccountAdminPort'

const command = { commandId: 'command-1', idempotencyKey: 'idempotency-1' }
const actor: ActorContext = {
  principalId: 'actor-1',
  sessionId: 'session-1',
  assurance: 'mfa',
  fresh: true,
  mfaSatisfied: true,
}
const member: Membership = {
  workspaceId: 'workspace-1',
  principalId: 'principal-1',
  role: 'editor',
  status: 'active',
  joinedAt: '2026-01-01T00:00:00.000Z',
  membershipRevision: '1',
  policyVersion: 'account-policy-v1',
}
const session: ApplicationSession = {
  id: 'session-1',
  principal: {
    id: 'actor-1',
    displayName: 'Actor',
    email: 'actor@example.com',
    emailVerified: true,
    linkedSubject: null,
  },
  createdAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2026-01-01T12:00:00.000Z',
  freshUntil: '2026-01-01T00:15:00.000Z',
  assurance: 'mfa',
}

function contractError(code: ConstructorParameters<typeof AccountContractError>[0]['code']) {
  return new AccountContractError({ code, message: code, retryable: false })
}

function identityPort(overrides: Partial<LocalIdentityPort> = {}): LocalIdentityPort {
  const base: LocalIdentityPort = {
    deprovisionLocalPrincipalInTx: vi.fn(),
    verifyApplicationSession: vi.fn(async () => session),
    getPrincipalSummaries: vi.fn(async () => []),
    findPrincipalByFederatedSubject: vi.fn(async () => null),
    signOut: vi.fn(async () => ({ setCookies: [] })),
    listSessions: vi.fn(async () => []),
    revokeOwnSession: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: '2026-01-01T00:00:00.000Z',
    })),
    createProvisionalCredentialPrincipal: vi.fn(async ({ command: value }) => ({
      principalId: 'principal-1',
      compensationHandle: `opaque-${value.commandId}`,
    })),
    compensateProvisionalPrincipal: vi.fn(async () => {}),
    deprovisionLocalPrincipal: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: '2026-01-01T00:00:00.000Z',
    })),
    issuePasswordReset: vi.fn(async () => ({
      ceremonyId: 'ceremony-1',
      token: 'write-once-reset-token',
      expiresAt: '2026-01-02T00:00:00.000Z',
    })),
    revokePasswordResetCeremony: vi.fn(async () => {}),
    revokePrincipalSessions: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: '2026-01-01T00:00:00.000Z',
    })),
  }
  return { ...base, ...overrides }
}

function administrationPort(overrides: Partial<LocalAccountAdminPort> = {}): LocalAccountAdminPort {
  const base: LocalAccountAdminPort = {
    roleForPrincipalInWorkspace: vi.fn(() => null),
    workspacePrincipalIds: vi.fn(() => []),
    evaluateWorkspaceProvisioningAuthorityInTx: vi.fn(() => ({ allowed: true as const })),
    provisionOwnerMembershipInTx: vi.fn(({ workspaceId, principalId, joinedAt }) => ({
      ...member,
      workspaceId,
      principalId,
      role: 'owner' as const,
      joinedAt,
    })),
    assertWorkspaceErasureAuthorityInTx: vi.fn(),
    listWorkspacesForPrincipal: vi.fn(async () => []),
    getMembership: vi.fn(async () => member),
    listMemberships: vi.fn(async () => [member]),
    listInvitations: vi.fn(async () => []),
    previewInvitation: vi.fn(async () => ({
      workspaceName: 'Workspace',
      role: 'editor' as const,
      expiresAt: '2099-01-01T00:00:00.000Z',
    })),
    preparePasswordInvitationClaim: vi.fn(async () => ({
      emailVerifiedByInvitation: true,
      workspaceId: 'workspace-1',
    })),
    createInvitation: vi.fn(async () => ({
      token: 'write-once-invite-token',
      id: 'invite-1',
      workspaceId: 'workspace-1',
      role: 'editor' as const,
      preauthorizedEmail: null,
      expiresAt: '2099-01-01T00:00:00.000Z',
      usedAt: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
    acceptInvitation: vi.fn(async () => member),
    claimInvitationForPrincipal: vi.fn(async () => member),
    revokeInvitation: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: '2026-01-01T00:00:00.000Z',
    })),
    changeMemberRole: vi.fn(async () => member),
    removeMember: vi.fn(async ({ command: value }) => ({
      commandId: value.commandId,
      completedAt: '2026-01-01T00:00:00.000Z',
    })),
    transferOwnership: vi.fn(async () => ({ previousOwner: member, nextOwner: member })),
    evaluateIdentityAdminAuthority: vi.fn(async () => ({
      allowed: true as const,
      revision: 'revision-1',
      policyVersion: 'account-policy-v1',
    })),
    evaluateIdentityAdminAuthorities: vi.fn<LocalAccountAdminPort['evaluateIdentityAdminAuthorities']>(
      async ({ actions }) => new Map(actions.map((action) => [action, {
        allowed: true as const,
        revision: 'revision-1',
        policyVersion: 'account-policy-v1',
      }])),
    ),
    confirmIdentityAdminAuthority: vi.fn(async () => true),
  }
  return { ...base, ...overrides }
}

describe('AccountFlows conformance', () => {
  let db: Db | null = null

  afterEach(() => {
    db?.close()
    db = null
  })

  function harness(options: {
    identity?: LocalIdentityPort
    administration?: LocalAccountAdminPort
    lock?: KeyedOperationLock
    audit?: AccountAuditPort
  } = {}) {
    db = openDb(':memory:')
    const identity = options.identity ?? identityPort()
    const administration = options.administration ?? administrationPort()
    const lock = options.lock ?? new KeyedOperationLock()
    const events: AccountAuditEvent[] = []
    const audit = options.audit ?? {
      append: vi.fn((event: AccountAuditEvent) => {
        events.push(event)
        return true
      }),
    }
    return {
      identity,
      administration,
      lock,
      audit,
      events,
      flows: localAccountFlows({
        applicationId: 'conformance-application',
        db,
        identity,
        administration,
        lock,
        audit,
      }),
    }
  }

  it('validates admission before identity creation and keeps absence distinct from dependency failure', async () => {
    const create = vi.fn<IdentityPort['createProvisionalCredentialPrincipal']>()
    const identity = identityPort({ createProvisionalCredentialPrincipal: create })
    const administration = administrationPort({
      preparePasswordInvitationClaim: vi.fn(async () => {
        throw contractError('INVITATION_EXPIRED')
      }),
    })
    const { flows } = harness({ identity, administration })

    await expect(flows.acceptInviteWithPasswordSignup({
      token: 'expired-token',
      email: 'person@example.com',
      displayName: 'Person',
      password: 'not-stored-password',
      command,
    })).rejects.toMatchObject({ failure: { code: 'INVITATION_EXPIRED' } })
    expect(create).not.toHaveBeenCalled()
    await expect(flows.reconcileCommand({ command, operation: 'invite-password-signup' }))
      .resolves.toMatchObject({ status: 'compensated' })
  })

  it('binds workspace-provisioning idempotency to the complete canonical product payload', async () => {
    const { flows } = harness()
    const base = {
      actor,
      workspaceId: 'workspace-1',
      joinedAt: '2026-01-01T00:00:00.000Z',
      command,
      multiWorkspace: false,
      bootstrapAuthorized: false,
      provisionProductData: () => ({ id: 'workspace-1', name: 'First name' }),
    }

    await expect(flows.provisionWorkspace({
      ...base,
      canonicalProductPayload: { id: 'workspace-1', name: 'First name' },
    })).resolves.toMatchObject({ product: { name: 'First name' } })
    await expect(flows.provisionWorkspace({
      ...base,
      canonicalProductPayload: { id: 'workspace-1', name: 'Changed name' },
    })).rejects.toMatchObject({ failure: { code: 'IDEMPOTENCY_CONFLICT' } })
  })

  it('compensates a provisional identity, and makes a double failure reconcilable', async () => {
    const claimFailure = contractError('INVITATION_USED')
    const compensationFailure = contractError('DEPENDENCY_UNAVAILABLE')
    const compensate = vi.fn(async () => {
      throw compensationFailure
    })
    const { flows } = harness({
      identity: identityPort({ compensateProvisionalPrincipal: compensate }),
      administration: administrationPort({
        claimInvitationForPrincipal: vi.fn(async () => {
          throw claimFailure
        }),
      }),
    })

    await expect(flows.acceptInviteWithPasswordSignup({
      token: 'concurrently-consumed-token',
      email: 'person@example.com',
      displayName: 'Person',
      password: 'not-stored-password',
      command,
    })).rejects.toMatchObject({
      failure: { code: 'COMPENSATION_FAILED', commandId: command.commandId },
      cause: expect.any(AggregateError),
    })
    expect(compensate).toHaveBeenCalledOnce()
    await expect(flows.reconcileCommand({ command, operation: 'invite-password-signup' }))
      .resolves.toMatchObject({ status: 'reconciliation-required' })
  })

  it('does not compensate an identity after the invitation claim committed but parent completion failed', async () => {
    const compensate = vi.fn(async () => {})
    const { flows } = harness({ identity: identityPort({ compensateProvisionalPrincipal: compensate }) })
    db!.exec(`
      CREATE TRIGGER fail_parent_invite_completion
      BEFORE UPDATE OF status ON account_commands
      WHEN OLD.operation = 'invite-password-signup' AND NEW.status = 'completed'
      BEGIN
        SELECT RAISE(ABORT, 'simulated parent completion failure');
      END;
    `)

    await expect(flows.acceptInviteWithPasswordSignup({
      token: 'committed-token',
      email: 'person@example.com',
      displayName: 'Person',
      password: 'a-valid-length-password',
      command,
    })).rejects.toMatchObject({ failure: { code: 'DEPENDENCY_UNAVAILABLE' } })
    expect(compensate).not.toHaveBeenCalled()
    await expect(flows.reconcileCommand({ command, operation: 'invite-password-signup' }))
      .resolves.toMatchObject({
        status: 'reconciliation-required',
        repair: { kind: 'invitation-claim-committed', targetPrincipalId: 'principal-1' },
      })
  })

  it('replays a completed semantic result, rejects mismatched payloads, and stores no bearer input', async () => {
    const claim = vi.fn(async () => member)
    const create = vi.fn(async () => ({
      principalId: 'principal-1',
      compensationHandle: 'opaque-handle',
    }))
    const { flows } = harness({
      identity: identityPort({ createProvisionalCredentialPrincipal: create }),
      administration: administrationPort({ claimInvitationForPrincipal: claim }),
    })
    const input = {
      token: 'write-once-invitation-secret',
      email: 'person@example.com',
      displayName: 'Person',
      password: 'write-once-password-secret',
      command,
    }

    const first = await flows.acceptInviteWithPasswordSignup(input)
    await expect(flows.acceptInviteWithPasswordSignup(input)).resolves.toEqual(first)
    expect(create).toHaveBeenCalledOnce()
    expect(claim).toHaveBeenCalledOnce()
    await expect(flows.acceptInviteWithPasswordSignup({
      ...input,
      email: 'different@example.com',
    })).rejects.toMatchObject({ failure: { code: 'IDEMPOTENCY_CONFLICT' } })
    await expect(flows.acceptInviteWithPasswordSignup({
      ...input,
      password: 'a-different-write-once-password',
    })).rejects.toMatchObject({ failure: { code: 'IDEMPOTENCY_CONFLICT' } })

    const stored = db!.prepare(`
      SELECT payloadHash, resultJson, workspaceId, targetPrincipalId
        FROM account_commands
       WHERE operation = 'invite-password-signup'
    `).get() as {
      payloadHash: string
      resultJson: string
      workspaceId: string
      targetPrincipalId: string
    }
    expect(stored.payloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(stored.resultJson).not.toContain(input.token)
    expect(stored.resultJson).not.toContain(input.password)
    expect(stored.workspaceId).toBe('workspace-1')
    expect(stored.targetPrincipalId).toBe('principal-1')
  })

  it('leaves invitation audit ownership with AccountAdminPort rather than duplicating it', async () => {
    const { flows, events } = harness()
    const input = {
      token: 'audit-must-not-contain-this-invite-token',
      email: 'person@example.com',
      displayName: 'Person',
      password: 'audit-must-not-contain-this-password',
      command,
    }

    await flows.acceptInviteWithPasswordSignup(input)
    await flows.acceptInviteWithPasswordSignup(input)

    expect(events).toHaveLength(0)
    expect(JSON.stringify(events)).not.toContain(input.token)
    expect(JSON.stringify(events)).not.toContain(input.password)
  })

  it('burns a reset ceremony when authority changes after minting', async () => {
    const ceremony: PasswordResetCeremony = {
      ceremonyId: 'ceremony-1',
      token: 'write-once-reset-token',
      expiresAt: '2026-01-02T00:00:00.000Z',
    }
    const revoke = vi.fn(async () => {})
    const { flows } = harness({
      identity: identityPort({
        issuePasswordReset: vi.fn(async () => ceremony),
        revokePasswordResetCeremony: revoke,
      }),
      administration: administrationPort({
        confirmIdentityAdminAuthority: vi.fn(async () => false),
      }),
    })

    await expect(flows.issuePasswordReset({ actor, targetPrincipalId: 'principal-1', command }))
      .rejects.toMatchObject({ failure: { code: 'AUTHORITY_CHANGED' } })
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({
      targetPrincipalId: 'principal-1',
      ceremonyId: ceremony.ceremonyId,
    }))
    await expect(flows.reconcileCommand({ command, operation: 'password-reset' }))
      .resolves.toMatchObject({ status: 'compensated' })
  })

  it('rechecks current authority before replaying a write-once password-reset token', async () => {
    const evaluate = vi.fn<LocalAccountAdminPort['evaluateIdentityAdminAuthority']>()
      .mockResolvedValueOnce({
        allowed: true,
        revision: 'revision-1',
        policyVersion: 'account-policy-v1',
      })
      .mockResolvedValueOnce({ allowed: false, reason: 'insufficient-authority' })
    const { flows } = harness({
      administration: administrationPort({ evaluateIdentityAdminAuthority: evaluate }),
    })

    await expect(flows.issuePasswordReset({ actor, targetPrincipalId: 'principal-1', command }))
      .resolves.toMatchObject({ token: 'write-once-reset-token' })
    await expect(flows.issuePasswordReset({ actor, targetPrincipalId: 'principal-1', command }))
      .rejects.toMatchObject({ failure: { code: 'FORBIDDEN' } })
    expect(evaluate).toHaveBeenCalledTimes(2)
  })

  it('marks reset revocation failure as reconciliation-required', async () => {
    const { flows, events } = harness({
      identity: identityPort({
        revokePasswordResetCeremony: vi.fn(async () => {
          throw contractError('DEPENDENCY_UNAVAILABLE')
        }),
      }),
      administration: administrationPort({
        confirmIdentityAdminAuthority: vi.fn(async () => false),
      }),
    })

    await expect(flows.issuePasswordReset({ actor, targetPrincipalId: 'principal-1', command }))
      .rejects.toMatchObject({ failure: { code: 'COMPENSATION_FAILED' } })
    await expect(flows.reconcileCommand({ command, operation: 'password-reset' }))
      .resolves.toMatchObject({ status: 'reconciliation-required' })
    expect(events.filter((event) => event.action === 'flow.reconciliation_required')).toHaveLength(1)
  })

  it('records a known no-identity reset refusal as compensated rather than outcome-unknown', async () => {
    const missing = contractError('NOT_FOUND')
    const { flows } = harness({
      identity: identityPort({
        issuePasswordReset: vi.fn(async () => { throw missing }),
      }),
    })

    await expect(flows.issuePasswordReset({ actor, targetPrincipalId: 'principal-1', command }))
      .rejects.toBe(missing)
    await expect(flows.reconcileCommand({ command, operation: 'password-reset' }))
      .resolves.toMatchObject({ status: 'compensated' })
  })

  it('records unknown reset and session-revocation outcomes for operator reconciliation', async () => {
    const resetCommand = { commandId: 'reset-command', idempotencyKey: 'reset-idempotency' }
    const revokeCommand = { commandId: 'revoke-command', idempotencyKey: 'revoke-idempotency' }
    const dependency = contractError('DEPENDENCY_UNAVAILABLE')
    const { flows } = harness({
      identity: identityPort({
        issuePasswordReset: vi.fn(async () => { throw dependency }),
        revokePrincipalSessions: vi.fn(async () => { throw dependency }),
      }),
    })

    await expect(flows.issuePasswordReset({ actor, targetPrincipalId: 'principal-1', command: resetCommand }))
      .rejects.toBe(dependency)
    await expect(flows.revokeMemberSessions({ actor, targetPrincipalId: 'principal-1', command: revokeCommand }))
      .rejects.toBe(dependency)
    await expect(flows.reconcileCommand({ command: resetCommand, operation: 'password-reset' }))
      .resolves.toMatchObject({
        status: 'reconciliation-required',
        repair: { kind: 'password-reset-outcome-unknown' },
      })
    await expect(flows.reconcileCommand({ command: revokeCommand, operation: 'session-revocation' }))
      .resolves.toMatchObject({
        status: 'reconciliation-required',
        repair: { kind: 'session-revocation-outcome-unknown' },
      })
  })

  it('serializes membership mutation ahead of irreversible session revocation', async () => {
    const lock = new KeyedOperationLock()
    let allowed = true
    let releaseMutation!: () => void
    let mutationEntered!: () => void
    const entered = new Promise<void>((resolve) => { mutationEntered = resolve })
    const release = new Promise<void>((resolve) => { releaseMutation = resolve })
    const mutation = lock.withKeys(['principal-1'], async () => {
      mutationEntered()
      await release
      allowed = false
    })
    await entered
    const revoke = vi.fn(async () => ({
      commandId: command.commandId,
      completedAt: '2026-01-01T00:00:00.000Z',
    }))
    const { flows } = harness({
      lock,
      identity: identityPort({ revokePrincipalSessions: revoke }),
      administration: administrationPort({
        evaluateIdentityAdminAuthority: vi.fn(async (): Promise<IdentityAdminAuthorityDecision> => allowed
          ? { allowed: true, revision: 'revision-1', policyVersion: 'account-policy-v1' }
          : { allowed: false, reason: 'insufficient-authority' }),
      }),
    })
    const revocation = flows.revokeMemberSessions({
      actor,
      targetPrincipalId: 'principal-1',
      command,
    })
    releaseMutation()
    await mutation

    await expect(revocation).rejects.toMatchObject({ failure: { code: 'FORBIDDEN' } })
    expect(revoke).not.toHaveBeenCalled()
  })

  it('rejects a nested lock-set expansion that violates global acquisition order', async () => {
    const lock = new KeyedOperationLock()

    await expect(lock.withKeys(['principal-b'], () =>
      lock.withKeys(['principal-a', 'principal-b'], () => undefined)))
      .rejects.toThrow(/lock order violation/i)
    expect(lock.pendingKeyCount()).toBe(0)
  })

  it('locks every workspace principal before erasure can race identity administration', async () => {
    const lock = new KeyedOperationLock()
    let releasePrincipal!: () => void
    let principalLocked!: () => void
    const entered = new Promise<void>((resolve) => { principalLocked = resolve })
    const release = new Promise<void>((resolve) => { releasePrincipal = resolve })
    const mutation = lock.withKeys(['principal-1'], async () => {
      principalLocked()
      await release
    })
    await entered
    const assertAuthority = vi.fn()
    const { flows } = harness({
      lock,
      administration: administrationPort({
        workspacePrincipalIds: vi.fn(() => ['principal-1']),
        assertWorkspaceErasureAuthorityInTx: assertAuthority,
      }),
    })

    const erasure = flows.eraseWorkspace({
      actor,
      workspaceId: 'workspace-1',
      command: { commandId: 'erasure-command', idempotencyKey: 'erasure-idempotency' },
    })
    await Promise.resolve()
    expect(assertAuthority).not.toHaveBeenCalled()

    releasePrincipal()
    await mutation
    await expect(erasure).resolves.toMatchObject({ commandId: 'erasure-command' })
    expect(assertAuthority).toHaveBeenCalledOnce()
  })

  it('locks every workspace principal around legacy transactional batch erasure', async () => {
    const lock = new KeyedOperationLock()
    let releasePrincipal!: () => void
    let principalLocked!: () => void
    const entered = new Promise<void>((resolve) => { principalLocked = resolve })
    const release = new Promise<void>((resolve) => { releasePrincipal = resolve })
    const mutation = lock.withKeys(['principal-1'], async () => {
      principalLocked()
      await release
    })
    await entered
    const erase = vi.fn()
    const { flows } = harness({
      lock,
      administration: administrationPort({
        workspacePrincipalIds: vi.fn(() => ['principal-1']),
      }),
    })

    const erasure = flows.withWorkspaceErasureLocks(['workspace-1'], erase)
    await Promise.resolve()
    expect(erase).not.toHaveBeenCalled()
    releasePrincipal()
    await mutation
    await erasure
    expect(erase).toHaveBeenCalledOnce()
  })

  it('keeps a missing principal summary explicit and propagates identity dependency failure', async () => {
    const dependency = contractError('DEPENDENCY_UNAVAILABLE')
    const { flows } = harness({
      identity: identityPort({
        getPrincipalSummaries: vi.fn(async () => []),
        verifyApplicationSession: vi.fn(async () => {
          throw dependency
        }),
      }),
    })

    await expect(flows.listMemberDirectory({ actor, workspaceId: 'workspace-1' }))
      .resolves.toEqual([{ membership: member, principal: null }])
    await expect(flows.resolveRequestAccess({ headers: new Headers(), workspaceId: 'workspace-1' }))
      .rejects.toBe(dependency)
  })
})
