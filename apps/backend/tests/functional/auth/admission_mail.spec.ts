import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import mail from '@adonisjs/mail/services/main'
import env from '#start/env'
import { resetState } from '#services/state_repository'
import { reserveInvitationDelivery } from '#services/admission/mail_budget'

const password = 'batman-secret-2026'
const setupToken = 'admission-mail-setup-0123456789'
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

test.group('invitation delivery after commit', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('company budget caps aggregate attempts across distinct recipients', ({ assert }) => {
    const accountId = crypto.randomUUID()
    for (let index = 0; index < 50; index++)
      assert.isTrue(reserveInvitationDelivery(accountId, `hero${index}@wayne.example`, 1_000_000))
    assert.isFalse(reserveInvitationDelivery(accountId, 'hero50@wayne.example', 1_000_000))
    assert.isTrue(
      reserveInvitationDelivery(accountId, 'hero50@wayne.example', 1_000_000 + 60 * 60 * 1000 + 1)
    )
  })

  test('an anonymous invitation request cannot send mail or create a link', async ({
    client,
    assert,
  }) => {
    const mailer = mail as unknown as { send: () => Promise<unknown> }
    const originalSend = mailer.send
    let sends = 0
    mailer.send = async () => {
      sends++
    }
    try {
      const created = await client
        .post('/api/invites')
        .header('sec-fetch-site', 'same-origin')
        .json({ accountId: 'a-studio', role: 'viewer' })
        .send()
      created.assertStatus(401)
      assert.equal(sends, 0)
      assert.lengthOf(await db.from('invitations'), 0)
    } finally {
      mailer.send = originalSend
    }
  })

  test('a failed send leaves a usable link and the recipient budget bounds later sends', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      check: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
      mail: env.get('CAPACITYLENS_MAIL_HOST'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    env.set('CAPACITYLENS_MAIL_HOST', 'smtp.example')
    const mailer = mail as unknown as {
      send: (callback: (message: unknown) => void) => Promise<unknown>
    }
    const originalSend = mailer.send
    let sends = 0
    let failFirst = true
    mailer.send = async (callback) => {
      sends++
      const message = {
        to: (_recipient: string) => message,
        subject: (_subject: string) => message,
        text: (_text: string) => message,
      }
      callback(message)
      if (failFirst) {
        failFirst = false
        throw new Error('private SMTP failure')
      }
      return undefined
    }
    cleanup(() => {
      mailer.send = originalSend
      env.set('CAPACITYLENS_MODE', prior.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', prior.setup)
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
    const cookie = owner.cookie('adonis-session')!.value
    const company = await withSession(
      client.post('/api/orgs').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    company.assertStatus(201)
    const unaddressed = await withSession(
      client.post('/api/invites').header('sec-fetch-site', 'same-origin'),
      cookie
    )
      .json({ accountId: 'a-studio', role: 'viewer' })
      .send()
    unaddressed.assertStatus(400)
    assert.equal(sends, 0)
    const commandId = crypto.randomUUID()
    const idempotencyKey = crypto.randomUUID()
    const create = (email: string, command?: { commandId: string; idempotencyKey: string }) => {
      let request = client.post('/api/invites').header('sec-fetch-site', 'same-origin')
      if (command)
        request = request
          .header('x-account-command-id', command.commandId)
          .header('idempotency-key', command.idempotencyKey)
      return withSession(request, cookie)
        .json({ accountId: 'a-studio', role: 'viewer', preauthEmail: email })
        .send()
    }
    const failed = await create('clark.kent@wayne.example', { commandId, idempotencyKey })
    failed.assertStatus(201)
    assert.isFalse((failed.body() as unknown as { emailed: boolean }).emailed)
    const token = (failed.body() as { token: string }).token
    const repeated = await create('clark.kent@wayne.example', { commandId, idempotencyKey })
    repeated.assertStatus(409)
    assert.equal((repeated.body() as unknown as { code: string }).code, 'IDEMPOTENCY_CONFLICT')
    assert.equal(sends, 1)
    const admitted = await client
      .post(`/api/invites/${token}/signup`)
      .header('sec-fetch-site', 'same-origin')
      .json({
        email: 'clark.kent@wayne.example',
        name: 'Clark Kent',
        password: 'superman-secret-2026',
      })
      .send()
    admitted.assertStatus(201)
    for (let index = 0; index < 5; index++) {
      const result = await create('clark.kent@wayne.example')
      result.assertStatus(201)
      assert.equal((result.body() as unknown as { emailed: boolean }).emailed, index < 4)
    }
    assert.equal(sends, 5)
    assert.lengthOf(await db.from('invitations').where('account_id', 'a-studio'), 6)
  })
})
