import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { HttpContext } from '@adonisjs/core/http'
import { canAdministerIdentityAcrossWorkspaces } from '@capacitylens/shared/account/policy'
import type { Role } from '@capacitylens/shared/account/types'
import { can, type Action } from '@capacitylens/shared/domain/access'
import { authMode } from '#services/auth/mode'
import { resolveCurrentActor, assertFreshSession } from '#services/auth/session_authority'

export class IdentityAuthorityError extends Error {
  code = 'IDENTITY_AUTHORITY_DENIED'
  status = 403
}

const roles = new Set<Role>(['viewer', 'editor', 'admin', 'owner'])

function role(value: unknown): Role {
  if (typeof value !== 'string' || !roles.has(value as Role))
    throw new IdentityAuthorityError('Invalid membership role.')
  return value as Role
}

async function memberRoles(userId: string, trx: TransactionClientContract, activeOnly: boolean) {
  const query = trx
    .from('memberships as membership')
    .innerJoin('accounts as account', 'account.id', 'membership.account_id')
    .where('membership.user_id', userId)
  if (activeOnly) query.where('membership.status', 'active')
  const rows = await query.select('membership.account_id', 'membership.role')
  return new Map(rows.map((row) => [String(row.account_id), role(row.role)]))
}

/** Checks identity-wide standing from transaction-current memberships before cross-user security changes. */
export async function assertMayAdministerTarget(
  actorUserId: string,
  targetUserId: string,
  trx: TransactionClientContract
) {
  const [actorRoles, targetRoles] = await Promise.all([
    memberRoles(actorUserId, trx, true),
    memberRoles(targetUserId, trx, false),
  ])
  if (!canAdministerIdentityAcrossWorkspaces(actorRoles, targetRoles, actorUserId === targetUserId))
    throw new IdentityAuthorityError('You cannot administer this identity.')
}

/** Resolves active company standing for ordinary data and member policies. */
export async function activeCompanyRole(
  actorUserId: string,
  accountId: string,
  trx: TransactionClientContract
): Promise<Role | null> {
  const row = await trx
    .from('memberships')
    .where({ user_id: actorUserId, account_id: accountId, status: 'active' })
    .select('role')
    .first()
  return row ? role(row.role) : null
}

/** Authorizes one company action from live membership and session state inside the caller's transaction. */
export async function assertCompanyAction(
  ctx: HttpContext,
  accountId: string,
  action: Action,
  trx: TransactionClientContract,
  fresh = false
): Promise<{ actorId: string; role: Role }> {
  if (authMode() === 'off')
    return { actorId: ctx.auth.use('trustedLocal').getUserOrFail().id, role: 'owner' }
  const actor = await resolveCurrentActor(ctx, trx)
  const memberRole = await activeCompanyRole(actor.userId, accountId, trx)
  if (!memberRole || !can(memberRole, action)) throw new IdentityAuthorityError('Forbidden.')
  if (fresh) assertFreshSession(actor)
  return { actorId: actor.userId, role: memberRole }
}
