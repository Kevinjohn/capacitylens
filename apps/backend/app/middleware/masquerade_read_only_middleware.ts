import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { authMode } from '#services/auth/mode'
import { activeMasquerade } from '#services/auth/masquerade'
import { resolveCurrentActor, SessionAuthorityError } from '#services/auth/session_authority'

function blockedRead(path: string) {
  return [
    '/api/auth',
    '/api/accounts',
    '/api/orgs',
    '/api/members',
    '/api/invitations',
    '/api/invites',
    '/api/identity',
    '/api/joining',
    '/api/company-join',
  ].some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}

/** Refuses active projections before JSON or route validation, including unknown writes. */
export default class MasqueradeReadOnlyMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const path = ctx.request.url().split('?', 1)[0]
    const method = ctx.request.method()
    const unsafe = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS'
    if (authMode() === 'off' || (!path?.startsWith('/api/') && !unsafe)) return next()
    const record = await activeMasquerade(ctx.session.sessionId)
    if (!record) return next()
    if (ctx.request.method() === 'GET' && path === '/api/masquerade') return next()
    try {
      const actor = await resolveCurrentActor(ctx)
      if (record.actorId !== actor.userId)
        throw new SessionAuthorityError('Masquerade session changed.')
    } catch (error) {
      if (error instanceof SessionAuthorityError || (error as { status?: number }).status === 401)
        return ctx.response.unauthorized({ error: 'Sign-in required.' })
      throw error
    }
    if (
      (method === 'DELETE' && path === '/api/masquerade') ||
      (method === 'POST' && path === '/api/auth/sign-out')
    )
      return next()
    if (unsafe)
      return ctx.response.forbidden({
        error: 'Masquerade is read-only.',
        code: 'MASQUERADE_READ_ONLY',
      })
    if (blockedRead(path))
      return ctx.response.forbidden({
        error: 'Masquerade is read-only.',
        code: 'MASQUERADE_READ_ONLY',
      })
    return next()
  }
}
