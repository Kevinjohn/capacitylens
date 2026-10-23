import type { HttpContext } from '@adonisjs/core/http'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import db from '@adonisjs/lucid/services/db'
import type { Role } from '@capacitylens/shared/account/types'
import { can } from '@capacitylens/shared/domain/access'
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization'
import { resolveCurrentActor } from '#services/auth/session_authority'
import { writeAudit } from '#services/audit'

export class MasqueradeError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message)
  }
}

interface ActiveMasquerade {
  id: string
  accountId: string
  actorId: string
  targetId: string
  token: string
  startedAt: string
}

function parseActive(row: Record<string, unknown> | undefined): ActiveMasquerade | null {
  if (!row) return null
  if (
    typeof row.id !== 'string' ||
    typeof row.account_id !== 'string' ||
    typeof row.actor_user_id !== 'string' ||
    typeof row.target_user_id !== 'string' ||
    typeof row.token !== 'string' ||
    typeof row.started_at !== 'string'
  )
    throw new MasqueradeError('Invalid masquerade state.', 'MASQUERADE_ENDED', 403)
  return {
    id: row.id,
    accountId: row.account_id,
    actorId: row.actor_user_id,
    targetId: row.target_user_id,
    token: row.token,
    startedAt: row.started_at,
  }
}

/** Reads only the projection bound to the current native session. */
export async function activeMasquerade(
  sessionId: string,
  connection: Pick<typeof db, 'from'> = db
): Promise<ActiveMasquerade | null> {
  return parseActive(await connection.from('masquerades').where('session_id', sessionId).first())
}

/** Re-checks the viewer too, so removal or demotion ends an open view on the next request. */
async function targetRole(record: ActiveMasquerade, trx: TransactionClientContract) {
  const actorRole = await activeCompanyRole(record.actorId, record.accountId, trx)
  if (!actorRole || !can(actorRole, 'masquerade'))
    throw new IdentityAuthorityError('Viewer is no longer permitted.')
  const target = await trx.from('users').where('id', record.targetId).first()
  if (!target) throw new IdentityAuthorityError('Target is unavailable.')
  const role = await activeCompanyRole(record.targetId, record.accountId, trx)
  if (!role) throw new IdentityAuthorityError('Target is unavailable.')
  return { target, role }
}

/** Resolves the real actor and transaction-current effective member for data reads. */
export async function effectiveReadPrincipal(ctx: HttpContext, trx: TransactionClientContract) {
  const actor = await resolveCurrentActor(ctx, trx)
  const record = await activeMasquerade(actor.sessionId, trx)
  if (!record) return { actorId: actor.userId, effectiveId: actor.userId, accountId: null }
  if (record.actorId !== actor.userId)
    throw new MasqueradeError('Masquerade session changed.', 'MASQUERADE_ENDED', 403)
  await targetRole(record, trx)
  return { actorId: actor.userId, effectiveId: record.targetId, accountId: record.accountId }
}

function responseState(record: ActiveMasquerade, target: Record<string, unknown>, role: Role) {
  return {
    accountId: record.accountId,
    targetUserId: record.targetId,
    targetName: String(target.display_name || target.email || 'Member'),
    effectiveRole: role,
    startedAt: record.startedAt,
    token: record.token,
  }
}

export async function startMasquerade(
  ctx: HttpContext,
  accountId: string,
  targetUserId: string,
  trx: TransactionClientContract
) {
  const actor = await resolveCurrentActor(ctx, trx)
  if (await activeMasquerade(actor.sessionId, trx))
    throw new MasqueradeError('Masquerade already active.', 'MASQUERADE_ACTIVE', 409)
  const actorRole = await activeCompanyRole(actor.userId, accountId, trx)
  if (!actorRole || !can(actorRole, 'masquerade')) throw new IdentityAuthorityError('Forbidden.')
  if (actor.userId === targetUserId)
    throw new MasqueradeError('Cannot masquerade as yourself.', 'MASQUERADE_SELF', 400)
  const target = await trx.from('users').where('id', targetUserId).first()
  const role = await activeCompanyRole(targetUserId, accountId, trx)
  if (!target || !role) throw new MasqueradeError('Member not found.', 'MEMBER_NOT_FOUND', 404)
  const now = new Date().toISOString()
  const record: ActiveMasquerade = {
    id: crypto.randomUUID(),
    accountId,
    actorId: actor.userId,
    targetId: targetUserId,
    token: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),
    startedAt: now,
  }
  await trx.table('masquerades').insert({
    id: record.id,
    account_id: accountId,
    session_id: actor.sessionId,
    actor_user_id: actor.userId,
    target_user_id: targetUserId,
    role,
    token: record.token,
    started_at: now,
    created_at: now,
    updated_at: now,
  })
  await writeAudit(trx, {
    accountId,
    actorId: actor.userId,
    action: 'identity.masquerade_started',
    entity: 'user',
    entityId: targetUserId,
    fields: ['masquerade'],
  })
  return responseState(record, target, role)
}

export async function currentMasquerade(ctx: HttpContext, trx: TransactionClientContract) {
  const actor = await resolveCurrentActor(ctx, trx)
  const record = await activeMasquerade(actor.sessionId, trx)
  if (!record) return { active: false as const }
  if (record.actorId !== actor.userId)
    throw new MasqueradeError('Masquerade session changed.', 'MASQUERADE_ENDED', 403)
  const { target, role } = await targetRole(record, trx)
  return {
    active: true as const,
    ...responseState(record, target, role),
    principal: {
      id: actor.userId,
      name: actor.user.displayName ?? null,
      email: actor.user.email,
    },
    authMode: 'password-only',
  }
}

/** Ends only the current session's projection and audits with the real actor. */
export async function endMasquerade(
  ctx: HttpContext,
  token: string,
  reason: 'explicit' | 'account_switch' | 'sign_out',
  trx: TransactionClientContract
) {
  const actor = await resolveCurrentActor(ctx, trx)
  const record = await activeMasquerade(actor.sessionId, trx)
  if (!record || record.token !== token || record.actorId !== actor.userId) return
  await writeAudit(trx, {
    accountId: record.accountId,
    actorId: actor.userId,
    action: 'identity.masquerade_ended',
    entity: 'user',
    entityId: record.targetId,
    fields: ['masquerade', reason],
  })
  await trx.from('masquerades').where('id', record.id).delete()
}

export async function endMasqueradeForSignOut(ctx: HttpContext, trx: TransactionClientContract) {
  const actor = await resolveCurrentActor(ctx, trx)
  const record = await activeMasquerade(actor.sessionId, trx)
  if (record) await endMasquerade(ctx, record.token, 'sign_out', trx)
}
