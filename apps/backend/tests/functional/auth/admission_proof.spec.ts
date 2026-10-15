import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import { resetState } from '#services/state_repository'

const password = 'batman-secret-2026'
const setupToken = 'admission-proof-setup-0123456789'
const withSession = <
  T extends {
    setup(callback: (request: T) => void): T
    withCookie(name: string, value: string): T
  },
>(
  request: T,
  cookie: string
) =>
  request.setup((prepared) => {
    prepared.withCookie('adonis-session', cookie)
  })

test.group('password mailbox proof for joining', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('email proof is delivered after intent commit and redeemed once by the same session', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      open: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
      check: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
      mail: env.get('CAPACITYLENS_MAIL_HOST'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    env.set('CAPACITYLENS_MAIL_HOST', 'smtp.example')
    const mailer = mail as unknown as {
      send: (callback: (message: unknown) => void) => Promise<unknown>
    }
    const originalSend = mailer.send
    let deliveredText = ''
    mailer.send = async (callback) => {
      const message = {
        to: (_recipient: string) => message,
        subject: (_subject: string) => message,
        text: (value: string) => {
          deliveredText = value
          return message
        },
      }
      callback(message)
      return undefined
    }
    cleanup(() => {
      mailer.send = originalSend
      env.set('CAPACITYLENS_MODE', prior.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', prior.setup)
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', prior.open)
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', prior.check)
      env.set('CAPACITYLENS_MAIL_HOST', prior.mail ?? '')
    })
    const owner = await client
      .post('/api/auth/sign-up')
      .header('sec-fetch-site', 'same-origin')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', name: 'Bruce Wayne', password })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const company = await withSession(
      client.post('/api/orgs').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    company.assertStatus(201)
    const recruit = await client
      .post('/api/auth/sign-up')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: 'diana.prince@wayne.example', name: 'Diana Prince', password })
      .send()
    recruit.assertStatus(201)
    const recruitCookie = recruit.cookie('adonis-session')!.value
    const policy = await withSession(
      client.put('/api/accounts/a-studio/joining-policy').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ policy: 'open', approvedDomains: [] })
      .send()
    policy.assertStatus(200)
    const challenged = await withSession(
      client
        .post('/api/accounts/a-studio/join/complete-existing')
        .header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({})
      .send()
    challenged.assertStatus(401)
    assert.equal((challenged.body() as unknown as { code: string }).code, 'EMAIL_PROOF_REQUIRED')
    const request = await withSession(
      client
        .post('/api/accounts/a-studio/join/verify-email')
        .header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({})
      .send()
    request.assertStatus(200)
    assert.include(deliveredText, '/join/a-studio#verify=')
    const token = deliveredText.match(/#verify=([A-Za-z0-9_-]{43})/)?.[1]
    assert.isString(token)
    const stored = await db.from('company_join_intents').where('account_id', 'a-studio').first()
    assert.notEqual(stored.token_hash, token)
    assert.notInclude(JSON.stringify(stored), token!)
    const wrong = await withSession(
      client.post('/api/company-join/verify-email').header('sec-fetch-site', 'same-origin'),
      ownerCookie
    )
      .json({ token })
      .send()
    wrong.assertStatus(403)
    const good = await withSession(
      client.post('/api/company-join/verify-email').header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({ token })
      .send()
    good.assertStatus(200)
    const repeated = await withSession(
      client.post('/api/company-join/verify-email').header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({ token })
      .send()
    repeated.assertStatus(400)
    const joined = await withSession(
      client
        .post('/api/accounts/a-studio/join/complete-existing')
        .header('sec-fetch-site', 'same-origin'),
      recruitCookie
    )
      .json({})
      .send()
    joined.assertStatus(200)
    assert.equal(joined.body().role, 'viewer')
  })
})
