import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { resetState } from '#services/state_repository'

const setupToken = 'erasure-setup-token-0123456789abcdef'
const password = 'batman-secret-2026'

function signed<
  T extends { setup(callback: () => void): T; withCookie(name: string, value: string): T },
>(request: T, cookie: string): T {
  return request.setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

test.group('authenticated company erasure', (group) => {
  group.setup(() => {
    const previous = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      multi: env.get('CAPACITYLENS_MULTI_ACCOUNT'),
      multiProcess: process.env.CAPACITYLENS_MULTI_ACCOUNT,
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_MULTI_ACCOUNT', true)
    return () => {
      env.set('CAPACITYLENS_MODE', previous.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', previous.setup)
      env.set('CAPACITYLENS_MULTI_ACCOUNT', previous.multi)
      if (previous.multiProcess === undefined) delete process.env.CAPACITYLENS_MULTI_ACCOUNT
      else process.env.CAPACITYLENS_MULTI_ACCOUNT = previous.multiProcess
    }
  })
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })
  // The migration intentionally refuses to restore its old FK while deleted-company audit remains.
  group.each.teardown(async () => {
    await db.from('audit_entries').delete()
  })

  test('deletion preserves another company and shared principal; exact receipt replays after target membership disappears', async ({
    client,
    assert,
  }) => {
    const signup = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    const first = await signed(client.post('/api/orgs'), cookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    first.assertStatus(201)
    const createCommand = {
      'x-account-command-id': 'company-create-command-0001',
      'idempotency-key': 'company-create-idempotency-0001',
    }
    const second = await signed(client.post('/api/orgs'), cookie)
      .headers(createCommand)
      .json({ id: 'a-loft', name: 'Stark Industries' })
      .send()
    second.assertStatus(201)
    const creationReplay = await signed(client.post('/api/orgs'), cookie)
      .headers(createCommand)
      .json({ id: 'a-loft', name: 'Stark Industries' })
      .send()
    creationReplay.assertStatus(201)
    assert.deepEqual(creationReplay.body(), second.body())
    const creationMismatch = await signed(client.post('/api/orgs'), cookie)
      .headers(createCommand)
      .json({ id: 'a-loft', name: 'Changed Name' })
      .send()
    creationMismatch.assertStatus(409)
    const command = {
      'x-account-command-id': 'company-erase-command-0001',
      'idempotency-key': 'company-erase-idempotency-0001',
    }
    const erase = (accountId: string) =>
      signed(client.delete(`/api/accounts/${accountId}`), cookie)
        .headers(command)
        .send()
    const deleted = await erase('a-studio')
    deleted.assertStatus(204)
    assert.isNull(await db.from('accounts').where('id', 'a-studio').first())
    assert.isNotNull(await db.from('accounts').where('id', 'a-loft').first())
    assert.lengthOf(await db.from('clients').where('account_id', 'a-studio'), 0)
    assert.lengthOf(await db.from('memberships').where('account_id', 'a-studio'), 0)
    assert.lengthOf(await db.from('memberships').where('account_id', 'a-loft'), 1)
    assert.isNotNull(await db.from('users').where('email', 'bruce.wayne@wayne.example').first())
    assert.isNotNull(
      await db.from('audit_entries').where({ account_id: 'a-studio', action: 'delete' }).first()
    )
    const receipt = await db
      .from('command_results')
      .where('command_id', command['x-account-command-id'])
      .first()
    assert.isNull(receipt.account_id)
    const replay = await erase('a-studio')
    replay.assertStatus(204)
    const mismatch = await erase('a-loft')
    mismatch.assertStatus(409)
    assert.isNotNull(await db.from('accounts').where('id', 'a-loft').first())
  })

  test('a failed account delete rolls back its audit, command receipt and all company rows', async ({
    client,
    assert,
  }) => {
    const signup = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'diana.prince@wayne.example', password, name: 'Diana Prince' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    const org = await signed(client.post('/api/orgs'), cookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    org.assertStatus(201)
    await db.rawQuery(
      "CREATE TRIGGER fail_company_erasure BEFORE DELETE ON accounts WHEN OLD.id = 'a-studio' BEGIN SELECT RAISE(ABORT, 'forced company erasure failure'); END"
    )
    try {
      const failed = await signed(client.delete('/api/accounts/a-studio'), cookie)
        .headers({
          'x-account-command-id': 'company-erase-command-0002',
          'idempotency-key': 'company-erase-idempotency-0002',
        })
        .send()
      assert.isAtLeast(failed.status(), 500)
      assert.isNotNull(await db.from('accounts').where('id', 'a-studio').first())
      assert.lengthOf(await db.from('clients').where('account_id', 'a-studio'), 1)
      assert.lengthOf(await db.from('memberships').where('account_id', 'a-studio'), 1)
      assert.isNull(
        await db.from('command_results').where('command_id', 'company-erase-command-0002').first()
      )
      assert.isNull(
        await db.from('audit_entries').where({ account_id: 'a-studio', action: 'delete' }).first()
      )
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_company_erasure')
    }
  })

  test('deleting the last company erases its sole principal and native session', async ({
    client,
    assert,
  }) => {
    const signup = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'barry.allen@wayne.example', password, name: 'Barry Allen' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    const principal = await db.from('users').where('email', 'barry.allen@wayne.example').first()
    assert.isNotNull(principal)
    const org = await signed(client.post('/api/orgs'), cookie)
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    org.assertStatus(201)
    assert.lengthOf(await db.from('user_session_index').where('user_id', principal.id), 1)
    assert.lengthOf(await db.from('adonis_sessions').where('user_id', principal.id), 1)

    const command = {
      'x-account-command-id': 'company-erase-last-principal-command-0001',
      'idempotency-key': 'company-erase-last-principal-idempotency-0001',
    }
    const deleted = await signed(client.delete('/api/accounts/a-studio'), cookie)
      .headers(command)
      .send()
    deleted.assertStatus(204)
    assert.isNull(await db.from('accounts').where('id', 'a-studio').first())
    assert.isNull(await db.from('users').where('id', principal.id).first())
    assert.lengthOf(await db.from('user_session_index').where('user_id', principal.id), 0)
    assert.lengthOf(await db.from('adonis_sessions').where('user_id', principal.id), 0)
    assert.lengthOf(await db.from('password_reset_tokens').where('tokenable_id', principal.id), 0)
    assert.isNotNull(
      await db.from('audit_entries').where({ account_id: 'a-studio', action: 'delete' }).first()
    )
    const replay = await signed(client.delete('/api/accounts/a-studio'), cookie)
      .headers(command)
      .send()
    replay.assertStatus(401)
  })
})
