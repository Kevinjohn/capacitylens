import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { AccountAdmission } from 'adonisjs-account-kit/admission'
import { accountInput, currentAccount, withActor } from '#services/auth/current_actor'
import { completeMembership } from '#services/membership/admission_membership'

const admission = () => app.container.make(AccountAdmission)
const statuses = ['pending', 'approved', 'rejected', 'revoked'] as const

function userIdParam(value: unknown) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null
}

/**
 * The caller's own admission status and request, reachable before admission, and the Owner and
 * Admin decisions. The Account Kit authorises every decision; it sends no notification.
 */
export default class AdmissionController {
  async show(ctx: HttpContext) {
    const service = await admission()
    const { decision } = await service.current(await accountInput(ctx))
    return ctx.response.ok({ decision })
  }

  async request(ctx: HttpContext) {
    const service = await admission()
    const record = await service.request(await accountInput(ctx))
    return ctx.response.ok({ requestedAt: record.requestedAt })
  }

  async index(ctx: HttpContext) {
    const status = ctx.request.input('status')
    const cursor = ctx.request.input('cursor')
    if (
      (status !== undefined && !statuses.includes(status)) ||
      (cursor !== undefined && (typeof cursor !== 'string' || cursor.length > 512))
    )
      return ctx.response.badRequest({ error: 'Invalid admission list request.' })
    const actor = await currentAccount(ctx)
    const service = await admission()
    const page = await service.list({ actorId: actor.id, status, cursor, limit: 100 })
    return ctx.response.ok(page)
  }

  async approve(ctx: HttpContext) {
    return this.decide(ctx, 'approve')
  }

  async reject(ctx: HttpContext) {
    return this.decide(ctx, 'reject')
  }

  async revoke(ctx: HttpContext) {
    return this.decide(ctx, 'revoke')
  }

  /** Creates the admitted caller's missing membership; never reactivates or changes one. */
  async complete(ctx: HttpContext) {
    const result = await withActor(ctx, (actor, trx) => completeMembership(actor.userId, trx))
    return ctx.response.ok(result)
  }

  private async decide(ctx: HttpContext, decision: 'approve' | 'reject' | 'revoke') {
    const userId = userIdParam(ctx.params.userId)
    if (!userId) return ctx.response.badRequest({ error: 'Invalid admission request.' })
    const actor = await currentAccount(ctx)
    const service = await admission()
    const record = await service[decision]({ actorId: actor.id, userId })
    return ctx.response.ok({ userId: String(record.userId), approval: record.approval })
  }
}
