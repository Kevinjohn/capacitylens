import { mock } from 'node:test'
import { transports } from '@adonisjs/mail'
import env from '#start/env'
import { setSecretSetting } from '#tests/helpers/secret_settings'

export const keys = [
  'CAPACITYLENS_MAIL_HOST',
  'CAPACITYLENS_MAIL_PORT',
  'CAPACITYLENS_MAIL_USER',
  'CAPACITYLENS_MAIL_PASSWORD',
  'CAPACITYLENS_MAIL_FROM',
] as const
type MailSettings = Partial<Record<(typeof keys)[number], string>>

export const complete: MailSettings = {
  CAPACITYLENS_MAIL_HOST: 'smtp.wayne.example',
  CAPACITYLENS_MAIL_PORT: '587',
  CAPACITYLENS_MAIL_USER: 'mailer',
  CAPACITYLENS_MAIL_PASSWORD: 'test-mail-password',
  CAPACITYLENS_MAIL_FROM: 'alfred@wayne.example',
}

/** Loads `config/mail.ts` afresh under `settings` and returns the options it gives the SMTP transport. */
export async function smtpOptions(settings: MailSettings) {
  const previous = keys.map((key) => [key, env.get(key), process.env[key]] as const)
  const smtp = mock.method(transports, 'smtp')
  try {
    for (const key of keys) {
      if (key === 'CAPACITYLENS_MAIL_PASSWORD') setSecretSetting(key, settings[key])
      else env.set(key, (settings[key] ?? '') as never)
    }
    const url = new URL(`../../../config/mail.ts?mail-config=${Math.random()}`, import.meta.url)
    await import(url.href)
    return smtp.mock.calls[0]!.arguments[0] as Record<string, unknown>
  } finally {
    smtp.mock.restore()
    for (const [key, value, raw] of previous) {
      env.set(key, value as never)
      if (raw === undefined) delete process.env[key]
      else process.env[key] = raw
    }
  }
}
