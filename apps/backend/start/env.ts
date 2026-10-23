import { Env } from '@adonisjs/core/env'
const optional = Env.schema.string.optional()
const optionalBoolean = Env.schema.boolean.optional()
type StringValidator = ReturnType<typeof Env.schema.string>
type NumberValidator = ReturnType<typeof Env.schema.number>
type SecretValidator = ReturnType<typeof Env.schema.secret>
type OptionalStringValidator = ReturnType<typeof Env.schema.string.optional>
type OptionalBooleanValidator = ReturnType<typeof Env.schema.boolean.optional>
type EnumValidator<Value extends string> = ReturnType<typeof Env.schema.enum<Value>>

type OptionalStringKey =
  | 'CAPACITYLENS_API'
  | 'CAPACITYLENS_APPLICATION_ID'
  | 'CAPACITYLENS_AUDIT'
  | 'CAPACITYLENS_AUDIT_FILE'
  | 'CAPACITYLENS_AUDIT_MAX_MB'
  | 'CAPACITYLENS_BACKUP_DIR'
  | 'CAPACITYLENS_BACKUP_KEEP'
  | 'CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD'
  | 'CAPACITYLENS_BOOTSTRAP_TOKEN'
  | 'CAPACITYLENS_CORS_ORIGIN'
  | 'CAPACITYLENS_DB'
  | 'CAPACITYLENS_HOST'
  | 'CAPACITYLENS_LOG'
  | 'CAPACITYLENS_MAIL_FROM'
  | 'CAPACITYLENS_MAIL_HOST'
  | 'CAPACITYLENS_MAIL_PASSWORD'
  | 'CAPACITYLENS_MAIL_PORT'
  | 'CAPACITYLENS_MAIL_USER'
  | 'CAPACITYLENS_MODE'
  | 'CAPACITYLENS_PUBLIC_URL'
  | 'CAPACITYLENS_RATE_LIMIT'
  | 'CAPACITYLENS_RATE_LIMITED'
  | 'CAPACITYLENS_SECRET'
  | 'CAPACITYLENS_SETUP_TOKEN'
  | 'CAPACITYLENS_TEST_HTTP_PORT'
  | 'CAPACITYLENS_WEB_DIR'

type OptionalBooleanKey =
  | 'CAPACITYLENS_ALLOW_OPEN_SIGNUP'
  | 'CAPACITYLENS_ALLOW_RESET'
  | 'CAPACITYLENS_AUDIT_STDOUT'
  | 'CAPACITYLENS_CREATE_ADMIN_ADMIN'
  | 'CAPACITYLENS_DEMO'
  | 'CAPACITYLENS_HEALTH_DEEP'
  | 'CAPACITYLENS_MIGRATION_READY'
  | 'CAPACITYLENS_PASSWORD_BREACH_CHECK'
  | 'CAPACITYLENS_REQUIRE_MFA'
  | 'CAPACITYLENS_SEED_DEMO'
  | 'CAPACITYLENS_TRUST_PROXY_HEADERS'

type CapacityLensEnvironmentSchema = {
  NODE_ENV: EnumValidator<'development' | 'production' | 'test'>
  PORT: NumberValidator
  HOST: StringValidator
  LOG_LEVEL: StringValidator
  APP_KEY: SecretValidator
  APP_URL: StringValidator
  SESSION_DRIVER: EnumValidator<'cookie' | 'memory' | 'database'>
} & { [Key in OptionalStringKey]: OptionalStringValidator } & {
  [Key in OptionalBooleanKey]: OptionalBooleanValidator
}

const envSchema: CapacityLensEnvironmentSchema = {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: optionalBoolean,
  CAPACITYLENS_ALLOW_RESET: optionalBoolean,
  CAPACITYLENS_API: optional,
  CAPACITYLENS_APPLICATION_ID: optional,
  CAPACITYLENS_AUDIT: optional,
  CAPACITYLENS_AUDIT_FILE: optional,
  CAPACITYLENS_AUDIT_MAX_MB: optional,
  CAPACITYLENS_AUDIT_STDOUT: optionalBoolean,
  CAPACITYLENS_BACKUP_DIR: optional,
  CAPACITYLENS_BACKUP_KEEP: optional,
  CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: optional,
  CAPACITYLENS_BOOTSTRAP_TOKEN: optional,
  CAPACITYLENS_CORS_ORIGIN: optional,
  CAPACITYLENS_CREATE_ADMIN_ADMIN: optionalBoolean,
  CAPACITYLENS_DB: optional,
  CAPACITYLENS_DEMO: optionalBoolean,
  CAPACITYLENS_HEALTH_DEEP: optionalBoolean,
  CAPACITYLENS_HOST: optional,
  CAPACITYLENS_LOG: optional,
  CAPACITYLENS_MAIL_FROM: optional,
  CAPACITYLENS_MAIL_HOST: optional,
  CAPACITYLENS_MAIL_PASSWORD: optional,
  CAPACITYLENS_MAIL_PORT: optional,
  CAPACITYLENS_MAIL_USER: optional,
  CAPACITYLENS_MIGRATION_READY: optionalBoolean,
  CAPACITYLENS_PASSWORD_BREACH_CHECK: optionalBoolean,
  // Ignored since provider sign-in was removed; still set by test harnesses and deploy presets.
  CAPACITYLENS_MODE: optional,
  CAPACITYLENS_PUBLIC_URL: optional,
  CAPACITYLENS_RATE_LIMIT: optional,
  CAPACITYLENS_RATE_LIMITED: optional,
  CAPACITYLENS_REQUIRE_MFA: optionalBoolean,
  CAPACITYLENS_SECRET: optional,
  CAPACITYLENS_SEED_DEMO: optionalBoolean,
  CAPACITYLENS_SETUP_TOKEN: optional,
  CAPACITYLENS_TEST_HTTP_PORT: optional,
  CAPACITYLENS_TRUST_PROXY_HEADERS: optionalBoolean,
  CAPACITYLENS_WEB_DIR: optional,
}

type CapacityLensEnvironment = Awaited<ReturnType<typeof Env.create<typeof envSchema>>>

const env: CapacityLensEnvironment = await Env.create(new URL('../', import.meta.url), envSchema)

export default env
