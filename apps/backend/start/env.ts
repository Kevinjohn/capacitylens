import { Env } from '@adonisjs/core/env';
import { isValidISODate } from '@capacitylens/shared/lib/isoDates';
const optional = Env.schema.string.optional();
const optionalBoolean = Env.schema.boolean.optional();
// Keep the caller's string contract while rejecting malformed supplied operator values.
function createOptionalIntegerValidator(maximum: number, minimum = 1): OptionalStringValidator {
  return (key, value) => {
    if (value === undefined || value === '') return undefined;
    if (
      !/^\d+$/.test(value) ||
      !Number.isSafeInteger(Number(value)) ||
      Number(value) < minimum ||
      Number(value) > maximum
    ) {
      throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
    }
    return value;
  };
}

/** An optional calendar date, checked when the server starts rather than on the first read. */
const parseOptionalISODate: OptionalStringValidator = (key, value) => {
  if (value === undefined || value === '') return undefined;
  if (!isValidISODate(value)) throw new Error(`${key} must be a calendar date (YYYY-MM-DD)`);
  return value;
};

type StringValidator = ReturnType<typeof Env.schema.string>;
type NumberValidator = ReturnType<typeof Env.schema.number>;
type SecretValidator = ReturnType<typeof Env.schema.secret>;
type OptionalStringValidator = ReturnType<typeof Env.schema.string.optional>;
type OptionalBooleanValidator = ReturnType<typeof Env.schema.boolean.optional>;
type OptionalSecretValidator = ReturnType<typeof Env.schema.secret.optional>;
type EnumValidator<Value extends string> = ReturnType<typeof Env.schema.enum<Value>>;
type ProxyTrustValidator = (key: string, value?: string) => 'off' | 'loopback' | 'private';

/**
 * True keeps loopback-only trust and `private` also trusts private-network peers. Unset is `off`
 * rather than undefined, because `env.get` would fall back to the raw text for undefined.
 */
const parseProxyTrust: ProxyTrustValidator = (key, value) => {
  if (value === undefined || value === '' || value === 'false' || value === '0') return 'off';
  if (value === 'true' || value === '1') return 'loopback';
  if (value === 'private') return 'private';
  throw new Error(`${key} must be true, false, 1, 0 or private`);
};

type OptionalStringKey =
  | 'APP_NAME'
  | 'CAPACITYLENS_ALLOWED_EMAIL_DOMAINS'
  | 'CAPACITYLENS_BACKUP_DIR'
  | 'CAPACITYLENS_BACKUP_KEEP'
  | 'CAPACITYLENS_CORS_ORIGIN'
  | 'CAPACITYLENS_DB'
  | 'CAPACITYLENS_DEV_WEB_ORIGINS'
  | 'CAPACITYLENS_FIXED_TODAY'
  | 'CAPACITYLENS_MAIL_FROM'
  | 'CAPACITYLENS_MAIL_HOST'
  | 'CAPACITYLENS_MAIL_PORT'
  | 'CAPACITYLENS_MAIL_USER'
  | 'CAPACITYLENS_PUBLIC_URL'
  | 'CAPACITYLENS_RATE_LIMIT'
  | 'CAPACITYLENS_TEST_HTTP_PORT';

type OptionalBooleanKey =
  | 'CAPACITYLENS_ALLOW_OPEN_SIGN_UP'
  | 'CAPACITYLENS_ALLOW_RESET'
  | 'CAPACITYLENS_CREATE_ADMIN_ADMIN';

type CapacityLensEnvironmentSchema = {
  NODE_ENV: EnumValidator<'development' | 'production' | 'test'>;
  PORT: NumberValidator;
  HOST: StringValidator;
  LOG_LEVEL: EnumValidator<'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'>;
  APP_KEY: SecretValidator;
  APP_URL: StringValidator;
  CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: OptionalSecretValidator;
  CAPACITYLENS_E2E_WORKER_API: OptionalBooleanValidator;
  CAPACITYLENS_LOG: ReturnType<typeof Env.schema.enum.optional<'0' | '1'>>;
  CAPACITYLENS_MAIL_PASSWORD: OptionalSecretValidator;
  CAPACITYLENS_TRUST_PROXY_HEADERS: ProxyTrustValidator;
} & { [Key in OptionalStringKey]: OptionalStringValidator } & {
  [Key in OptionalBooleanKey]: OptionalBooleanValidator;
};

/** Validate operator values while leaving compound rules to their owning configuration. */
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
  APP_NAME: optional,
  CAPACITYLENS_ALLOW_OPEN_SIGN_UP: optionalBoolean,
  CAPACITYLENS_ALLOW_RESET: optionalBoolean,
  // Admission owns the domain-list rules; CORS owns its explicit origin-list validation.
  CAPACITYLENS_ALLOWED_EMAIL_DOMAINS: optional,
  CAPACITYLENS_BACKUP_DIR: optional,
  // Retention deliberately accepts raw text for the backup parser’s warning/default/clamp behavior.
  CAPACITYLENS_BACKUP_KEEP: optional,
  CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD: Env.schema.secret.optional(),
  CAPACITYLENS_CORS_ORIGIN: optional,
  CAPACITYLENS_CREATE_ADMIN_ADMIN: optionalBoolean,
  CAPACITYLENS_DB: optional,
  // Set by scripts/e2e/e2eWorkerRuntime.mjs; read by hooks/generate_registry.ts in the dev server.
  CAPACITYLENS_E2E_WORKER_API: optionalBoolean,
  // Set by scripts/dev/dev-fullstack.mjs to its port lane's Vite origins; ignored outside development.
  CAPACITYLENS_DEV_WEB_ORIGINS: optional,
  // Set by scripts/e2e_server.mjs so the server's today matches the browser tests' frozen date.
  CAPACITYLENS_FIXED_TODAY: parseOptionalISODate,
  CAPACITYLENS_LOG: Env.schema.enum.optional(['0', '1'] as const),
  CAPACITYLENS_MAIL_FROM: Env.schema.string.optional({ format: 'email' }),
  CAPACITYLENS_MAIL_HOST: Env.schema.string.optional({ format: 'host' }),
  CAPACITYLENS_MAIL_PASSWORD: Env.schema.secret.optional(),
  CAPACITYLENS_MAIL_PORT: createOptionalIntegerValidator(65535),
  CAPACITYLENS_MAIL_USER: optional,
  CAPACITYLENS_PUBLIC_URL: optional,
  CAPACITYLENS_RATE_LIMIT: createOptionalIntegerValidator(1_000_000, 0),
  CAPACITYLENS_TEST_HTTP_PORT: createOptionalIntegerValidator(65535),
  CAPACITYLENS_TRUST_PROXY_HEADERS: parseProxyTrust,
};

type CapacityLensEnvironment = Awaited<ReturnType<typeof Env.create<typeof envSchema>>>;

const env: CapacityLensEnvironment = await Env.create(new URL('../', import.meta.url), envSchema);

export default env;
