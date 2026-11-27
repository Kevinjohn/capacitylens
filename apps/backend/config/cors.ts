import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/cors'
import { parseOrigins } from '@kevinjohn/adonisjs-origin-guard'

const defaultOrigins =
  'http://localhost:5173,http://localhost:5273,http://127.0.0.1:5173,http://127.0.0.1:5273'

/** Resolves the finite development defaults; production cross-origin access is explicit. */
export function resolveCorsOrigins(configured: string | undefined, environment: string) {
  return parseOrigins(configured ?? (environment === 'production' ? '' : defaultOrigins))
}

/** Appends the full-stack dev launcher's lane web origins, which only a development server trusts. */
export function appendDevelopmentWebOrigins(
  origins: string[],
  devWebOrigins: string | undefined,
  environment: string
) {
  return environment === 'development' && devWebOrigins
    ? [...origins, ...resolveCorsOrigins(devWebOrigins, environment)]
    : origins
}

const environment = app.inProduction ? 'production' : app.inDev ? 'development' : 'test'

export const corsOrigins = appendDevelopmentWebOrigins(
  resolveCorsOrigins(env.get('CAPACITYLENS_CORS_ORIGIN'), environment),
  env.get('CAPACITYLENS_DEV_WEB_ORIGINS'),
  environment
)

const corsConfig = defineConfig({
  enabled: true,

  /**
   * Use the configured origins (or the documented local development origins).
   * Production has no cross-origin defaults; configure the public frontend origin
   * with CAPACITYLENS_CORS_ORIGIN when deploying it separately.
   */
  origin: corsOrigins,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  headers: [
    'Content-Type',
    'Idempotency-Key',
    'x-account-operation-id',
    'x-capacitylens-sync-session',
    'x-capacitylens-sync-sequence',
  ],

  exposeHeaders: [],
  credentials: true,
  maxAge: 90,
})

export default corsConfig
