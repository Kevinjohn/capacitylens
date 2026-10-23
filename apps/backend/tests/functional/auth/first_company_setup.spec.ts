import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import limiter from '@adonisjs/limiter/services/main'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { asDataOwner } from '../../helpers/authenticated_data_fixture.js'

const credentials = { email: 'bruce@wayne.example', password: 'company-setup-password-2026' }
const token = 'first-company-test-setup-token-0123456789'

test.group('authenticated first company setup', (group) => {
  group.setup(() => {
    const previous = {
      token: env.get('CAPACITYLENS_SETUP_TOKEN'),
      screening: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
    }
    env.set('CAPACITYLENS_SETUP_TOKEN', token)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    return () => {
      env.set('CAPACITYLENS_SETUP_TOKEN', previous.token ?? '')
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', previous.screening)
    }
  })
  group.each.setup(async () => {
    await freshDatabase()
    await limiter.clear()
  })

  test('native registration and sign-in open one atomic Owner company without restarting', async ({
    client,
    assert,
  }) => {
    const refused = await client
      .post('/api/auth/sign-up')
      .json({ ...credentials, name: 'Bruce Wayne' })
      .send()
    refused.assertStatus(403)
    const signup = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', token)
      .json({ ...credentials, name: 'Bruce Wayne' })
      .send()
    signup.assertStatus(201)
    const signin = await client.post('/api/auth/sign-in').json(credentials).send()
    signin.assertStatus(200)
    const cookie = signin.cookie('adonis-session')!.value
    const before = await asDataOwner(client.get('/api/auth/me'), cookie).send()
    assert.isTrue(before.body().companySetupRequired)
    await db.table('password_reset_tokens').insert({
      tokenable_id: signin.body().user.id,
      email: credentials.email,
      hash: 'b'.repeat(64),
      expires_at: '2999-01-01T00:00:00.000Z',
      created_at: new Date().toISOString(),
    })
    const setup = await asDataOwner(client.post('/api/installation/company'), cookie)
      .json({ name: '  Wayne   Enterprises ' })
      .send()
    setup.assertStatus(201)
    const accountId = setup.body().accountId
    assert.equal((await db.from('accounts').first())!.name, 'Wayne Enterprises')
    assert.lengthOf(await db.from('password_reset_tokens'), 0)
    const membership = await db.from('memberships').first()
    assert.deepInclude(membership!, {
      account_id: accountId,
      user_id: signin.body().user.id,
      role: 'owner',
      status: 'active',
    })
    assert.equal((await db.from('clients').first())!.builtin, 'true')
    assert.equal((await db.from('company_planning_revisions').first())!.revision, 1)
    assert.deepInclude((await db.from('audit_entries').first())!, {
      actor_id: signin.body().user.id,
      action: 'company.initialized',
    })
    const state = await asDataOwner(client.get('/api/state').qs({ accountId }), cookie).send()
    state.assertStatus(200)
    assert.deepEqual(state.body().accounts[0].workingDays, [1, 2, 3, 4, 5])
    const after = await asDataOwner(client.get('/api/auth/me'), cookie).send()
    assert.isFalse(after.body().companySetupRequired)
    const duplicate = await asDataOwner(client.post('/api/installation/company'), cookie)
      .json({ name: 'Stark Industries' })
      .send()
    duplicate.assertStatus(409)
    assert.lengthOf(await db.from('accounts'), 1)
  })

  test('open signup waits for a company and ignores a reused setup token', async ({
    client,
    assert,
  }) => {
    const previous = env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP')
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    try {
      const signup = await client
        .post('/api/auth/sign-up')
        .header('x-capacitylens-setup-token', token)
        .json({ ...credentials, name: 'Bruce Wayne' })
        .send()
      signup.assertStatus(201)
      for (const submitted of ['', token]) {
        const refused = await client
          .post('/api/auth/sign-up')
          .header('x-capacitylens-setup-token', submitted)
          .json({
            email: 'clark@wayne.example',
            password: credentials.password,
            name: 'Clark Kent',
          })
          .send()
        refused.assertStatus(403)
        assert.equal((refused.body() as unknown as { code: string }).code, 'SIGN_UP_CLOSED')
      }
      for (const table of ['users', 'user_session_index', 'adonis_sessions'])
        assert.lengthOf(await db.from(table), 1)
      const setup = await asDataOwner(
        client.post('/api/installation/company'),
        signup.cookie('adonis-session')!.value
      )
        .json({ name: 'Wayne Enterprises' })
        .send()
      setup.assertStatus(201)
      const admitted = await client
        .post('/api/auth/sign-up')
        .json({ email: 'clark@wayne.example', password: credentials.password, name: 'Clark Kent' })
        .send()
      admitted.assertStatus(201)
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', false)
      const closed = await client
        .post('/api/auth/sign-up')
        .json({
          email: 'diana@wayne.example',
          password: credentials.password,
          name: 'Diana Prince',
        })
        .send()
      closed.assertStatus(403)
      assert.lengthOf(await db.from('users'), 2)
    } finally {
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', previous)
    }
  })

  test('refuses anonymous setup and malformed or owner-nominating payloads without writes', async ({
    client,
    assert,
  }) => {
    const anonymous = await client
      .post('/api/installation/company')
      .json({ name: 'Wayne Enterprises' })
      .send()
    anonymous.assertStatus(401)
    const signup = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', token)
      .json({ ...credentials, name: 'Bruce Wayne' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    for (const body of [
      { name: '' },
      { name: ' ' },
      { name: 'x'.repeat(101) },
      { name: 'Wayne\u2122 Enterprises' },
      { name: 'Wayne \u{1F680} Enterprises' },
      { name: 1 },
      { name: 'Wayne Enterprises', email: 'clark@wayne.example' },
    ]) {
      const result = await asDataOwner(client.post('/api/installation/company'), cookie)
        .json(body)
        .send()
      result.assertStatus(400)
    }
    assert.lengthOf(await db.from('accounts'), 0)
    assert.lengthOf(await db.from('memberships'), 0)
  })

  test('concurrent requests create exactly one complete company', async ({ client, assert }) => {
    const signup = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', token)
      .json({ ...credentials, name: 'Bruce Wayne' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    const results = await Promise.all(
      ['Wayne Enterprises', 'Stark Industries'].map((name) =>
        asDataOwner(client.post('/api/installation/company'), cookie).json({ name }).send()
      )
    )
    assert.deepEqual(results.map((result) => result.status()).sort(), [201, 409])
    for (const table of [
      'accounts',
      'clients',
      'memberships',
      'company_planning_revisions',
      'audit_entries',
    ])
      assert.lengthOf(await db.from(table), 1)
  })

  test('audit failure rolls back the entire setup and permits a clean retry', async ({
    client,
    assert,
  }) => {
    const signup = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', token)
      .json({ ...credentials, name: 'Bruce Wayne' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    await db.rawQuery(
      "CREATE TRIGGER fail_setup_audit BEFORE INSERT ON audit_entries BEGIN SELECT RAISE(ABORT, 'private detail'); END"
    )
    const failed = await asDataOwner(client.post('/api/installation/company'), cookie)
      .json({ name: 'Wayne Enterprises' })
      .send()
    failed.assertStatus(500)
    for (const table of [
      'accounts',
      'clients',
      'memberships',
      'company_planning_revisions',
      'audit_entries',
    ])
      assert.lengthOf(await db.from(table), 0)
    await db.rawQuery('DROP TRIGGER fail_setup_audit')
    const retry = await asDataOwner(client.post('/api/installation/company'), cookie)
      .json({ name: 'Wayne Enterprises' })
      .send()
    retry.assertStatus(201)
  })
  test('a second native principal closes browser setup rather than nominating an Owner', async ({
    client,
    assert,
  }) => {
    const signup = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', token)
      .json({ ...credentials, name: 'Bruce Wayne' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    const principal = await db.from('users').first()
    await db.table('users').insert({
      ...principal,
      id: 'clark',
      email: 'clark@wayne.example',
      display_name: 'Clark Kent',
    })
    const me = await asDataOwner(client.get('/api/auth/me'), cookie).send()
    assert.isFalse(me.body().companySetupRequired)
    const refused = await asDataOwner(client.post('/api/installation/company'), cookie)
      .json({ name: 'Wayne Enterprises' })
      .send()
    refused.assertStatus(409)
    assert.lengthOf(await db.from('accounts'), 0)
  })

  test('an existing company without membership and a revoked session cannot claim setup', async ({
    client,
    assert,
  }) => {
    const signup = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', token)
      .json({ ...credentials, name: 'Bruce Wayne' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    const setup = await asDataOwner(client.post('/api/installation/company'), cookie)
      .json({ name: 'Wayne Enterprises' })
      .send()
    setup.assertStatus(201)
    await db.from('memberships').delete()
    const refused = await asDataOwner(client.post('/api/installation/company'), cookie)
      .json({ name: 'Stark Industries' })
      .send()
    refused.assertStatus(409)
    await db.from('user_session_index').delete()
    const revoked = await asDataOwner(client.post('/api/installation/company'), cookie)
      .json({ name: 'Stark Industries' })
      .send()
    revoked.assertStatus(401)
    assert.lengthOf(await db.from('accounts'), 1)
  })
})
