import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { resetState } from '#services/state_repository'

const setupToken = 'tracking-lifecycle-setup-0123456789'
const password = 'batman-secret-2026'

function signed<
  T extends { setup(callback: () => void): T; withCookie(name: string, value: string): T },
>(request: T, cookie: string) {
  return request.setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

async function userId(email: string) {
  const user = await db.from('users').where('email', email).first()
  if (!user) throw new Error(`Missing test principal: ${email}`)
  return String(user.id)
}

async function observation(accountId: string, principalId: string) {
  return db
    .from('company_settings')
    .where({ account_id: accountId, key: `member-sign-in:${principalId}` })
    .first()
}

test.group('member sign-in tracking lifecycle', (group) => {
  group.setup(() => {
    const original = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      signup: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    return () => {
      env.set('CAPACITYLENS_MODE', original.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', original.setup)
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', original.signup)
    }
  })
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('keeps observations off by default, scopes fresh windows by company, and clears them atomically on global session revocation', async ({
    client,
    assert,
  }) => {
    const owner = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
      .send()
    owner.assertStatus(201)
    const ownerCookie = owner.cookie('adonis-session')!.value
    const now = new Date().toISOString()
    await db.table('accounts').insert([
      {
        id: 'a-studio',
        name: 'Wayne Enterprises',
        color: '#6366f1',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'a-loft',
        name: 'Stark Industries',
        color: '#6366f1',
        created_at: now,
        updated_at: now,
      },
    ])
    await db.table('memberships').insert([
      {
        id: 'owner-studio',
        account_id: 'a-studio',
        user_id: await userId('bruce.wayne@wayne.example'),
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'owner-loft',
        account_id: 'a-loft',
        user_id: await userId('bruce.wayne@wayne.example'),
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ])

    const member = await client
      .post('/api/auth/sign-up')
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    member.assertStatus(201)
    const memberId = await userId('clark.kent@wayne.example')
    await db.table('memberships').insert([
      {
        id: 'member-clark-studio',
        account_id: 'a-studio',
        user_id: memberId,
        role: 'viewer',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'member-clark-loft',
        account_id: 'a-loft',
        user_id: memberId,
        role: 'viewer',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ])

    const signIn = () =>
      client.post('/api/auth/sign-in').json({ email: 'clark.kent@wayne.example', password }).send()
    const offSignIn = await signIn()
    offSignIn.assertStatus(200)
    assert.isNull(await observation('a-studio', memberId))
    assert.isNull(await observation('a-loft', memberId))

    const trackingPath = (accountId: string) => `/api/accounts/${accountId}/member-sign-in-tracking`
    const enableStudio = await signed(client.put(trackingPath('a-studio')), ownerCookie)
      .json({ enabled: true })
      .send()
    enableStudio.assertStatus(200)
    const firstWindow = await db
      .from('company_settings')
      .where({ account_id: 'a-studio', key: 'member-sign-in-tracking' })
      .first()
    assert.isNotNull(await observation('a-studio', await userId('bruce.wayne@wayne.example')))
    assert.isNull(await observation('a-loft', memberId))

    const observedStudio = await signIn()
    observedStudio.assertStatus(200)
    assert.isNotNull(await observation('a-studio', memberId))
    assert.isNull(await observation('a-loft', memberId))
    const repeatedEnable = await signed(client.put(trackingPath('a-studio')), ownerCookie)
      .json({ enabled: true })
      .send()
    repeatedEnable.assertStatus(200)
    const repeatedWindow = await db
      .from('company_settings')
      .where({ account_id: 'a-studio', key: 'member-sign-in-tracking' })
      .first()
    assert.equal(repeatedWindow.created_at, firstWindow.created_at)
    assert.isNotNull(await observation('a-studio', memberId))

    const enableLoft = await signed(client.put(trackingPath('a-loft')), ownerCookie)
      .json({ enabled: true })
      .send()
    enableLoft.assertStatus(200)
    const observedBoth = await signIn()
    observedBoth.assertStatus(200)
    assert.isNotNull(await observation('a-studio', memberId))
    assert.isNotNull(await observation('a-loft', memberId))

    const disableStudio = await signed(client.put(trackingPath('a-studio')), ownerCookie)
      .json({ enabled: false })
      .send()
    disableStudio.assertStatus(200)
    assert.isNull(await observation('a-studio', memberId))
    assert.isNull(
      await db
        .from('company_settings')
        .where({ account_id: 'a-studio', key: 'member-sign-in-tracking' })
        .first()
    )
    assert.isNotNull(await observation('a-loft', memberId))
    const disabledSignIn = await signIn()
    disabledSignIn.assertStatus(200)
    assert.isNull(await observation('a-studio', memberId))
    assert.isNotNull(await observation('a-loft', memberId))

    const reenabledStudio = await signed(client.put(trackingPath('a-studio')), ownerCookie)
      .json({ enabled: true })
      .send()
    reenabledStudio.assertStatus(200)
    assert.isNull(await observation('a-studio', memberId))
    assert.isNotNull(await observation('a-studio', await userId('bruce.wayne@wayne.example')))
    assert.isNotNull(await observation('a-loft', memberId))
    const beforeRevoke = await signIn()
    beforeRevoke.assertStatus(200)
    assert.isNotNull(await observation('a-studio', memberId))
    assert.isNotNull(await observation('a-loft', memberId))

    await db.rawQuery(
      `CREATE TRIGGER fail_global_tracking_clear BEFORE DELETE ON company_settings WHEN OLD.key = 'member-sign-in:${memberId}' BEGIN SELECT RAISE(ABORT, 'forced tracking clear failure'); END`
    )
    try {
      const failedRevoke = await signed(
        client.post(`/api/accounts/a-studio/members/${memberId}/revoke-sessions`),
        ownerCookie
      ).send()
      assert.isAtLeast(failedRevoke.status(), 500)
      assert.isNotNull(await observation('a-studio', memberId))
      assert.isNotNull(await observation('a-loft', memberId))
      const sessions = await db
        .from('user_session_index')
        .where('user_id', memberId)
        .select('session_id')
      assert.isAbove(sessions.length, 0)
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_global_tracking_clear')
    }

    const revoked = await signed(
      client.post(`/api/accounts/a-studio/members/${memberId}/revoke-sessions`),
      ownerCookie
    ).send()
    revoked.assertStatus(204)
    assert.isNull(await observation('a-studio', memberId))
    assert.isNull(await observation('a-loft', memberId))
    assert.isNotNull(await observation('a-studio', await userId('bruce.wayne@wayne.example')))
    assert.isNull(await db.from('user_session_index').where('user_id', memberId).first())
  })
})
