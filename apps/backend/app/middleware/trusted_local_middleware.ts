import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { authMode } from '#services/auth/mode'
import { resolveCurrentActor, SessionAuthorityError } from '#services/auth/session_authority'

export default class TrustedLocalMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    if (authMode() === 'off') await ctx.auth.authenticate()
    else if (
      ctx.request.url().startsWith('/api/') &&
      ![
        '/api/auth/',
        '/api/health',
        '/api/meta',
        '/api/diagnostics',
        '/api/security/csp-report',
      ].some((path) => ctx.request.url().startsWith(path))
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
