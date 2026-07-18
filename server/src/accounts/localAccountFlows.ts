import { AccountContractError } from '@capacitylens/shared/account/errors'
import type {
  AccountAuditPort,
  AccountFlows,
  CommandOutcome,
  InviteSignupResult,
  MemberDirectoryEntry,
} from '@capacitylens/shared/account/ports'
import type { AccountAuditAction, AccountAuditEvent } from '@capacitylens/shared/account/audit'
import type {
  ActorContext,
  CommandIdentity,
  PasswordResetCeremony,
} from '@capacitylens/shared/account/types'
import type { Db } from '../db'
import { eraseWorkspaceDataAndMembershipsInTx } from '../erasure'
import { tx } from '../txn'
import {
  beginCommand,
  completeCommand,
  markAccountCommandReplay,
  readCommand,
  secretDigest,
  terminateCommand,
} from './commands'
import { KeyedOperationLock } from './operationLock'
import {
  correlatePendingAccountCommand,
  eraseWorkspaceCommandHistoryInTx,
  finishAccountCommandIfPending,
  getAccountCommandByIdForReconciliation,
} from './state'
import type { AccountAdminPort, IdentityPort } from '@capacitylens/shared/account/ports'
import type { LocalIdentityPort } from './betterAuthIdentityPort'
import type { LocalAccountAdminPort } from './sqliteAccountAdminPort'

export interface LocalAccountFlows extends AccountFlows {
  provisionWorkspace<T>(input: {
    actor: ActorContext
    workspaceId: string
    joinedAt: string
    command: CommandIdentity
    multiWorkspace: boolean
    bootstrapAuthorized: boolean
    canonicalProductPayload: unknown
    provisionProductData: () => T
  }): Promise<{
    product: T
    membership: Awaited<ReturnType<AccountAdminPort['getMembership']>>
    replayed: boolean
  }>
  replayWorkspaceProvisioning<T>(input: {
    actor: ActorContext
    workspaceId: string
    command: CommandIdentity
    canonicalProductPayload: unknown
  }): Promise<{
    product: T
    membership: Awaited<ReturnType<AccountAdminPort['getMembership']>>
    replayed: true
  } | null>
  eraseWorkspace(input: {
    actor: ActorContext
    workspaceId: string
    command: CommandIdentity
  }): Promise<{ commandId: string; completedAt: string }>
  eraseWorkspaceInExistingTransaction(workspaceId: string): void
  provisionWorkspaceInExistingTransaction(input: {
    workspaceId: string
    principalId: string
    joinedAt: string
    multiWorkspace: boolean
    projectedWorkspaceCount: number
  }): void
  withWorkspaceErasureLocks<T>(
    workspaceIds: readonly string[],
    operation: () => Promise<T> | T,
    options?: { serializeWorkspaceProvisioning?: boolean },
  ): Promise<T>
}

function denied(
  reason: string,
  action: 'issue-password-reset' | 'revoke-sessions',
  commandId?: string,
): AccountContractError {
  return new AccountContractError({
    code: reason === 'target-not-member' ? 'NOT_FOUND' : 'FORBIDDEN',
    message: reason === 'target-not-member'
      ? 'The target is not a member of this installation.'
      : action === 'issue-password-reset'
        ? 'This member belongs to another account where you lack password-reset authority.'
        : 'You lack session-revocation authority for this identity.',
    retryable: false,
    commandId,
  })
}

function authorityChanged(commandId: string): AccountContractError {
  return new AccountContractError({
    code: 'AUTHORITY_CHANGED',
    message: 'Identity-administration authority changed while the operation was in progress.',
    retryable: true,
    commandId,
  })
}

export function actorContextFromSession(input: {
  id: string
  principal: { id: string }
  freshUntil: string | null
  assurance: 'trusted-local' | 'password' | 'mfa' | 'federated'
}, now = Date.now()): ActorContext {
  return {
    principalId: input.principal.id,
    sessionId: input.id,
    assurance: input.assurance,
    fresh: input.freshUntil !== null && Date.parse(input.freshUntil) > now,
    mfaSatisfied: input.assurance === 'mfa' || input.assurance === 'federated' || input.assurance === 'trusted-local',
  }
}

/** Cross-port orchestration only: policy decisions remain inside AccountAdminPort. */
export function localAccountFlows(input: {
  applicationId: string
  db: Db
  identity: LocalIdentityPort
  administration: LocalAccountAdminPort
  lock: KeyedOperationLock
  audit?: AccountAuditPort
}): LocalAccountFlows {
  const { applicationId, db, identity, administration, lock } = input
  const accountAudit: AccountAuditPort = input.audit ?? { append: () => true }
  const resetReplay = new Map<string, PasswordResetCeremony>()
  const MAX_RESET_REPLAYS = 128

  const pruneResetReplay = (now = Date.now()): void => {
    for (const [commandId, ceremony] of resetReplay) {
      if (Date.parse(ceremony.expiresAt) <= now) resetReplay.delete(commandId)
    }
    while (resetReplay.size >= MAX_RESET_REPLAYS) {
      const oldest = resetReplay.keys().next().value as string | undefined
      if (!oldest) break
      resetReplay.delete(oldest)
    }
  }

  const terminateIfPending = (
    scope: { applicationId: string; operation: string },
    command: CommandIdentity,
    status: 'compensated' | 'reconciliation_required',
    code: Parameters<typeof terminateCommand>[4],
    repair?: unknown,
  ): void => {
    finishAccountCommandIfPending(db, {
      applicationId: scope.applicationId,
      operation: scope.operation,
      idempotencyKey: command.idempotencyKey,
      status,
      failureCode: code,
      resultJson: repair === undefined ? null : JSON.stringify(repair),
    })
  }

  const recordTerminalOutcome = (originalError: unknown, record: () => void): void => {
    try {
      record()
    } catch (recordingError) {
      throw new AggregateError(
        [originalError, recordingError],
        'Account flow failed and its terminal command outcome could not be recorded.',
        { cause: recordingError },
      )
    }
  }

  const audit = (event: {
    action: AccountAuditAction
    outcome: AccountAuditEvent['outcome']
    workspaceId?: string | null
    actorPrincipalId?: string | null
    targetPrincipalId?: string | null
    command: CommandIdentity
    changedFields?: readonly string[]
  }): void => {
    accountAudit.append({
      id: `${event.command.commandId}:${event.action}:${event.outcome}`,
      occurredAt: new Date().toISOString(),
      applicationId,
      workspaceId: event.workspaceId ?? null,
      actorPrincipalId: event.actorPrincipalId ?? null,
      targetPrincipalId: event.targetPrincipalId ?? null,
      commandId: event.command.commandId,
      action: event.action,
      outcome: event.outcome,
      changedFields: event.changedFields ?? [],
    })
  }

  return {
    async replayWorkspaceProvisioning<T>({ actor, workspaceId, command, canonicalProductPayload }: {
      actor: ActorContext
      workspaceId: string
      command: CommandIdentity
      canonicalProductPayload: unknown
    }) {
      return lock.withKeys([actor.principalId], () => {
        const operation = `workspace-provisioning:actor:${actor.principalId}`
        if (!readCommand(db, applicationId, operation, command)) return null
        const begun = beginCommand<{
          product: unknown
          membership: Awaited<ReturnType<AccountAdminPort['getMembership']>>
        }>(db, {
          applicationId,
          operation,
          actorPrincipalId: actor.principalId,
          targetPrincipalId: actor.principalId,
          workspaceId,
        }, command, { workspaceId, product: canonicalProductPayload })
        if (begun.kind !== 'replay') {
          throw new AccountContractError({
            code: 'COMMAND_IN_PROGRESS',
            message: 'That workspace-provisioning command is still in progress.',
            retryable: true,
            commandId: command.commandId,
          })
        }
        return { ...begun.result, replayed: true }
      }) as Promise<{
        product: T
        membership: Awaited<ReturnType<AccountAdminPort['getMembership']>>
        replayed: true
      } | null>
    },

    async provisionWorkspace({
      actor,
      workspaceId,
      joinedAt,
      command,
      multiWorkspace,
      bootstrapAuthorized,
      canonicalProductPayload,
      provisionProductData,
    }) {
      return lock.withKeys([
        actor.principalId,
        `application:${applicationId}:workspace-provisioning`,
      ], async () => {
        const operation = `workspace-provisioning:actor:${actor.principalId}`
        const scope = {
          applicationId,
          operation,
          actorPrincipalId: actor.principalId,
          targetPrincipalId: actor.principalId,
          workspaceId,
        }
        const begun = beginCommand<{
          product: unknown
          membership: Awaited<ReturnType<AccountAdminPort['getMembership']>>
        }>(db, scope, command, { workspaceId, product: canonicalProductPayload })
        if (begun.kind === 'replay') {
          return {
            ...(begun.result as {
              product: ReturnType<typeof provisionProductData>
              membership: Awaited<ReturnType<AccountAdminPort['getMembership']>>
            }),
            replayed: true,
          }
        }
        try {
          const result = tx(db, () => {
            const decision = administration.evaluateWorkspaceProvisioningAuthorityInTx({
              actor,
              multiWorkspace,
              bootstrapAuthorized,
            })
            if (!decision.allowed) {
              throw new AccountContractError({
                code: 'FORBIDDEN',
                message: decision.reason === 'single-workspace-cap'
                  ? 'This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.'
                  : 'Forbidden.',
                retryable: false,
                commandId: command.commandId,
              })
            }
            const product = provisionProductData()
            const membership = administration.provisionOwnerMembershipInTx({
              workspaceId,
              principalId: actor.principalId,
              joinedAt,
            })
            const result = { product, membership }
            completeCommand(db, scope, command, result)
            return result
          })
          audit({
            action: 'workspace.provisioned',
            outcome: 'success',
            workspaceId,
            actorPrincipalId: actor.principalId,
            targetPrincipalId: actor.principalId,
            command,
            changedFields: ['workspace', 'membership'],
          })
          return { ...result, replayed: false }
        } catch (error) {
          recordTerminalOutcome(error, () => terminateCommand(db, scope, command, 'compensated',
            error instanceof AccountContractError ? error.failure.code : 'CONFLICT'))
          audit({
            action: 'flow.compensated',
            outcome: 'compensated',
            workspaceId,
            actorPrincipalId: actor.principalId,
            command,
          })
          throw error
        }
      })
    },

    async eraseWorkspace({ actor, workspaceId, command }) {
      const eraseWithMembershipSnapshot = async (
        principalIds: readonly string[],
      ): Promise<{ commandId: string; completedAt: string }> => {
        const locked = new Set(principalIds)
        const result = await lock.withKeys(
          [actor.principalId, `workspace:${workspaceId}`, ...principalIds],
          async (): Promise<
            | { kind: 'retry'; principalIds: readonly string[] }
            | { kind: 'done'; value: { commandId: string; completedAt: string } }
          > => {
            // The membership snapshot was taken synchronously before lock acquisition. A mutation
            // that already held the workspace lock may have added a principal while we waited.
            // Re-snapshot under the workspace lock and retry with the full key set before deleting;
            // this keeps identity-admin operations serialized with every principal being erased.
            const currentPrincipalIds = administration.workspacePrincipalIds(workspaceId)
            if (currentPrincipalIds.some((principalId) => !locked.has(principalId))) {
              return { kind: 'retry', principalIds: currentPrincipalIds }
            }
            // Do not embed the soon-to-be-erased actor id in the durable operation key. The row is
            // retained briefly for safe client replay after erasure, with principal/workspace
            // columns anonymized in the same transaction.
            const operation = 'workspace-erasure'
            const scope = {
              applicationId,
              operation,
              actorPrincipalId: actor.principalId,
              workspaceId,
            }
            const begun = beginCommand<{ commandId: string; completedAt: string }>(
              db,
              scope,
              command,
              { workspaceId },
            )
            if (begun.kind === 'replay') {
              return { kind: 'done', value: markAccountCommandReplay(begun.result) }
            }
            try {
              const value = tx(db, () => {
                administration.assertWorkspaceErasureAuthorityInTx(actor, workspaceId)
                const orphaned = eraseWorkspaceDataAndMembershipsInTx(db, workspaceId)
                for (const principalId of orphaned) {
                  identity.deprovisionLocalPrincipalInTx(principalId, command.commandId)
                }
                const receipt = {
                  commandId: command.commandId,
                  completedAt: new Date().toISOString(),
                }
                eraseWorkspaceCommandHistoryInTx(db, workspaceId, command.commandId)
                completeCommand(db, scope, command, receipt)
                return receipt
              })
              audit({
                action: 'workspace.erased',
                outcome: 'success',
                workspaceId,
                actorPrincipalId: actor.principalId,
                command,
                changedFields: ['workspace', 'memberships', 'localPrincipals'],
              })
              return { kind: 'done', value }
            } catch (error) {
              recordTerminalOutcome(error, () => terminateCommand(db, scope, command, 'compensated',
                error instanceof AccountContractError ? error.failure.code : 'CONFLICT'))
              audit({
                action: 'flow.compensated',
                outcome: 'compensated',
                workspaceId,
                actorPrincipalId: actor.principalId,
                command,
              })
              throw error
            }
          },
        )
        return result.kind === 'done'
          ? result.value
          : eraseWithMembershipSnapshot(result.principalIds)
      }
      return eraseWithMembershipSnapshot(administration.workspacePrincipalIds(workspaceId))
    },

    eraseWorkspaceInExistingTransaction(workspaceId): void {
      const orphaned = eraseWorkspaceDataAndMembershipsInTx(db, workspaceId)
      for (const principalId of orphaned) identity.deprovisionLocalPrincipalInTx(principalId)
      eraseWorkspaceCommandHistoryInTx(db, workspaceId)
    },

    provisionWorkspaceInExistingTransaction({
      workspaceId,
      principalId,
      joinedAt,
      multiWorkspace,
      projectedWorkspaceCount,
    }): void {
      const decision = administration.evaluateWorkspaceProvisioningAuthorityInTx({
        actor: {
          principalId,
          sessionId: 'trusted-local',
          assurance: 'trusted-local',
          fresh: true,
          mfaSatisfied: true,
        },
        multiWorkspace,
        bootstrapAuthorized: false,
        projectedWorkspaceCount,
      })
      if (!decision.allowed) {
        throw new AccountContractError({
          code: 'FORBIDDEN',
          message: decision.reason === 'single-workspace-cap'
            ? 'This instance allows a single company. Set CAPACITYLENS_MULTI_ACCOUNT=1 to allow more.'
            : 'Forbidden.',
          retryable: false,
        })
      }
      administration.provisionOwnerMembershipInTx({ workspaceId, principalId, joinedAt })
    },

    async withWorkspaceErasureLocks<T>(
      workspaceIds: readonly string[],
      operation: () => Promise<T> | T,
      options: { serializeWorkspaceProvisioning?: boolean } = {},
    ): Promise<T> {
      const uniqueWorkspaceIds = [...new Set(workspaceIds)]
      const runWithSnapshot = async (principalIds: readonly string[]): Promise<T> => {
        const locked = new Set(principalIds)
        const result = await lock.withKeys(
          [
            ...(options.serializeWorkspaceProvisioning
              ? [`application:${applicationId}:workspace-provisioning`]
              : []),
            ...uniqueWorkspaceIds.map((workspaceId) => `workspace:${workspaceId}`),
            ...principalIds,
          ],
          async () => {
            const current = uniqueWorkspaceIds.flatMap((workspaceId) =>
              administration.workspacePrincipalIds(workspaceId))
            if (current.some((principalId) => !locked.has(principalId))) {
              return { kind: 'retry' as const, principalIds: current }
            }
            return { kind: 'done' as const, value: await operation() }
          },
        )
        return result.kind === 'done' ? result.value : runWithSnapshot(result.principalIds)
      }
      const initial = uniqueWorkspaceIds.flatMap((workspaceId) =>
        administration.workspacePrincipalIds(workspaceId))
      return runWithSnapshot(initial)
    },

    async resolveRequestAccess({ headers, workspaceId }) {
      const session = await identity.verifyApplicationSession({ headers })
      if (!session) return null
      const membership = await administration.getMembership({
        principalId: session.principal.id,
        workspaceId,
      })
      return membership ? { session, membership } : null
    },

    async listMemberDirectory({ actor, workspaceId }): Promise<readonly MemberDirectoryEntry[]> {
      const memberships = await administration.listMemberships({ actor, workspaceId })
      const principals = await identity.getPrincipalSummaries({
        principalIds: memberships.map((entry) => entry.principalId),
      })
      const byId = new Map(principals.map((principal) => [principal.id, principal]))
      return memberships.map((entry) => ({
        membership: entry,
        principal: byId.get(entry.principalId) ?? null,
      }))
    },

    async acceptInviteWithPasswordSignup({
      token,
      email,
      displayName,
      password,
      command,
    }): Promise<InviteSignupResult> {
      const operation = 'invite-password-signup'
      const scope = { applicationId, operation, actorPrincipalId: null }
      const begun = beginCommand<InviteSignupResult>(db, scope, command, {
        // Bind the full credential-bearing request without persisting either bearer, or a
        // standalone password verifier that a ledger reader could attack independently. Testing a
        // password candidate requires possession of the high-entropy invitation token as well.
        credentialBindingDigest: secretDigest('invite-signup-credentials', `${token}\0${password}`),
        normalizedEmail: email.trim().toLowerCase(),
        displayName,
      })
      if (begun.kind === 'replay') return markAccountCommandReplay(begun.result)

      let provisional: Awaited<ReturnType<IdentityPort['createProvisionalCredentialPrincipal']>> | null = null
      const claimState: { committed: boolean; membership: InviteSignupResult['membership'] | null } = {
        committed: false,
        membership: null,
      }
      try {
        const admission = await administration.preparePasswordInvitationClaim({
          token,
          normalizedEmail: email,
        })
        correlatePendingAccountCommand(db, {
          applicationId,
          operation,
          idempotencyKey: command.idempotencyKey,
          workspaceId: admission.workspaceId,
        })
        provisional = await identity.createProvisionalCredentialPrincipal({
          email,
          displayName,
          password,
          emailVerified: admission.emailVerifiedByInvitation,
          command,
        })
        correlatePendingAccountCommand(db, {
          applicationId,
          operation,
          idempotencyKey: command.idempotencyKey,
          workspaceId: admission.workspaceId,
          targetPrincipalId: provisional.principalId,
        })
        return await lock.withKeys([
          provisional.principalId,
          `workspace:${admission.workspaceId}`,
        ], async () => {
          const membership = await administration.claimInvitationForPrincipal({
            token,
            principalId: provisional!.principalId,
            principalEmail: email,
            emailVerified: admission.emailVerifiedByInvitation,
            passwordMode: true,
            command: {
              commandId: `${command.commandId}:claim`,
              idempotencyKey: `${command.idempotencyKey}:claim`,
            },
          })
          claimState.committed = true
          claimState.membership = membership
          const result: InviteSignupResult = {
            principalId: provisional!.principalId,
            membership,
            compensated: false,
          }
          // Keep the principal/workspace keys through parent completion. Otherwise workspace
          // erasure could delete both command rows after the child claim commits but before this
          // durable parent outcome is recorded, leaving the browser with nothing to reconcile.
          completeCommand(db, scope, command, result)
          return result
        })
      } catch (claimError) {
        if (claimState.committed) {
          recordTerminalOutcome(claimError, () => terminateIfPending(
            scope,
            command,
            'reconciliation_required',
            'DEPENDENCY_UNAVAILABLE',
            {
              kind: 'invitation-claim-committed',
              workspaceId: claimState.membership?.workspaceId ?? null,
              targetPrincipalId: provisional?.principalId ?? null,
              provisionalPrincipalId: provisional?.principalId ?? null,
              ceremonyId: null,
            },
          ))
          audit({
            action: 'flow.reconciliation_required',
            outcome: 'failed',
            workspaceId: claimState.membership?.workspaceId ?? null,
            targetPrincipalId: provisional?.principalId ?? null,
            command,
            changedFields: ['commandLedger'],
          })
          throw new AccountContractError({
            code: 'DEPENDENCY_UNAVAILABLE',
            message: 'The invitation was claimed, but completion must be reconciled before retrying.',
            retryable: true,
            commandId: command.commandId,
          }, { cause: claimError })
        }
        if (!provisional) {
          recordTerminalOutcome(claimError, () => terminateCommand(db, scope, command, 'compensated',
            claimError instanceof AccountContractError ? claimError.failure.code : 'CONFLICT'))
          audit({
            action: 'flow.compensated',
            outcome: 'compensated',
            command,
          })
          throw claimError
        }
        const provisionalPrincipalId = provisional.principalId
        let compensationError: unknown = null
        try {
          await identity.compensateProvisionalPrincipal({
            provisional,
            reason: 'invitation-claim-failed',
            command,
          })
        } catch (error) {
          compensationError = error
        }
        if (compensationError === null) {
          recordTerminalOutcome(claimError, () => terminateCommand(db, scope, command, 'compensated',
            claimError instanceof AccountContractError ? claimError.failure.code : 'CONFLICT'))
          audit({
            action: 'flow.compensated',
            outcome: 'compensated',
            targetPrincipalId: provisionalPrincipalId,
            command,
            changedFields: ['localPrincipal'],
          })
          throw claimError
        }
        const combinedFailure = new AggregateError([claimError, compensationError])
        recordTerminalOutcome(combinedFailure, () => terminateCommand(
          db,
          scope,
          command,
          'reconciliation_required',
          'COMPENSATION_FAILED',
          {
            kind: 'provisional-principal-compensation-failed',
            workspaceId: null,
            targetPrincipalId: provisionalPrincipalId,
            provisionalPrincipalId,
            ceremonyId: null,
          },
        ))
        audit({
          action: 'flow.reconciliation_required',
          outcome: 'failed',
          targetPrincipalId: provisionalPrincipalId,
          command,
          changedFields: ['localPrincipal'],
        })
        throw new AccountContractError({
          code: 'COMPENSATION_FAILED',
          message: 'Invitation claim failed and the provisional local identity could not be removed.',
          retryable: true,
          commandId: command.commandId,
        }, { cause: combinedFailure })
      }
    },

    async issuePasswordReset({ actor, targetPrincipalId, command }) {
      return lock.withKeys([actor.principalId, targetPrincipalId], async () => {
        const operation = `password-reset:actor:${actor.principalId}`
        const scope = {
          applicationId,
          operation,
          actorPrincipalId: actor.principalId,
          targetPrincipalId,
        }
        const begun = beginCommand<Omit<PasswordResetCeremony, 'token'>>(db, scope, command, {
          targetPrincipalId,
        })
        if (begun.kind === 'replay') {
          // Replaying this command re-discloses a write-once bearer token, so idempotency must not
          // bypass authority changes that happened after its original issuance.
          const decision = await administration.evaluateIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: 'issue-password-reset',
          })
          if (!decision.allowed) {
            throw denied(decision.reason, 'issue-password-reset', begun.record.commandId)
          }
          const confirmed = await administration.confirmIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: 'issue-password-reset',
            expectedRevision: decision.revision,
          })
          if (!confirmed) throw authorityChanged(begun.record.commandId)
          pruneResetReplay()
          const replay = resetReplay.get(begun.record.commandId)
          if (replay) return markAccountCommandReplay(replay)
          throw new AccountContractError({
            code: 'CONFLICT',
            message: 'The reset command already completed; its write-once token is no longer available.',
            retryable: false,
            commandId: begun.record.commandId,
          })
        }
        let issuanceStarted = false
        let ceremony: PasswordResetCeremony | null = null
        let terminalOutcomeRecorded = false
        try {
          const decision = await administration.evaluateIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: 'issue-password-reset',
          })
          if (!decision.allowed) {
            terminateCommand(db, scope, command, 'compensated',
              decision.reason === 'target-not-member' ? 'NOT_FOUND' : 'FORBIDDEN')
            audit({
              action: 'identity.password_reset_issued',
              outcome: 'denied',
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
            })
            throw denied(decision.reason, 'issue-password-reset', command.commandId)
          }
          issuanceStarted = true
          ceremony = await identity.issuePasswordReset({ targetPrincipalId, command })
          const confirmed = await administration.confirmIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: 'issue-password-reset',
            expectedRevision: decision.revision,
          })
          if (!confirmed) {
            const changed = authorityChanged(command.commandId)
            const ceremonyId = ceremony.ceremonyId
            try {
              await identity.revokePasswordResetCeremony({
                targetPrincipalId,
                ceremonyId,
                command,
              })
            } catch (revokeError) {
              recordTerminalOutcome(revokeError, () => terminateCommand(
                db,
                scope,
                command,
                'reconciliation_required',
                'COMPENSATION_FAILED',
                {
                  kind: 'password-reset-revocation-failed',
                  workspaceId: null,
                  targetPrincipalId,
                  provisionalPrincipalId: null,
                  ceremonyId,
                },
              ))
              terminalOutcomeRecorded = true
              audit({
                action: 'flow.reconciliation_required',
                outcome: 'failed',
                actorPrincipalId: actor.principalId,
                targetPrincipalId,
                command,
                changedFields: ['passwordResetCeremony'],
              })
              throw new AccountContractError({
                code: 'COMPENSATION_FAILED',
                message: 'Authority changed and the new reset ceremony could not be revoked.',
                retryable: true,
                commandId: command.commandId,
              }, { cause: revokeError })
            }
            recordTerminalOutcome(changed, () => terminateCommand(
              db,
              scope,
              command,
              'compensated',
              'AUTHORITY_CHANGED',
            ))
            terminalOutcomeRecorded = true
            audit({
              action: 'flow.compensated',
              outcome: 'compensated',
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
              changedFields: ['passwordResetCeremony'],
            })
            throw changed
          }
          completeCommand(db, scope, command, {
            ceremonyId: ceremony.ceremonyId,
            expiresAt: ceremony.expiresAt,
          })
          pruneResetReplay()
          resetReplay.set(command.commandId, ceremony)
          audit({
            action: 'identity.password_reset_issued',
            outcome: 'success',
            actorPrincipalId: actor.principalId,
            targetPrincipalId,
            command,
            changedFields: ['credential'],
          })
          return ceremony
        } catch (error) {
          const code = error instanceof AccountContractError ? error.failure.code : 'DEPENDENCY_UNAVAILABLE'
          const knownWithoutCeremony = error instanceof AccountContractError && (
            error.failure.code === 'NOT_FOUND' ||
            error.failure.code === 'VALIDATION_FAILED' ||
            error.failure.code === 'UNSUPPORTED_CAPABILITY'
          )
          const requiresReconciliation = issuanceStarted &&
            !(error instanceof AccountContractError && error.failure.code === 'AUTHORITY_CHANGED') &&
            !knownWithoutCeremony
          if (!terminalOutcomeRecorded) {
            recordTerminalOutcome(error, () => terminateIfPending(
                scope,
                command,
                requiresReconciliation ? 'reconciliation_required' : 'compensated',
                requiresReconciliation ? 'DEPENDENCY_UNAVAILABLE' : code,
                requiresReconciliation ? {
                  kind: ceremony ? 'password-reset-issued' : 'password-reset-outcome-unknown',
                  workspaceId: null,
                  targetPrincipalId,
                  provisionalPrincipalId: null,
                  ceremonyId: ceremony?.ceremonyId ?? null,
                } : undefined,
              ))
          }
          if (requiresReconciliation && !terminalOutcomeRecorded) {
            audit({
              action: 'flow.reconciliation_required',
              outcome: 'failed',
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
              changedFields: ['passwordResetCeremony', 'commandLedger'],
            })
          }
          throw error
        }
      })
    },

    async revokeMemberSessions({ actor, targetPrincipalId, command }) {
      return lock.withKeys([actor.principalId, targetPrincipalId], async () => {
        const operation = `session-revocation:actor:${actor.principalId}`
        const scope = {
          applicationId,
          operation,
          actorPrincipalId: actor.principalId,
          targetPrincipalId,
        }
        const begun = beginCommand<Awaited<ReturnType<IdentityPort['revokePrincipalSessions']>>>(
          db,
          scope,
          command,
          { targetPrincipalId },
        )
        if (begun.kind === 'replay') return markAccountCommandReplay(begun.result)
        let revocationStarted = false
        try {
          const decision = await administration.evaluateIdentityAdminAuthority({
            actor,
            targetPrincipalId,
            action: 'revoke-sessions',
          })
          if (!decision.allowed) {
            terminateCommand(db, scope, command, 'compensated',
              decision.reason === 'target-not-member' ? 'NOT_FOUND' : 'FORBIDDEN')
            audit({
              action: 'identity.sessions_revoked',
              outcome: 'denied',
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
            })
            throw denied(decision.reason, 'revoke-sessions', command.commandId)
          }
          revocationStarted = true
          const result = await identity.revokePrincipalSessions({ targetPrincipalId, command })
          completeCommand(db, scope, command, result)
          audit({
            action: 'identity.sessions_revoked',
            outcome: 'success',
            actorPrincipalId: actor.principalId,
            targetPrincipalId,
            command,
            changedFields: ['sessions'],
          })
          return result
        } catch (error) {
          const code = error instanceof AccountContractError ? error.failure.code : 'DEPENDENCY_UNAVAILABLE'
          recordTerminalOutcome(error, () => terminateIfPending(
              scope,
              command,
              revocationStarted ? 'reconciliation_required' : 'compensated',
              revocationStarted ? 'DEPENDENCY_UNAVAILABLE' : code,
              revocationStarted ? {
                kind: 'session-revocation-outcome-unknown',
                workspaceId: null,
                targetPrincipalId,
                provisionalPrincipalId: null,
                ceremonyId: null,
              } : undefined,
            ))
          if (revocationStarted) {
            audit({
              action: 'flow.reconciliation_required',
              outcome: 'failed',
              actorPrincipalId: actor.principalId,
              targetPrincipalId,
              command,
              changedFields: ['sessions', 'commandLedger'],
            })
          }
          throw error
        }
      })
    },

    async reconcileCommand({ command, operation }): Promise<CommandOutcome | null> {
      const row = getAccountCommandByIdForReconciliation(db, applicationId, command.commandId)
      if (
        !row ||
        row.idempotencyKey !== command.idempotencyKey ||
        !(row.operation === operation || row.operation.startsWith(`${operation}:actor:`))
      ) {
        return null
      }
      const receipt = { commandId: row.commandId, completedAt: row.updatedAt }
      if (row.status === 'completed') return { status: 'completed', receipt }
      if (row.status === 'compensated') return { status: 'compensated', receipt }
      if (row.status === 'pending') return { status: 'pending', receipt }
      if (row.status === 'reconciliation_required') {
        let stored: Record<string, unknown> = {}
        try {
          const parsed: unknown = row.resultJson === null ? null : JSON.parse(row.resultJson)
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            stored = parsed as Record<string, unknown>
          }
        } catch {
          stored = {}
        }
        return {
          status: 'reconciliation-required',
          failure: {
            code: row.failureCode ?? 'DEPENDENCY_UNAVAILABLE',
            message: 'This command requires operator reconciliation before it can be retried.',
            retryable: true,
            commandId: row.commandId,
          },
          repair: {
            kind: typeof stored.kind === 'string' ? stored.kind : 'operator-review',
            workspaceId: typeof stored.workspaceId === 'string' ? stored.workspaceId : row.workspaceId,
            targetPrincipalId: typeof stored.targetPrincipalId === 'string'
              ? stored.targetPrincipalId
              : row.targetPrincipalId,
            provisionalPrincipalId: typeof stored.provisionalPrincipalId === 'string'
              ? stored.provisionalPrincipalId
              : null,
            ceremonyId: typeof stored.ceremonyId === 'string' ? stored.ceremonyId : null,
          },
        }
      }
      return { status: 'pending', receipt }
    },
  }
}
