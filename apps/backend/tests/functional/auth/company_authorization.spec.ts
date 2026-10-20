import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { resetState } from '#services/state_repository'

const setupToken = 'native-auth-setup-token-0123456789abcdef'
const password = 'batman-secret-2026'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

test.group('authenticated company administration', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('first owner setup provisions company, Internal client, membership and audit atomically', async ({
    client,
    assert,
    cleanup,
  }) => {
    const oldMode = env.get('CAPACITYLENS_MODE')
    const oldSetup = env.get('CAPACITYLENS_SETUP_TOKEN')
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', oldMode)
      env.set('CAPACITYLENS_SETUP_TOKEN', oldSetup)
    })
    const signup = await trusted(client.post('/api/auth/sign-up'))
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    const direct = await trusted(client.post('/api/accounts'))
      .setup((request) => {
        request.withCookie('adonis-session', cookie)
      })
      .json({ id: 'a-direct', name: 'Wayne Enterprises' })
      .send()
    direct.assertStatus(403)
    assert.include(String((direct.body() as { error?: string }).error), '/api/orgs')
    const org = await trusted(client.post('/api/orgs'))
      .setup((request) => {
        request.withCookie('adonis-session', cookie)
      })
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    org.assertStatus(201)
    const user = await db.from('users').where('email', 'bruce.wayne@wayne.example').first()
    const member = await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: user.id })
      .first()
    assert.equal(member.role, 'owner')
    assert.equal(member.status, 'active')
    assert.lengthOf(await db.from('clients').where({ account_id: 'a-studio', builtin: 'true' }), 1)
    assert.isNotNull(
      await db.from('audit_entries').where({ account_id: 'a-studio', entity: 'accounts' }).first()
    )
  })

  test('current roles gate updates and fresh deletion while preventing additional company creation', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      open: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
      bootstrap: env.get('CAPACITYLENS_BOOTSTRAP_TOKEN'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', prior.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', prior.setup)
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', prior.open)
      env.set('CAPACITYLENS_BOOTSTRAP_TOKEN', prior.bootstrap)
    })
    const ownerSignup = await trusted(client.post('/api/auth/sign-up'))
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    ownerSignup.assertStatus(201)
    let ownerCookie = ownerSignup.cookie('adonis-session')!.value
    const first = await trusted(client.post('/api/orgs'))
      .setup((request) => {
        request.withCookie('adonis-session', ownerCookie)
      })
      .json({ id: 'a-studio', name: 'Wayne Enterprises' })
      .send()
    first.assertStatus(201)
    const editorSignup = await trusted(client.post('/api/auth/sign-up'))
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    editorSignup.assertStatus(201)
    const editorCookie = editorSignup.cookie('adonis-session')!.value
    const editor = await db.from('users').where('email', 'clark.kent@wayne.example').first()
    const now = new Date().toISOString()
    const noStanding = await trusted(client.post('/api/orgs'))
      .setup((request) => {
        request.withCookie('adonis-session', editorCookie)
      })
      .json({ id: 'a-denied', name: 'Stark Industries' })
      .send()
    noStanding.assertStatus(403)
    env.set('CAPACITYLENS_BOOTSTRAP_TOKEN', 'operator-bootstrap-token-0123456789abcdef')
    const tokenCreated = await trusted(client.post('/api/orgs'))
      .setup((request) => {
        request.withCookie('adonis-session', editorCookie)
      })
      .header('x-capacitylens-bootstrap-token', 'operator-bootstrap-token-0123456789abcdef')
      .json({ id: 'a-token', name: 'Stark Industries' })
      .send()
    tokenCreated.assertStatus(403)
    assert.deepEqual(tokenCreated.body(), {
      error: 'This installation already has a company.',
      code: 'FORBIDDEN',
    })
    assert.isNull(await db.from('accounts').where('id', 'a-token').first())
    await db.table('memberships').insert({
      id: 'editor-membership',
      account_id: 'a-studio',
      user_id: editor.id,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const edit = await trusted(client.patch('/api/accounts/a-studio'))
      .setup((request) => {
        request.withCookie('adonis-session', editorCookie)
      })
      .json({ name: 'Wayne Studio' })
      .send()
    edit.assertStatus(200)
    const deniedDelete = await trusted(client.delete('/api/accounts/a-studio'))
      .setup((request) => {
        request.withCookie('adonis-session', editorCookie)
      })
      .send()
    deniedDelete.assertStatus(403)
    const ownerSignIn = await trusted(client.post('/api/auth/sign-in'))
      .json({ email: 'bruce.wayne@wayne.example', password })
      .send()
    ownerSignIn.assertStatus(200)
    ownerCookie = ownerSignIn.cookie('adonis-session')!.value
    const signedInOwner = await trusted(client.get('/api/auth/me'))
      .setup((request) => {
        request.withCookie('adonis-session', ownerCookie)
      })
      .send()
    assert.equal(signedInOwner.status(), 200, JSON.stringify(signedInOwner.body()))
    const originalNow = Date.now
    let staleDelete
    Date.now = () => originalNow() + 16 * 60 * 1000
    try {
      staleDelete = await trusted(client.delete('/api/accounts/a-studio'))
        .setup((request) => {
          request.withCookie('adonis-session', ownerCookie)
        })
        .send()
    } finally {
      Date.now = originalNow
    }
    assert.equal(staleDelete.status(), 403, JSON.stringify(staleDelete.body()))
    assert.equal((staleDelete.body() as { code?: string }).code, 'SESSION_NOT_FRESH')
    assert.isNotNull(await db.from('accounts').where('id', 'a-studio').first())
    const refreshedOwner = await trusted(client.post('/api/auth/sign-in'))
      .json({ email: 'bruce.wayne@wayne.example', password })
      .send()
    refreshedOwner.assertStatus(200)
    ownerCookie = refreshedOwner.cookie('adonis-session')!.value
    const deleted = await trusted(client.delete('/api/accounts/a-studio'))
      .setup((request) => {
        request.withCookie('adonis-session', ownerCookie)
      })
      .send()
    deleted.assertStatus(204)
    assert.isNull(await db.from('accounts').where('id', 'a-studio').first())
    assert.lengthOf(await db.from('clients').where('account_id', 'a-studio'), 0)
    assert.lengthOf(await db.from('memberships').where('account_id', 'a-studio'), 0)
  })

  test('failed Owner insert leaves no company, Internal client or audit', async ({
    client,
    assert,
    cleanup,
  }) => {
    const oldMode = env.get('CAPACITYLENS_MODE')
    const oldSetup = env.get('CAPACITYLENS_SETUP_TOKEN')
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    cleanup(() => {
      env.set('CAPACITYLENS_MODE', oldMode)
      env.set('CAPACITYLENS_SETUP_TOKEN', oldSetup)
    })
    const signup = await trusted(client.post('/api/auth/sign-up'))
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'diana.prince@wayne.example', password, name: 'Diana Prince' })
      .send()
    signup.assertStatus(201)
    const cookie = signup.cookie('adonis-session')!.value
    await db.rawQuery(
      "CREATE TRIGGER fail_company_owner BEFORE INSERT ON memberships WHEN NEW.account_id = 'a-failed' BEGIN SELECT RAISE(ABORT, 'forced membership failure'); END"
    )
    try {
      const failed = await trusted(client.post('/api/orgs'))
        .setup((request) => {
          request.withCookie('adonis-session', cookie)
        })
        .json({ id: 'a-failed', name: 'Wayne Enterprises' })
        .send()
      assert.isAtLeast(failed.status(), 400)
      assert.isNull(await db.from('accounts').where('id', 'a-failed').first())
      assert.lengthOf(await db.from('clients').where('account_id', 'a-failed'), 0)
      assert.lengthOf(await db.from('audit_entries').where('account_id', 'a-failed'), 0)
    } finally {
      await db.rawQuery('DROP TRIGGER fail_company_owner')
    }
  })
})
