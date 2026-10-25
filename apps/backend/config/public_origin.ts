import app from '@adonisjs/core/services/app'
import env from '#start/env'

/** Resolve the one origin shared by action links and browser transport security. */
export function resolvePublicOrigin(
  value: string,
  environment: 'production' | 'development' | 'test'
) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Public URL must be a bare HTTP(S) origin')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== value ||
    url.username ||
    url.password
  )
    throw new Error('Public URL must be a bare HTTP(S) origin')
  if (
    url.protocol !== 'https:' &&
    (environment === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
  )
    throw new Error(
      environment === 'production'
        ? 'Public URL: public production origins require HTTPS'
        : 'Public URL must use HTTPS outside loopback in development/test'
    )
  return { origin: url.origin, secure: url.protocol === 'https:' }
}

export const publicOrigin = resolvePublicOrigin(
  env.get('CAPACITYLENS_PUBLIC_URL') || env.get('APP_URL'),
  app.inProduction ? 'production' : app.inTest ? 'test' : 'development'
)
