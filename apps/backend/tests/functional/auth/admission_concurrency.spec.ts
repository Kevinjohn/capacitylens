import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { resetAuthenticatedData } from '../../helpers/authenticated_data_fixture.js'

// The real password-screening boundary lets both HTTP requests reach admission before either
// creates an identity; the test keeps the production single-connection SQLite configuration.
test.group('concurrent invitation admission', (group) => {
  group.each.setup(() => freshDatabase())

  for (const replay of [false, true]) {
    test(`overlapping signup ${replay ? 'replays one command' : 'claims distinct commands'} without duplicate admission`, async ({
      client,
      assert,
      cleanup,
    }) => {
      const previousScreening = env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK')
      const previousMail = env.get('CAPACITYLENS_MAIL_HOST')
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
      env.set('CAPACITYLENS_MAIL_HOST', '')
      cleanup(() => {
        env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', previousScreening)
        env.set('CAPACITYLENS_MAIL_HOST', previousMail ?? '')
      })
      const { cookie } = await resetAuthenticatedData(client, 'single')
      const account = await db.from('accounts').first()
      const person = await db
        .from('resources')
        .where({ account_id: account.id, kind: 'person' })
        .first()
      assert.isOk(person)
      const email = `clark.kent.${crypto.randomUUID()}@wayne.example`
      const invitation = await client
        .post('/api/invites')
        .setup((request) => {
          request.withCookie('adonis-session', cookie)
        })
        .header('sec-fetch-site', 'same-origin')
        .json({
          accountId: account.id,
          role: 'viewer',
          preauthEmail: email,
          proposedResourceId: person.id,
        })
        .send()
      invitation.assertStatus(201)
      const token = (invitation.body() as { token: string }).token
      const before = await db
        .from('company_planning_revisions')
        .where('account_id', account.id)
        .first()
      const commands = Array.from({ length: 2 }, () => ({
        'x-account-command-id': crypto.randomUUID(),
        'idempotency-key': crypto.randomUUID(),
      }))
      if (replay) commands[1] = commands[0]!

      let arrivals = 0
      let release!: () => void
      let refuse!: (error: Error) => void
      const screeningBarrier = new Promise<void>((resolve, reject) => {
        release = resolve
        refuse = reject
      })
      const deadline = setTimeout(
        () => refuse(new Error('Both signup requests did not reach screening')),
        5_000
      )
      const originalFetch = globalThis.fetch
      cleanup(() => {
        clearTimeout(deadline)
        release()
        globalThis.fetch = originalFetch
      })
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', true)
      globalThis.fetch = async (input) => {
        assert.match(String(input), /^https:\/\/api\.pwnedpasswords\.com\/range\/[A-F0-9]{5}$/)
        arrivals += 1
        if (arrivals === 2) release()
        await screeningBarrier
        return new Response(`${'0'.repeat(35)}:0`)
      }
      const responses = await Promise.all(
        commands.map((headers) =>
          client
            .post(`/api/invites/${token}/signup`)
            .header('sec-fetch-site', 'same-origin')
            .headers(headers)
            .json({ email, name: 'Clark Kent', password: 'superman-secret-2026' })
            .send()
        )
      )
      clearTimeout(deadline)
      globalThis.fetch = originalFetch
      assert.equal(arrivals, 2)
      assert.deepEqual(
        responses.map((response) => response.status()).sort(),
        replay ? [201, 201] : [201, 409]
      )
      if (replay) assert.deepEqual(responses[0]!.body(), responses[1]!.body())

      const users = await db.from('users').where('email', email)
      assert.lengthOf(users, 1)
      const userId = users[0]!.id
      const memberships = await db
        .from('memberships')
        .where({ account_id: account.id, user_id: userId })
      assert.lengthOf(memberships, 1)
      assert.equal(memberships[0]!.role, 'viewer')
      const links = await db
        .from('account_member_resources')
        .where({ account_id: account.id, user_id: userId })
      assert.lengthOf(links, 1)
      assert.equal(links[0]!.resource_id, person.id)
      const accepted = await db.from('invitations').where({ account_id: account.id, email }).first()
      assert.isNotNull(accepted.accepted_at)
      assert.lengthOf(
        await db
          .from('audit_entries')
          .where({ action: 'invitation.accepted', entity_id: accepted.id }),
        1
      )
      const after = await db
        .from('company_planning_revisions')
        .where('account_id', account.id)
        .first()
      assert.equal(after.revision, Number(before?.revision ?? 0) + 1)
      assert.lengthOf(
        await db.from('command_results').whereIn(
          'command_id',
          commands.map((command) => command['x-account-command-id'])
        ),
        1
      )
    })
  }
})
