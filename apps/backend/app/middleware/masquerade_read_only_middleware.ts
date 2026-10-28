import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { MasqueradeError } from 'adonisjs-masquerade'
import { signedInSession } from '#services/auth/current_actor'
import { masqueradeService } from '#services/auth/masquerade'
import { captureMasqueradeContext } from '#services/auth/masquerade_request'

function sendContextError(
  ctx: HttpContext,
  code: 'MASQUERADE_CONTEXT_REQUIRED' | 'MASQUERADE_CONTEXT_CHANGED'
) {
  const required = code === 'MASQUERADE_CONTEXT_REQUIRED'
  return ctx.response.status(required ? 428 : 409).send({
    error: required ? 'Masquerade context is required.' : 'Masquerade context changed.',
    code,
  })
}

/** Captures one package admission and enforces context/read-only policy before route parsing. */
export default class MasqueradeReadOnlyMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const path = ctx.request.url().split('?', 1)[0]
    if (!path?.startsWith('/api/')) return next()
    const method = ctx.request.method().toUpperCase()
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(method)
    const isStatus = (method === 'GET' || method === 'HEAD') && path === '/api/masquerade'
    const isEnd = method === 'DELETE' && path === '/api/masquerade'
    if (isStatus || isEnd || (method === 'POST' && path === '/api/auth/sign-out')) return next()
    const signIn = await signedInSession(ctx)
    if (!signIn) return next()
    const service = await masqueradeService()
    let mode
    try {
      mode = await service.resolve(ctx)
    } catch (error) {
      if (error instanceof MasqueradeError) {
        if (error.code === 'E_MASQUERADE_CONTEXT_CHANGED')
          return sendContextError(ctx, 'MASQUERADE_CONTEXT_CHANGED')
        if (error.code === 'E_MASQUERADE_NOT_ALLOWED')
          return ctx.response.forbidden({ error: error.message, code: 'AUTHORIZATION_DENIED' })
      }
      throw error
    }
    captureMasqueradeContext(ctx, mode)

    const contextToken = ctx.request.header('X-Masquerade-Context')
    if (unsafe && (typeof contextToken !== 'string' || !contextToken))
      return sendContextError(ctx, 'MASQUERADE_CONTEXT_REQUIRED')
    if (typeof contextToken === 'string' && contextToken !== mode.contextToken)
      return sendContextError(ctx, 'MASQUERADE_CONTEXT_CHANGED')
    // Start re-checks the token in its package operation; this early check also prevents
    // malformed bodies and route discovery from bypassing stale-context handling.
    if (unsafe && !mode.contextToken) return sendContextError(ctx, 'MASQUERADE_CONTEXT_CHANGED')
    // Status, End and sign-out returned above, so every remaining unsafe request is a product write.
    if (
      mode.isMasquerading &&
      (unsafe ||
        path.startsWith('/api/auth/') ||
        (/^\/api\/(?:accounts|orgs|members|invitations|invites|identity|joining|company-join|admission|diagnostics)(?:\/|$)/.test(
          path
        ) &&
          !(
            method === 'GET' &&
            /^\/api\/accounts\/[^/]+\/planning(?:\/mutations\/[^/]+)?$/.test(path)
          )))
    )
      return ctx.response.forbidden({
        error: 'Masquerade is read-only.',
        code: 'MASQUERADE_READ_ONLY',
      })
    return next()
  }
}
