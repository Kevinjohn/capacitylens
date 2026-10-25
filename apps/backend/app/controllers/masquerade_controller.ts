import type { HttpContext } from '@adonisjs/core/http'
import { InvalidSessionError } from 'adonisjs-account-kit/errors'
import { withActor } from '#services/auth/current_actor'
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
        await withActor(ctx, (_actor, trx) =>
          startMasquerade(accountId, body.targetUserId as string, trx)
        )
      )
    )
  }

  async status(ctx: HttpContext) {
    return respond(ctx, async () => {
      try {
        return ctx.response.ok(
          await withActor(ctx, (_actor, trx) => currentMasquerade(trx), { limited: true })
        )
      } catch (error) {
        if (error instanceof InvalidSessionError) return ctx.response.ok({ active: false })
        throw error
      }
    })
  }

  async end(ctx: HttpContext) {
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
      await withActor(ctx, (_actor, trx) =>
        endMasquerade(body.token as string, body.reason as 'explicit' | 'account_switch', trx)
      )
      return ctx.response.noContent()
    })
  }
}
