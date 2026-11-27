import { Secret } from '@adonisjs/core/helpers'
import env from '#start/env'

type SecretSetting = 'CAPACITYLENS_BOOTSTRAP_ADMIN_PASSWORD' | 'CAPACITYLENS_MAIL_PASSWORD'

/**
 * Sets a secret setting as `start/env.ts` parses it: a `Secret`, or undefined when empty. The raw
 * text goes to `process.env`, which child processes inherit, instead of the redacted placeholder.
 */
export function setSecretSetting(key: SecretSetting, value: string | undefined) {
  env.set(key, value ? new Secret(value) : undefined)
  process.env[key] = value ?? ''
}
