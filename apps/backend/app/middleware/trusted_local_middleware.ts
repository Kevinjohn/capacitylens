import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { resolveCurrentActor, SessionAuthorityError } from '#services/auth/session_authority'

export default class TrustedLocalMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const pathname = ctx.request.url().split('?')[0]
    const publicAdmission =
      (ctx.request.method() === 'GET' && /^\/api\/invites\/[^/]+\/preview$/.test(pathname)) ||
      (ctx.request.method() === 'POST' && /^\/api\/invites\/[^/]+\/signup$/.test(pathname)) ||
      (ctx.request.method() === 'GET' &&
        /^\/api\/accounts\/[^/]+\/join\/metadata$/.test(pathname)) ||
      (ctx.request.method() === 'GET' && pathname === '/api/company-join/status') ||
      (ctx.request.method() === 'POST' && pathname === '/api/company-join/cancel') ||
      (ctx.request.method() === 'POST' &&
        /^\/api\/accounts\/[^/]+\/join\/provider\/start$/.test(pathname)) ||
      (ctx.request.method() === 'GET' && pathname === '/api/masquerade')
    if (
      ctx.request.url().startsWith('/api/') &&
      !publicAdmission &&
      !['/api/auth/', '/api/health', '/api/meta'].some((path) => ctx.request.url().startsWith(path))
    ) {
      try {
        await resolveCurrentActor(ctx)
        if (ctx.request.url().startsWith('/api/test/reset'))
          return ctx.response.forbidden({
            error: 'Installation reset is unavailable with authentication enabled.',
          })
      } catch (error) {
        if (error instanceof SessionAuthorityError || (error as { status?: number }).status === 401)
          return ctx.response.unauthorized({ error: 'Sign-in required.' })
        throw error
      }
    }
    return next()
  }
}
