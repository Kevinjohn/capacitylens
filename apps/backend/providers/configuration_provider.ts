import type { ApplicationService } from '@adonisjs/core/types'
import env from '#start/env'
import db from '@adonisjs/lucid/services/db'
import { assertReleasedMigrations } from '#services/released_migrations'
import { assertSchemaIntegrity } from '#services/schema_integrity'
import { authMode, googleEnabled, passwordEnabled } from '#services/auth/mode'
import { hashPassword } from '#services/password_service'
import { passwordLengthFailure } from '@capacitylens/shared/domain/password'

export function assertM1AuthenticationMode(mode: string | undefined) {
  if (!['off', 'password-only', 'password-and-sso', 'sso-only'].includes(mode || 'off'))
    throw new Error(`Unknown CAPACITYLENS_MODE ${mode}`)
}

function assertAuthenticationConfiguration(inProduction: boolean) {
  if (authMode() === 'off') return
  const secret = env.get('CAPACITYLENS_SECRET')
  if (!secret || secret.length < 32)
    throw new Error(
      'CAPACITYLENS_SECRET must contain at least 32 characters when authentication is enabled'
    )
  const publicUrl = env.get('CAPACITYLENS_PUBLIC_URL')
  if (!publicUrl)
    throw new Error('CAPACITYLENS_PUBLIC_URL is required when authentication is enabled')
  let url: URL
  try {
    url = new URL(publicUrl)
  } catch {
    throw new Error('CAPACITYLENS_PUBLIC_URL must be a bare HTTP(S) origin')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.origin !== publicUrl ||
    url.username ||
    url.password
  )
    throw new Error('CAPACITYLENS_PUBLIC_URL must be a bare HTTP(S) origin')
  if (
    inProduction &&
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error('CAPACITYLENS_PUBLIC_URL must use HTTPS outside loopback in production')
  const setupToken = env.get('CAPACITYLENS_SETUP_TOKEN')
  if (setupToken && setupToken.length < 32)
    throw new Error('CAPACITYLENS_SETUP_TOKEN must contain at least 32 characters')
  assertGoogleProviderConfiguration({
    mode: authMode(),
    clientId: env.get('CAPACITYLENS_GOOGLE_CLIENT_ID'),
    clientSecret: env.get('CAPACITYLENS_GOOGLE_CLIENT_SECRET'),
  })
  if (authMode() === 'sso-only' && !googleEnabled())
    throw new Error('SSO-only mode requires a configured Google provider')
  if (env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN') && !passwordEnabled())
    throw new Error('CAPACITYLENS_CREATE_ADMIN_ADMIN requires password authentication')
}

/** Refuses a half-configured provider before the application accepts traffic. */
export function assertGoogleProviderConfiguration(options: {
  mode: string
  clientId?: string
  clientSecret?: string
}) {
  if (
    (options.mode === 'password-and-sso' || options.mode === 'sso-only') &&
    Boolean(options.clientId) !== Boolean(options.clientSecret)
  )
    throw new Error('Google provider requires both client ID and secret')
}

interface HostedProfileOptions {
  profile?: string
  mode?: string
  allowOpenSignup?: boolean
  setupToken?: string
  createAdmin?: boolean
  googleClientId?: string
  googleClientSecret?: string
  microsoftClientId?: string
  microsoftClientSecret?: string
  microsoftTenantId?: string
}

export function assertHostedDeploymentProfile(options: HostedProfileOptions) {
  if (options.profile !== 'hosted-sso-only') return
  if (options.mode !== 'sso-only') throw new Error('hosted-sso-only requires sso-only mode')
  if (options.allowOpenSignup) throw new Error('hosted-sso-only forbids open signup')
  if (options.setupToken || options.createAdmin)
    throw new Error('hosted-sso-only forbids password-account configuration')
  const google = options.googleClientId && options.googleClientSecret
  if (!google) throw new Error('hosted-sso-only requires a complete Google provider')
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
    assertHostedDeploymentProfile({
      profile: env.get('CAPACITYLENS_DEPLOYMENT_PROFILE'),
      mode: env.get('CAPACITYLENS_MODE'),
      allowOpenSignup: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
      setupToken: env.get('CAPACITYLENS_SETUP_TOKEN'),
      createAdmin: env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN'),
      googleClientId: env.get('CAPACITYLENS_GOOGLE_CLIENT_ID'),
      googleClientSecret: env.get('CAPACITYLENS_GOOGLE_CLIENT_SECRET'),
      microsoftClientId: env.get('CAPACITYLENS_MICROSOFT_CLIENT_ID'),
      microsoftClientSecret: env.get('CAPACITYLENS_MICROSOFT_CLIENT_SECRET'),
      microsoftTenantId: env.get('CAPACITYLENS_MICROSOFT_TENANT_ID'),
    })
    assertAuthenticationConfiguration(this.app.inProduction)
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
  }

  async start() {
    // Code generation warms a web app without serving requests or closing database pools.
    if (this.app.getMode() === 'warmup') return
    const environment = this.app.getEnvironment()
    const migrations = await assertReleasedMigrations({ allowPending: environment !== 'web' })
    const command =
      environment === 'console'
        ? process.argv.slice(2).find((argument) => !argument.startsWith('-'))
        : undefined
    if (command === 'app:upgrade' || command === 'db:backup' || command?.startsWith('migration:'))
      return
    const rows = await db
      .from('sqlite_master')
      .where({ type: 'table', name: 'accounts' })
      .select('name')
    if (migrations.pending === 0 || rows.length > 0) {
      await assertSchemaIntegrity()
      await this.bootstrapCredential()
    }
  }

  private async bootstrapCredential() {
    if (!env.get('CAPACITYLENS_CREATE_ADMIN_ADMIN')) return
    const password = env.get('CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD')
    if (!password || passwordLengthFailure(password))
      throw new Error(
        'CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD must satisfy the password length policy'
      )
    if (await db.from('users').select('id').first()) return
    const hash = await hashPassword(password)
    const now = new Date().toISOString()
    const trx = await db.transaction()
    try {
      if (!(await trx.from('users').select('id').first()))
        await trx.table('users').insert({
          id: crypto.randomUUID(),
          email: 'admin@admin.admin',
          email_verified: 0,
          display_name: 'admin',
          password_hash: hash,
          created_at: now,
          updated_at: now,
        })
      await trx.commit()
    } catch (error) {
      await trx.rollback()
      throw error
    }
  }
}
