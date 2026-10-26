import { Env } from '@adonisjs/core/env'
const optional = Env.schema.string.optional()
const optionalBoolean = Env.schema.boolean.optional()
// Keep the caller's string contract while rejecting malformed supplied operator values.
function optionalInteger(maximum: number, minimum = 1): OptionalStringValidator {
  return (key, value) => {
    if (value === undefined || value === '') return undefined
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < minimum ||
      Number(value) > maximum
    )
      throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`)
    return value
  }
}

type StringValidator = ReturnType<typeof Env.schema.string>
type NumberValidator = ReturnType<typeof Env.schema.number>
type SecretValidator = ReturnType<typeof Env.schema.secret>
type OptionalStringValidator = ReturnType<typeof Env.schema.string.optional>
type OptionalBooleanValidator = ReturnType<typeof Env.schema.boolean.optional>
type EnumValidator<Value extends string> = ReturnType<typeof Env.schema.enum<Value>>

type OptionalStringKey =
  | 'CAPACITYLENS_SECRET'
  | 'CAPACITYLENS_ALLOWED_EMAIL_DOMAINS'
  | 'CAPACITYLENS_BACKUP_DIR'
  | 'CAPACITYLENS_BACKUP_KEEP'
  | 'CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD'
  | 'CAPACITYLENS_CORS_ORIGIN'
  | 'CAPACITYLENS_DB'
  | 'CAPACITYLENS_MAIL_FROM'
  | 'CAPACITYLENS_MAIL_HOST'
  | 'CAPACITYLENS_MAIL_PASSWORD'
  | 'CAPACITYLENS_MAIL_PORT'
  | 'CAPACITYLENS_MAIL_USER'
  | 'CAPACITYLENS_PUBLIC_URL'
  | 'CAPACITYLENS_RATE_LIMIT'
  | 'CAPACITYLENS_TEST_HTTP_PORT'

type OptionalBooleanKey =
  | 'CAPACITYLENS_ALLOW_OPEN_SIGNUP'
  | 'CAPACITYLENS_ALLOW_RESET'
  | 'CAPACITYLENS_CREATE_ADMIN_ADMIN'
  | 'CAPACITYLENS_TRUST_PROXY_HEADERS'

type CapacityLensEnvironmentSchema = {
  NODE_ENV: EnumValidator<'development' | 'production' | 'test'>
  PORT: NumberValidator
  HOST: StringValidator
  LOG_LEVEL: EnumValidator<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'>
  APP_KEY: SecretValidator
  APP_URL: StringValidator
  CAPACITYLENS_AUDIT: ReturnType<typeof Env.schema.enum.optional<'on' | 'off'>>
  CAPACITYLENS_LOG: ReturnType<typeof Env.schema.enum.optional<'0' | '1'>>
  SESSION_DRIVER: EnumValidator<'cookie' | 'memory' | 'database'>
} & { [Key in OptionalStringKey]: OptionalStringValidator } & {
  [Key in OptionalBooleanKey]: OptionalBooleanValidator
}

/** Validate operator values while leaving compound policies to their owning configuration. */
export const envSchema: CapacityLensEnvironmentSchema = {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum([
    'trace',
    'debug',
    'info',
    'warn',
    'error',
    'fatal',
    'silent',
  ] as const),
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),
  CAPACITYLENS_SECRET: optional,
  CAPACITYLENS_AUDIT: Env.schema.enum.optional(['on', 'off'] as const),
  CAPACITYLENS_ALLOW_OPEN_SIGNUP: optionalBoolean,
  CAPACITYLENS_ALLOW_RESET: optionalBoolean,
  // Admission owns domain-list policy; CORS owns its explicit origin-list validation.
  CAPACITYLENS_ALLOWED_EMAIL_DOMAINS: optional,
  CAPACITYLENS_BACKUP_DIR: optional,
  // Retention deliberately accepts raw text for the backup parser’s warning/default/clamp behavior.
  CAPACITYLENS_BACKUP_KEEP: optional,
  CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: optional,
  CAPACITYLENS_CORS_ORIGIN: optional,
  CAPACITYLENS_CREATE_ADMIN_ADMIN: optionalBoolean,
  CAPACITYLENS_DB: optional,
  CAPACITYLENS_LOG: Env.schema.enum.optional(['0', '1'] as const),
  CAPACITYLENS_MAIL_FROM: Env.schema.string.optional({ format: 'email' }),
  CAPACITYLENS_MAIL_HOST: Env.schema.string.optional({ format: 'host' }),
  CAPACITYLENS_MAIL_PASSWORD: optional,
  CAPACITYLENS_MAIL_PORT: optionalInteger(65535),
  CAPACITYLENS_MAIL_USER: optional,
  CAPACITYLENS_PUBLIC_URL: optional,
  CAPACITYLENS_RATE_LIMIT: optionalInteger(1_000_000, 0),
  CAPACITYLENS_TEST_HTTP_PORT: optionalInteger(65535),
  CAPACITYLENS_TRUST_PROXY_HEADERS: optionalBoolean,
}

type CapacityLensEnvironment = Awaited<ReturnType<typeof Env.create<typeof envSchema>>>

const env: CapacityLensEnvironment = await Env.create(new URL('../', import.meta.url), envSchema)

export default env
