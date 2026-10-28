import type { HttpContext } from '@adonisjs/core/http'
import {
  MasqueradeError as PackageMasqueradeError,
  createMasqueradeService,
} from 'adonisjs-masquerade'
import type { MasqueradeService, ModeView } from 'adonisjs-masquerade'
import app from '@adonisjs/core/services/app'
import logger from '@adonisjs/core/services/logger'
import db from '@adonisjs/lucid/services/db'
import config from '#config/masquerade'
import { nativeAdapter } from '#config/masquerade'
import { actorIn } from '#services/auth/current_actor'
import { capturedMasqueradeContext } from '#services/auth/masquerade_request'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization'
import { can } from '@capacitylens/shared/domain/access'
import type { Role } from '@capacitylens/shared/account/types'

export { PackageMasqueradeError as MasqueradeError }

let servicePromise: Promise<MasqueradeService<HttpContext>> | undefined

/** Lazily opens the package control store outside any product transaction. */
export function masqueradeService() {
  servicePromise ??= createMasqueradeService(config, {
    environment: app.nodeEnvironment,
    authenticateActor: (ctx) => nativeAdapter.authenticateActor(ctx),
    emitter: { emit: () => undefined },
    logger: {
      info: (event) => logger.info(event),
      error: (event) => logger.error(event),
    },
    observerErrorHandler: (error) => logger.error({ code: 'E_MASQUERADE_OBSERVER_FAILED', error }),
  })
  return servicePromise
}

/** Current package mode with product display details, read outside any product transaction. */
export async function currentMasquerade(ctx: HttpContext) {
  const service = await masqueradeService()
  try {
    await service.resolve(ctx)
  } catch (error) {
    if (!(error instanceof PackageMasqueradeError) || error.code !== 'E_MASQUERADE_CONTEXT_CHANGED')
      throw error
  }
  const view = await service.status(ctx)
  if (!view.isMasquerading) return { active: false as const, contextToken: view.contextToken }
  const actor = await nativeAdapter.authenticateActor(ctx)
  const target = await db
    .from('users')
    .where('id', view.targetId)
    .select('display_name', 'email')
    .first()
  if (!target) throw new PackageMasqueradeError('E_MASQUERADE_CONTEXT_CHANGED')
  const requestedAccountId =
    (typeof ctx.params.accountId === 'string' && ctx.params.accountId) ||
    (typeof ctx.request.input('accountId') === 'string' && ctx.request.input('accountId'))
  let accountId: string | null = null
  let effectiveRole: Role | null = null
  if (requestedAccountId) {
    const actorRole = await activeCompanyRole(actor.id, requestedAccountId, db)
    const targetRole = await activeCompanyRole(view.targetId, requestedAccountId, db)
    if (actorRole && can(actorRole, 'masquerade') && targetRole) {
      accountId = requestedAccountId
      effectiveRole = targetRole
    }
  }
  // Another tab of the same sign-in may sit on a company the target does not share. Report the
  // mode where it holds so that tab can adopt the current context and offer End; company reads
  // are still authorized per request by effectiveReadPrincipal.
  if (!accountId) {
    const memberships = await db
      .from('memberships')
      .where({ user_id: actor.id, status: 'active' })
      .orderBy('account_id', 'asc')
      .select('account_id')
    for (const row of memberships) {
      const candidate = String(row.account_id)
      const actorRole = await activeCompanyRole(actor.id, candidate, db)
      const targetRole = await activeCompanyRole(view.targetId, candidate, db)
      if (actorRole && can(actorRole, 'masquerade') && targetRole) {
        accountId = candidate
        effectiveRole = targetRole
        break
      }
    }
    if (!accountId || !effectiveRole)
      throw new PackageMasqueradeError('E_MASQUERADE_CONTEXT_CHANGED')
  }
  return {
    active: true as const,
    accountId,
    targetUserId: view.targetId,
    targetName: String(target.display_name || target.email || 'Member'),
    effectiveRole,
    startedAt: view.startedAt,
    expiresAt: view.expiresAt,
    contextToken: view.contextToken,
    token: view.contextToken,
    principal: { id: actor.id, name: actor.user.displayName, email: actor.user.email },
    authMode: 'password-only',
  }
}

export async function startMasquerade(ctx: HttpContext, targetUserId: string) {
  const service = await masqueradeService()
  return service.start(ctx, {
    targetId: targetUserId,
    access: 'view',
    expectedContext: ctx.request.header('X-Masquerade-Context') ?? '',
  })
}

export async function endMasquerade(ctx: HttpContext) {
  const service = await masqueradeService()
  return service.stop(ctx, {
    expectedContext: ctx.request.header('X-Masquerade-Context') ?? '',
  })
}

/** Resolves only the identity captured before the product transaction; never substitutes on error. */
export async function effectiveReadPrincipal(
  ctx: HttpContext,
  trx: TransactionClientContract,
  requestedAccountId?: string
) {
  const actor = actorIn(trx)
  const context = capturedMasqueradeContext(ctx)
  if (!context || context.actorId !== actor.userId)
    throw new PackageMasqueradeError('E_MASQUERADE_CONTEXT_CHANGED')
  const accountId =
    requestedAccountId ??
    (typeof ctx.params.accountId === 'string' ? ctx.params.accountId : undefined)
  if (context.isMasquerading && accountId) {
    const actorRole = await activeCompanyRole(actor.userId, accountId, trx)
    const targetRole = await activeCompanyRole(context.effectiveId, accountId, trx)
    if (!actorRole || !can(actorRole, 'masquerade') || !targetRole)
      throw new IdentityAuthorityError('Masquerade company authority changed.')
  }
  return {
    actorId: actor.userId,
    effectiveId: context.effectiveId,
    accountId: context.isMasquerading ? (accountId ?? null) : null,
    isMasquerading: context.isMasquerading,
  }
}

export type { ModeView }
