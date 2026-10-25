import type { ApiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import { randomUUID } from 'node:crypto'
import { AccountAdmission } from 'adonisjs-account-kit/admission'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'

export const fixturePassword = 'fixture-password-2026'

/**
 * Inserts an identity the way an accepted invitation leaves it: a password, and unless asked
 * otherwise a confirmed address and an admission approval.
 */
export async function createIdentity(
  email: string,
  options: { name?: string; password?: string; verified?: boolean; admitted?: boolean } = {}
) {
  const id = randomUUID()
  const now = new Date().toISOString()
  const verified = options.verified ?? true
  await db.table('users').insert({
    id,
    email,
    display_name: options.name ?? email.split('@')[0],
    password: await hash.make(options.password ?? fixturePassword),
    email_verified_at: verified ? now : null,
    unverified_email: verified ? null : email,
    created_at: now,
    updated_at: now,
  })
  if (options.admitted ?? true) {
    const admission = await app.container.make(AccountAdmission)
    await admission.operator.grantInvitation({ email, role: 'viewer' })
    await admission.operator.approve({ email })
  }
  return id
}

/** Signs in through the public route and returns the session cookie and its raw header. */
export async function signIn(client: ApiClient, email: string, password = fixturePassword) {
  const response = await client
    .post('/api/auth/sign-in')
    .header('sec-fetch-site', 'same-origin')
    .json({ email, password })
    .send()
  response.assertStatus(200)
  const cookie = response.cookie('adonis-session')?.value
  const setCookies = response.header('set-cookie')
  const cookieHeader = (Array.isArray(setCookies) ? setCookies : [setCookies])
    .find(
      (value): value is string => typeof value === 'string' && value.startsWith('adonis-session=')
    )
    ?.split(';', 1)[0]
  if (!cookie || !cookieHeader) throw new Error('Sign-in did not create a session.')
  const userId = String((response.body() as { user: { id: string } }).user.id)
  return { cookie, cookieHeader, userId }
}

/** Removes every identity; sign-ins, tokens and memberships cascade with their users. */
export async function clearIdentities() {
  await db.from('account_admissions').delete()
  await db.from('account_invitations').delete()
  await db.from('adonis_sessions').delete()
  await db.from('users').delete()
}

/** Creates a confirmed, admitted identity and returns the response of its first sign-in. */
export async function signUpAndIn(
  client: ApiClient,
  details: { email: string; password: string; name: string }
) {
  await createIdentity(details.email, { name: details.name, password: details.password })
  return client
    .post('/api/auth/sign-in')
    .header('sec-fetch-site', 'same-origin')
    .json({ email: details.email, password: details.password })
    .send()
}

/** Records an Account Kit sign-in row for `userId`, creating that identity when it is absent. */
export async function fixtureSession(userId: string, expiresAt = '2999-01-01T00:00:00.000Z') {
  if (!(await db.from('users').where('id', userId).first())) {
    const now = new Date().toISOString()
    await db.table('users').insert({
      id: userId,
      email: `${userId}@wayne.example`,
      display_name: userId,
      password: null,
      email_verified_at: now,
      created_at: now,
      updated_at: now,
    })
  }
  const now = new Date().toISOString()
  const [id] = await db.table('account_sessions').insert({
    user_id: userId,
    handle_hash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
    created_at: now,
    last_seen_at: now,
    expires_at: expiresAt,
  })
  return Number(id)
}

/** The proof token in an Account Kit action link: its `token` query value, else its last segment. */
export function linkToken(url: string) {
  const parsed = new URL(url)
  return parsed.searchParams.get('token') ?? parsed.pathname.split('/').filter(Boolean).at(-1)!
}

/** Issues the operator bootstrap invitation and returns its token, as the install command does. */
export async function bootstrapInvitation(email: string) {
  const admission = await app.container.make(AccountAdmission)
  const { url } = await admission.operator.bootstrap({ email, role: 'viewer' })
  if (!url) throw new Error('Bootstrap did not print a link.')
  return linkToken(url)
}

/** Fakes mail delivery with a configured mail host and reads the links the Kit sends. */
export function captureMail(cleanup: (callback: () => void) => void) {
  const fake = mail.fake()
  const host = env.get('CAPACITYLENS_MAIL_HOST')
  env.set('CAPACITYLENS_MAIL_HOST', 'mail.wayne.example')
  cleanup(() => {
    mail.restore()
    env.set('CAPACITYLENS_MAIL_HOST', host ?? '')
  })
  const to = (address: string) =>
    [...fake.messages.sent(), ...fake.messages.queued()].filter((message) => message.hasTo(address))
  return {
    count: (address: string) => to(address).length,
    tokenFor(address: string) {
      const message = to(address).at(-1)
      if (!message) throw new Error(`No mail was sent to ${address}.`)
      const { text, html } = message.toJSON().message as { text?: string; html?: string }
      const url = /https?:\/\/[^\s"'<>]+/.exec(text ?? html ?? '')?.[0]
      if (!url) throw new Error(`The mail to ${address} carries no link.`)
      return linkToken(url.replaceAll('&amp;', '&'))
    },
  }
}
