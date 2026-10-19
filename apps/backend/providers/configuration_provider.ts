import type { ApplicationService } from '@adonisjs/core/types'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { assertSchemaIntegrity } from '#services/schema_integrity'

export function assertM1AuthenticationMode(mode: string | undefined) {
  if (mode !== undefined && mode !== 'off')
    throw new Error(`Authentication mode ${mode} is not available in the M1 backend`)
}

interface ProductionPosture {
  mode?: string
  allowOpen?: boolean
  allowReset?: boolean
  createAdmin?: boolean
  bootstrapPassword?: string
  rateLimit?: string
  audit?: string
}

export function assertProductionPosture(options: ProductionPosture) {
  if ((options.mode === undefined || options.mode === 'off') && options.allowOpen !== true)
    throw new Error(
      'CAPACITYLENS_MODE=off in production requires CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION=1'
    )
  if (options.createAdmin || options.bootstrapPassword)
    throw new Error('Development bootstrap credentials are forbidden in production')
  if (
    options.rateLimit !== undefined &&
    (!/^\d+$/.test(options.rateLimit) ||
      Number(options.rateLimit) < 1 ||
      Number(options.rateLimit) > 1_000_000)
  )
    throw new Error('CAPACITYLENS_RATE_LIMIT must be an integer from 1 to 1,000,000 in production')
  if (options.audit === 'off')
    throw new Error('CAPACITYLENS_AUDIT=off is not permitted in production')
  if (options.allowReset) throw new Error('CAPACITYLENS_ALLOW_RESET is forbidden in production')
}
export default class ConfigurationProvider {
  constructor(protected app: ApplicationService) {}
  async boot() {
    assertM1AuthenticationMode(env.get('CAPACITYLENS_MODE'))
    if (this.app.inProduction)
      assertProductionPosture({
        mode: env.get('CAPACITYLENS_MODE'),
        allowOpen: env.get('CAPACITYLENS_ALLOW_OPEN_IN_PRODUCTION'),
        allowReset: env.get('CAPACITYLENS_ALLOW_RESET'),
        createAdmin: env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN'),
        bootstrapPassword: env.get('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD'),
        rateLimit: env.get('CAPACITYLENS_RATE_LIMIT'),
        audit: env.get('CAPACITYLENS_AUDIT'),
      })
    if (env.get('CAPACITYLENS_DEPLOYMENT_PROFILE') === 'hosted-sso-only') {
      if (env.get('CAPACITYLENS_MODE') !== 'sso-only')
        throw new Error('hosted-sso-only requires sso-only mode')
      if (env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'))
        throw new Error('hosted-sso-only forbids open signup')
      if (env.get('CAPACITYLENS_SETUP_TOKEN') || env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN'))
        throw new Error('hosted-sso-only forbids password-account configuration')
      const google =
        env.get('CAPACITYLENS_GOOGLE_CLIENT_ID') && env.get('CAPACITYLENS_GOOGLE_CLIENT_SECRET')
      const microsoft =
        env.get('CAPACITYLENS_MICROSOFT_CLIENT_ID') &&
        env.get('CAPACITYLENS_MICROSOFT_CLIENT_SECRET') &&
        env.get('CAPACITYLENS_MICROSOFT_TENANT_ID')
      if (!google && !microsoft)
        throw new Error('hosted-sso-only requires a complete named provider')
    }
  }

  async ready() {
    const rows = await db
      .from('sqlite_master')
      .where({ type: 'table', name: 'accounts' })
      .select('name')
    if (rows.length > 0) await assertSchemaIntegrity()
  }
}
