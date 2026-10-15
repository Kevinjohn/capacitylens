import type { HttpContext } from '@adonisjs/core/http'
import { authMode } from '#services/auth/mode'
import { withTransaction } from '#services/with_transaction'
import { resolveCurrentActor, SessionAuthorityError } from '#services/auth/session_authority'
import {
  currentMasquerade,
  endMasquerade,
  MasqueradeError,
  startMasquerade,
} from '#services/auth/masquerade'

async function respond<T>(ctx: HttpContext, work: () => Promise<T>) {
  try {
    return await work()
  } catch (error) {
    if (error instanceof MasqueradeError)
      return ctx.response.status(error.status).send({ error: error.message, code: error.code })
    throw error
  }
}

export default class MasqueradeController {
  async start(ctx: HttpContext) {
    if (authMode() === 'off') return ctx.response.forbidden({ error: 'Forbidden.' })
    const accountId = ctx.params.accountId
    const body: unknown = ctx.request.body()
    if (
      typeof accountId !== 'string' ||
      !accountId ||
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      !('targetUserId' in body) ||
      typeof body.targetUserId !== 'string' ||
      !body.targetUserId
    )
      return ctx.response.badRequest({ error: 'Target member is required.' })
    return respond(ctx, async () =>
      ctx.response.ok(
        await withTransaction((trx) =>
          startMasquerade(ctx, accountId, body.targetUserId as string, trx)
        )
      )
    )
  }

  async status(ctx: HttpContext) {
    if (authMode() === 'off') return ctx.response.ok({ active: false })
    return respond(ctx, async () => {
      try {
        // The web guard loads its user through the default connection; authenticate before
        // taking the single SQLite transaction connection used for the projection snapshot.
        await resolveCurrentActor(ctx)
        return ctx.response.ok(await withTransaction((trx) => currentMasquerade(ctx, trx)))
      } catch (error) {
        if (error instanceof SessionAuthorityError || (error as { status?: number }).status === 401)
          return ctx.response.ok({ active: false })
        throw error
      }
    })
  }

  async end(ctx: HttpContext) {
    if (authMode() === 'off') return ctx.response.forbidden({ error: 'Forbidden.' })
    const body: unknown = ctx.request.body()
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 2 ||
      !('token' in body) ||
      typeof body.token !== 'string' ||
      !body.token ||
      !('reason' in body) ||
      (body.reason !== 'explicit' && body.reason !== 'account_switch')
    )
      return ctx.response.badRequest({ error: 'Invalid masquerade end request.' })
    return respond(ctx, async () => {
      await withTransaction((trx) =>
        endMasquerade(ctx, body.token as string, body.reason as 'explicit' | 'account_switch', trx)
      )
      return ctx.response.noContent()
    })
  }
}
