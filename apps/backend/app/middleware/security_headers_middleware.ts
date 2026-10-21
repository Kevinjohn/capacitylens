import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import env from '#start/env'
import { isTrustedUnsafeOrigin } from '#services/cors_policy'
export default class SecurityHeadersMiddleware {
  async handle({ request, response }: HttpContext, next: NextFn) {
    response.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'none'; form-action 'self'"
    )
    response.header('Cross-Origin-Opener-Policy', 'same-origin')
    response.header('Cross-Origin-Resource-Policy', 'same-origin')
    response.header('Referrer-Policy', 'no-referrer')
    response.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    response.header('Access-Control-Expose-Headers', 'x-capacitylens-audit-warning')
    response.header('Cache-Control', 'no-store')
    response.header('Pragma', 'no-cache')
    const unsafe = !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    if (
      unsafe &&
      !isTrustedUnsafeOrigin({
        origin: request.header('origin'),
        fetchSite: request.header('sec-fetch-site'),
        host: request.header('host'),
        protocol: request.protocol(),
        forwardedProtocol: request.header('x-forwarded-proto')?.split(',')[0]?.trim(),
        trustProxy: env.get('CAPACITYLENS_TRUST_PROXY_HEADERS') === true,
      })
    )
      return response.forbidden({ error: 'Cross-site request rejected.' })
    await next()
    const body = response.getBody()
    if (
      request.url().startsWith('/api/') &&
      typeof body === 'object' &&
      body !== null &&
      !Buffer.isBuffer(body)
    ) {
      response.type('application/json')
    }
  }
}
