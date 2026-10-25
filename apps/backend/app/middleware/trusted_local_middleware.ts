import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { InvalidSessionError } from 'adonisjs-account-kit/errors'
import { currentAccount } from '#services/auth/current_actor'

export default class TrustedLocalMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const pathname = ctx.request.url().split('?')[0]
    const publicAdmission =
      (ctx.request.method() === 'GET' && /^\/api\/invites\/[^/]+\/preview$/.test(pathname)) ||
      (ctx.request.method() === 'POST' && /^\/api\/invites\/[^/]+\/signup$/.test(pathname)) ||
      (ctx.request.method() === 'GET' && pathname === '/api/masquerade')
    if (
      ctx.request.url().startsWith('/api/') &&
      !publicAdmission &&
      !['/api/auth/', '/api/health', '/api/meta'].some((path) => ctx.request.url().startsWith(path))
    ) {
      try {
        await currentAccount(ctx)
        if (ctx.request.url().startsWith('/api/test/reset'))
          return ctx.response.forbidden({
            error: 'Installation reset is unavailable with authentication enabled.',
          })
      } catch (error) {
        if (error instanceof InvalidSessionError)
          return ctx.response.unauthorized({ error: 'Sign-in required.' })
        throw error
      }
    }
    return next()
  }
}
