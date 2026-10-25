import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { activeMasquerade } from '#services/auth/masquerade'
import { signedInSession } from '#services/auth/current_actor'

function blockedRead(path: string) {
  // The company planning snapshot is a projected data read, like the retained state route.
  if (/^\/api\/accounts\/[^/]+\/planning$/.test(path)) return false
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
    if (!path?.startsWith('/api/') && !unsafe) return next()
    const signIn = await signedInSession(ctx)
    const record = signIn ? await activeMasquerade(signIn.sessionId) : null
    if (!signIn || !record) return next()
    if (ctx.request.method() === 'GET' && path === '/api/masquerade') return next()
    if (record.actorId !== signIn.userId)
      return ctx.response.unauthorized({ error: 'Sign-in required.' })
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
