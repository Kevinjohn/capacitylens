import type { HttpContext } from '@adonisjs/core/http'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Role } from '@capacitylens/shared/account/types'
import {
  isAccountRole,
  isMembershipStatus,
  allowsPasswordSignIn,
} from '@capacitylens/shared/account/types'
import { canAdministerIdentityAcrossWorkspaces } from '@capacitylens/shared/account/policy'
import { authMode } from '#services/auth/mode'
import {
  assertCompanyAction,
  assertMayAdministerTarget,
  restrictedCompanyIds,
} from '#services/auth/authorization'
import {
  assertFreshSession,
  resolveCurrentActor,
  invalidateUserSessions,
  destroyNativeSessions,
} from '#services/auth/session_authority'
import { requestAdministrativeReset } from '#services/credentials/operations'
import {
  CredentialAuthorityError,
  CredentialConflictError,
  CredentialInputError,
  CredentialUnavailableError,
} from '#services/credentials/credential_errors'
import { withTransaction } from '#services/with_transaction'
import { writeAudit } from '#services/audit'
import {
  AccountCommandError,
  claimAccountCommand,
  completeAccountCommand,
  readAccountCommand,
} from '#services/account_commands'
import {
  changeMemberRole,
  changeMemberStatus,
  enableMemberAccess,
  MembershipError,
  removeMember,
} from '#services/membership/member_mutations'
import {
  clearMemberSignIn,
  confirmMemberSignIn,
  readMemberSignInTracking,
  setMemberSignInTracking,
} from '#services/membership/sign_in_tracking'
import {
  readMemberResourceFields,
  readResourceCandidates,
} from '#services/member_resources/directory'

function fields(value: unknown, allowed: string[]): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.includes(key))
  )
}

function replyMemberError(ctx: HttpContext, error: unknown) {
  if (
    error instanceof MembershipError ||
    error instanceof AccountCommandError ||
    error instanceof CredentialAuthorityError ||
    error instanceof CredentialConflictError ||
    error instanceof CredentialInputError ||
    error instanceof CredentialUnavailableError
  )
    return ctx.response.status(error.status).send({ error: error.message, code: error.code })
  throw error
}

async function semanticMutation<T>(
  ctx: HttpContext,
  operation: string,
  payload: unknown,
  work: (trx: TransactionClientContract, actor: { actorId: string; role: Role }) => Promise<T>,
  beforeClaim?: (
    trx: TransactionClientContract,
    actor: { actorId: string; role: Role }
  ) => Promise<void>
) {
  const command = readAccountCommand(ctx)
  const accountId = ctx.params.accountId
  return withTransaction(async (trx) => {
    const actor = await assertCompanyAction(ctx, accountId, 'manageMembers', trx)
    await beforeClaim?.(trx, actor)
    const claim = await claimAccountCommand(trx, {
      accountId,
      actorId: actor.actorId,
      operation,
      payload,
      command,
      kind: 'semantic',
    })
    if (claim.replayed) return claim.result as T
    const result = await work(trx, actor)
    await completeAccountCommand(trx, command.commandId, result)
    return result
  })
}

export default class MembersController {
  async index(ctx: HttpContext) {
    if (authMode() === 'off')
      return ctx.response.ok({ members: [], signInTrackingEnabled: false, resourceCandidates: [] })
    const accountId = ctx.params.accountId
    const directory = await withTransaction(async (trx) => {
      const actor = await assertCompanyAction(ctx, accountId, 'manageMembers', trx)
      const [rows, restrictions, tracking, allRoles, resourceCandidates, restrictedActor] =
        await Promise.all([
          trx
            .from('memberships as member')
            .leftJoin('users as principal', 'principal.id', 'member.user_id')
            .where('member.account_id', accountId)
            .select(
              'member.user_id',
              'member.role',
              'member.status',
              'member.created_at',
              'principal.display_name',
              'principal.email'
            )
            .orderBy('member.created_at', 'asc'),
          trx
            .from('account_access_restrictions as restriction')
            .leftJoin('users as principal', 'principal.id', 'restriction.principal_id')
            .where('restriction.account_id', accountId)
            .select(
              'restriction.principal_id',
              'restriction.role',
              'restriction.verified_email',
              'restriction.created_at',
              'principal.display_name',
              'principal.email'
            )
            .orderBy('restriction.created_at', 'asc')
            .orderBy('restriction.principal_id', 'asc'),
          readMemberSignInTracking(accountId, trx),
          trx
            .from('memberships as member')
            .innerJoin('accounts as account', 'account.id', 'member.account_id')
            .select('member.account_id', 'member.user_id', 'member.role', 'member.status'),
          readResourceCandidates(trx, accountId),
          restrictedCompanyIds(actor.actorId, trx),
        ])
      const denied = new Set(restrictions.map((row) => String(row.principal_id)))
      const memberIds = new Set(rows.map((row) => String(row.user_id)))
      const actorRoles = new Map<string, Role>()
      for (const row of allRoles) {
        if (
          row.user_id === actor.actorId &&
          row.status === 'active' &&
          !restrictedActor.has(String(row.account_id)) &&
          isAccountRole(row.role)
        )
          actorRoles.set(String(row.account_id), row.role)
      }
      const members = []
      for (const row of rows) {
        const userId = String(row.user_id)
        const targetRoles = new Map<string, Role>()
        for (const membership of allRoles) {
          if (membership.user_id === userId && isAccountRole(membership.role))
            targetRoles.set(String(membership.account_id), membership.role)
        }
        const mayAdminister = canAdministerIdentityAcrossWorkspaces(
          actorRoles,
          targetRoles,
          actor.actorId === userId
        )
        const resourceFields = await readMemberResourceFields(trx, accountId, userId)
        members.push({
          userId,
          role: row.role,
          status: row.status,
          accessDisabled: denied.has(userId),
          membershipPresent: true,
          createdAt: row.created_at,
          name: row.display_name ?? null,
          email: row.email ?? null,
          signInConfirmed: tracking.enabled ? tracking.confirmations.has(userId) : null,
          isSelf: actor.actorId === userId,
          mayResetPassword: allowsPasswordSignIn(authMode()) && mayAdminister,
          mayRevokeSessions: mayAdminister,
          ...resourceFields,
        })
      }
      for (const row of restrictions) {
        const userId = String(row.principal_id)
        if (memberIds.has(userId)) continue
        members.push({
          userId,
          role: row.role,
          status: 'disabled',
          accessDisabled: true,
          membershipPresent: false,
          createdAt: row.created_at,
          name: row.display_name ?? null,
          email: row.email ?? row.verified_email ?? null,
          signInConfirmed: tracking.enabled ? tracking.confirmations.has(userId) : null,
          isSelf: actor.actorId === userId,
          mayResetPassword: false,
          mayRevokeSessions: false,
          resourceLink: null,
          resourceLinkException: null,
        })
      }
      return { members, signInTrackingEnabled: tracking.enabled, resourceCandidates }
    })
    return ctx.response.ok(directory)
  }

  async tracking(ctx: HttpContext) {
    if (!fields(ctx.request.body(), ['enabled']) || typeof ctx.request.body().enabled !== 'boolean')
      return ctx.response.badRequest({ error: 'enabled must be a Boolean.' })
    const enabled = ctx.request.body().enabled as boolean
    const accountId = ctx.params.accountId
    await withTransaction(async (trx) => {
      const actor = await assertCompanyAction(ctx, accountId, 'manageMemberSignInTracking', trx)
      const current = await readMemberSignInTracking(accountId, trx)
      await setMemberSignInTracking(accountId, enabled, trx)
      if (!current.enabled && enabled) await confirmMemberSignIn(accountId, actor.actorId, trx)
      if (current.enabled !== enabled)
        await writeAudit(trx, {
          accountId,
          actorId: actor.actorId,
          action: 'memberSignInTrackingChange',
          entity: 'account',
          entityId: accountId,
          fields: ['memberSignInTracking'],
        })
    })
    return ctx.response.ok({ enabled })
  }

  async changeRole(ctx: HttpContext) {
    const body: unknown = ctx.request.body()
    if (!fields(body, ['role']) || !isAccountRole(body.role))
      return ctx.response.badRequest({ error: 'Invalid member role.' })
    try {
      const result = await semanticMutation(
        ctx,
        'change-member-role',
        {
          userId: ctx.params.userId,
          role: body.role,
        },
        (trx, actor) =>
          changeMemberRole(trx, {
            accountId: ctx.params.accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId: ctx.params.userId,
            role: body.role as Role,
          })
      )
      return ctx.response.ok(result)
    } catch (error) {
      return replyMemberError(ctx, error)
    }
  }

  async changeStatus(ctx: HttpContext) {
    const body: unknown = ctx.request.body()
    if (!fields(body, ['status']) || !isMembershipStatus(body.status))
      return ctx.response.badRequest({ error: 'Invalid member status.' })
    try {
      const result = await semanticMutation(
        ctx,
        'change-member-status',
        {
          userId: ctx.params.userId,
          status: body.status,
        },
        (trx, actor) =>
          changeMemberStatus(trx, {
            accountId: ctx.params.accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId: ctx.params.userId,
            status: body.status as 'active' | 'disabled' | 'archived',
          })
      )
      return ctx.response.ok(result)
    } catch (error) {
      return replyMemberError(ctx, error)
    }
  }

  async enableAccess(ctx: HttpContext) {
    try {
      const result = await semanticMutation(
        ctx,
        'enable-member-access',
        { userId: ctx.params.userId },
        (trx, actor) =>
          enableMemberAccess(trx, {
            accountId: ctx.params.accountId,
            actorId: actor.actorId,
            actorRole: actor.role,
            userId: ctx.params.userId,
          })
      )
      return ctx.response.ok(result)
    } catch (error) {
      return replyMemberError(ctx, error)
    }
  }

  async remove(ctx: HttpContext) {
    try {
      await semanticMutation(ctx, 'remove-member', { userId: ctx.params.userId }, (trx, actor) =>
        removeMember(trx, {
          accountId: ctx.params.accountId,
          actorId: actor.actorId,
          actorRole: actor.role,
          userId: ctx.params.userId,
        })
      )
      return ctx.response.noContent()
    } catch (error) {
      return replyMemberError(ctx, error)
    }
  }

  async resetPassword(ctx: HttpContext) {
    if (!allowsPasswordSignIn(authMode()))
      return ctx.response.badRequest({ error: 'Password reset is unavailable.' })
    try {
      const command = readAccountCommand(ctx)
      const result = await requestAdministrativeReset({
        ctx,
        accountId: ctx.params.accountId,
        targetUserId: ctx.params.userId,
        ...command,
      })
      return ctx.response.created(result)
    } catch (error) {
      return replyMemberError(ctx, error)
    }
  }

  async revokeSessions(ctx: HttpContext) {
    if (authMode() === 'off')
      return ctx.response.badRequest({ error: 'Session revocation requires authentication.' })
    let nativeIds: string[] = []
    try {
      await semanticMutation(
        ctx,
        'revoke-member-sessions',
        { userId: ctx.params.userId },
        async (trx, actor) => {
          const target = await trx
            .from('memberships')
            .where({ account_id: ctx.params.accountId, user_id: ctx.params.userId })
            .first()
          if (!target)
            throw new MembershipError('Not a member of this workspace.', 404, 'NOT_FOUND')
          if (actor.actorId !== ctx.params.userId)
            await assertMayAdministerTarget(actor.actorId, ctx.params.userId, trx)
          nativeIds = await invalidateUserSessions({ userId: ctx.params.userId }, trx)
          await clearMemberSignIn(ctx.params.userId, trx)
          await writeAudit(trx, {
            accountId: ctx.params.accountId,
            actorId: actor.actorId,
            action: 'sessionsRevoke',
            entity: 'identity',
            entityId: ctx.params.userId,
            fields: ['sessions'],
          })
          return { revoked: true }
        },
        async (trx, actor) => {
          if (actor.actorId !== ctx.params.userId)
            assertFreshSession(await resolveCurrentActor(ctx, trx))
        }
      )
    } catch (error) {
      return replyMemberError(ctx, error)
    }
    try {
      await destroyNativeSessions(nativeIds)
    } catch (error) {
      ctx.logger.error({ err: error }, 'Revoked session index but native cleanup failed')
    }
    return ctx.response.noContent()
  }
}
