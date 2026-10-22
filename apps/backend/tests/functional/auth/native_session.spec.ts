/* eslint-disable @unicorn/no-await-expression-member -- Keep each HTTP request adjacent to its Japa status assertion. */
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import {
  expireIdleIndexIfUnchanged,
  invalidateUserSessions,
  registerProvenSession,
  touchIndexIfUnchanged,
} from '#services/auth/session_authority'
import env from '#start/env'
import limiter from '@adonisjs/limiter/services/main'

const email = 'bruce.wayne@wayne.example'
const password = 'batman-secret-2026'
const setupToken = 'native-auth-setup-token-0123456789abcdef'

function withSession<
  T extends { setup: (callback: () => void) => T; withCookie: (name: string, value: string) => T },
>(request: T, sessionId: string): T {
  return request.setup(() => {
    request.withCookie('adonis-session', sessionId)
  })
}

test.group('native password sessions', (group) => {
  group.setup(() => {
    const previous = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      screening: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    return () => {
      env.set('CAPACITYLENS_MODE', previous.mode ?? 'password-only')
      env.set('CAPACITYLENS_SETUP_TOKEN', previous.setup ?? '')
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', previous.screening)
    }
  })
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await limiter.clear()
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('first owner setup rotates into a native indexed session and closes sign-up', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const cookie = signUp.cookie('adonis-session')?.value
    assert.isNotEmpty(cookie)
    const me = await withSession(client.get('/api/auth/me'), cookie!).send()
    me.assertStatus(200)
    assert.equal(me.body().user.email, email)
    assert.equal(me.body().authMode, 'password-only')
    const index = await db.from('user_session_index').first()
    assert.isDefined(index)
    assert.isAbove(Number(index!.authenticated_at), 0)
    assert.equal(index!.authenticated_at, index!.last_activity_at)
    const second = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
      .send()
    second.assertStatus(403)
    assert.equal((second.body() as unknown as { code: string }).code, 'SIGN_UP_CLOSED')
  })

  test('a missing index rejects a physical native session left after revocation', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const cookie = signUp.cookie('adonis-session')!.value
    const indexed = await db.from('user_session_index').first()
    assert.isDefined(indexed)
    const stored = await db.from('adonis_sessions').where('id', indexed!.session_id).first()
    assert.isDefined(stored)
    await db.from('user_session_index').where('session_id', indexed!.session_id).delete()
    const afterRevocation = await withSession(client.get('/api/auth/me'), cookie).send()
    afterRevocation.assertStatus(401)
    assert.isDefined(await db.from('adonis_sessions').where('id', indexed!.session_id).first())
  })

  test('reauthentication rotates the session and old cookie loses authority', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const oldCookie = signUp.cookie('adonis-session')!.value
    const oldSessionId = (await db.from('user_session_index').first())!.session_id
    const signIn = await withSession(client.post('/api/auth/sign-in'), oldCookie)
      .json({ email, password })
      .send()
    signIn.assertStatus(200)
    const newCookie = signIn.cookie('adonis-session')!.value
    assert.isNotEmpty(newCookie)
    assert.isNull(await db.from('user_session_index').where('session_id', oldSessionId).first())
    const live = await withSession(client.get('/api/auth/me'), newCookie).send()
    live.assertStatus(200)
    const stale = await withSession(client.get('/api/auth/me'), oldCookie).send()
    stale.assertStatus(401)
  })

  test('sign-out revokes only the current session', async ({ client, assert }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const first = signUp.cookie('adonis-session')!.value
    const secondSignIn = await client.post('/api/auth/sign-in').json({ email, password }).send()
    secondSignIn.assertStatus(200)
    const second = secondSignIn.cookie('adonis-session')!.value
    assert.equal((await db.from('user_session_index')).length, 2)
    const signOut = await withSession(client.post('/api/auth/sign-out'), second).send()
    signOut.assertStatus(200)
    ;(await withSession(client.get('/api/auth/me'), second).send()).assertStatus(401)
    ;(await withSession(client.get('/api/auth/me'), first).send()).assertStatus(200)
    assert.equal((await db.from('user_session_index')).length, 1)
  })

  test('malformed, future and expired session metadata fail closed', async ({ client }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const cookie = signUp.cookie('adonis-session')!.value
    const sessionId = (await db.from('user_session_index').first())!.session_id
    await db
      .from('user_session_index')
      .where('session_id', sessionId)
      .update({ last_activity_at: Date.now() + 60_000 })
    ;(await withSession(client.get('/api/auth/me'), cookie).send()).assertStatus(401)
    await db
      .from('user_session_index')
      .where('session_id', sessionId)
      .update({
        authenticated_at: Date.now() - 12 * 60 * 60 * 1000,
        last_activity_at: Date.now() - 12 * 60 * 60 * 1000,
      })
    ;(await withSession(client.get('/api/auth/me'), cookie).send()).assertStatus(401)
  })

  test('idle expiry refuses the old index authority', async ({ client }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const cookie = signUp.cookie('adonis-session')!.value
    const sessionId = (await db.from('user_session_index').first())!.session_id
    await db
      .from('user_session_index')
      .where('session_id', sessionId)
      .update({ last_activity_at: Date.now() - 30 * 60 * 1000 })
    ;(await withSession(client.get('/api/auth/me'), cookie).send()).assertStatus(401)
  })

  test('stale authentication remains signed in and password proof refreshes freshness', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const cookie = signUp.cookie('adonis-session')!.value
    const sessionId = (await db.from('user_session_index').first())!.session_id
    const realNow = Date.now
    let reauth
    try {
      Date.now = () => realNow() + 16 * 60 * 1000
      const stillSignedIn = await withSession(client.get('/api/auth/me'), cookie).send()
      stillSignedIn.assertStatus(200)
      reauth = await withSession(client.post('/api/auth/sign-in'), cookie)
        .json({ email, password })
        .send()
      reauth.assertStatus(200)
    } finally {
      Date.now = realNow
    }
    const freshId = (await db.from('user_session_index').first())!.session_id
    assert.notEqual(freshId, sessionId)
  })

  test('credential change cannot be followed by registration using the old proof', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const user = (await db.from('users').first())!
    const oldHash = String(user.password_hash)
    const candidateSessionId = randomUUID()
    const trx = await db.transaction()
    try {
      await trx.from('users').where('id', user.id).update({ password_hash: 'changed-credential' })
      try {
        await registerProvenSession(
          {
            userId: String(user.id),
            sessionId: candidateSessionId,
            credentialHash: oldHash,
            authenticatedAt: Date.now(),
          },
          trx
        )
        assert.fail('Stale credential proof registered a session')
      } catch (error) {
        assert.match(String(error), /Credentials changed during sign-in/)
      }
      await trx.commit()
    } catch (error) {
      await trx.rollback()
      throw error
    }
    assert.isNull(
      await db.from('user_session_index').where('session_id', candidateSessionId).first()
    )
  })

  test('concurrent first-owner setup admits one credential without an orphan', async ({
    client,
    assert,
  }) => {
    const addresses = ['bruce.wayne@wayne.example', 'clark.kent@wayne.example']
    const attempts = await Promise.all(
      addresses.map((address) =>
        client
          .post('/api/auth/sign-up')
          .header('x-capacitylens-setup-token', setupToken)
          .json({ email: address, password, name: address.split('@')[0] })
          .send()
      )
    )
    assert.sameMembers(
      attempts.map((attempt) => attempt.status()),
      [201, 403]
    )
    assert.equal((await db.from('users')).length, 1)
    assert.equal((await db.from('user_session_index')).length, 1)
    assert.equal((await db.from('adonis_sessions')).length, 1)
  })

  test('revocation captures exact indexed sessions, including one issued earlier in the transaction', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const user = (await db.from('users').first())!
    const currentSessionId = (await db.from('user_session_index').first())!.session_id
    const candidateSessionId = randomUUID()
    const trx = await db.transaction()
    try {
      await registerProvenSession(
        {
          userId: String(user.id),
          sessionId: candidateSessionId,
          credentialHash: String(user.password_hash),
          authenticatedAt: Date.now(),
        },
        trx
      )
      await trx.from('users').where('id', user.id).update({ password_hash: 'changed-credential' })
      const invalidated = await invalidateUserSessions({ userId: String(user.id) }, trx)
      assert.sameMembers(invalidated, [String(currentSessionId), candidateSessionId])
      await trx.commit()
    } catch (error) {
      await trx.rollback()
      throw error
    }
    assert.equal((await db.from('user_session_index').where('user_id', user.id)).length, 0)
  })

  test('HTTP login before password change is revoked and a new proof signs in', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const ownerCookie = signUp.cookie('adonis-session')!.value
    const priorLogin = await client.post('/api/auth/sign-in').json({ email, password }).send()
    priorLogin.assertStatus(200)
    const priorCookie = priorLogin.cookie('adonis-session')!.value
    const changedPassword = 'new-batman-secret-2026'
    const change = await withSession(client.post('/api/auth/change-password'), ownerCookie)
      .json({ currentPassword: password, newPassword: changedPassword, revokeOtherSessions: true })
      .send()
    change.assertStatus(200)
    ;(await withSession(client.get('/api/auth/me'), priorCookie).send()).assertStatus(401)
    ;(await client.post('/api/auth/sign-in').json({ email, password }).send()).assertStatus(401)
    const currentLogin = await client
      .post('/api/auth/sign-in')
      .json({ email, password: changedPassword })
      .send()
    currentLogin.assertStatus(200)
    ;(
      await withSession(
        client.get('/api/auth/me'),
        currentLogin.cookie('adonis-session')!.value
      ).send()
    ).assertStatus(200)
    assert.equal((await db.from('user_session_index')).length, 2)
  })

  test('HTTP password change before old credential login refuses the stale proof', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const ownerCookie = signUp.cookie('adonis-session')!.value
    const changedPassword = 'new-batman-secret-2026'
    const change = await withSession(client.post('/api/auth/change-password'), ownerCookie)
      .json({ currentPassword: password, newPassword: changedPassword, revokeOtherSessions: false })
      .send()
    change.assertStatus(200)
    const oldLogin = await client.post('/api/auth/sign-in').json({ email, password }).send()
    oldLogin.assertStatus(401)
    assert.equal((await db.from('user_session_index')).length, 1)
    ;(await withSession(client.get('/api/auth/me'), ownerCookie).send()).assertStatus(200)
  })

  test('overlapping HTTP login and credential change cannot leave old-proof authority', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const ownerCookie = signUp.cookie('adonis-session')!.value
    const changedPassword = 'new-batman-secret-2026'
    const [login, change] = await Promise.all([
      client.post('/api/auth/sign-in').json({ email, password }).send(),
      withSession(client.post('/api/auth/change-password'), ownerCookie)
        .json({
          currentPassword: password,
          newPassword: changedPassword,
          revokeOtherSessions: true,
        })
        .send(),
    ])
    change.assertStatus(200)
    assert.include([200, 401], login.status())
    if (login.status() === 200) {
      const overlappingCookie = login.cookie('adonis-session')!.value
      ;(await withSession(client.get('/api/auth/me'), overlappingCookie).send()).assertStatus(401)
    }
    ;(await client.post('/api/auth/sign-in').json({ email, password }).send()).assertStatus(401)
    ;(
      await client.post('/api/auth/sign-in').json({ email, password: changedPassword }).send()
    ).assertStatus(200)
  })

  test('activity touches at one minute and never extends the authenticated timestamp', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const cookie = signUp.cookie('adonis-session')!.value
    const original = (await db.from('user_session_index').first())!
    const realNow = Date.now
    try {
      Date.now = () => Number(original.last_activity_at) + 59_000
      ;(await withSession(client.get('/api/auth/me'), cookie).send()).assertStatus(200)
      assert.equal(
        (await db.from('user_session_index').first())!.last_activity_at,
        original.last_activity_at
      )
      Date.now = () => Number(original.last_activity_at) + 60_000
      ;(await withSession(client.get('/api/auth/me'), cookie).send()).assertStatus(200)
      const touched = (await db.from('user_session_index').first())!
      assert.equal(touched.last_activity_at, Number(original.last_activity_at) + 60_000)
      assert.equal(touched.authenticated_at, original.authenticated_at)
    } finally {
      Date.now = realNow
    }
  })

  test('stale expiry loses to a committed touch and stale touch adopts the newer value', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const userId = String((await db.from('users').first())!.id)
    const session = (await db.from('user_session_index').first())!
    const sessionId = String(session.session_id)
    const now = Date.now() + 31 * 60 * 1000
    const observed = now - 30 * 60 * 1000
    const newer = now - 30_000
    await db
      .from('user_session_index')
      .where('session_id', sessionId)
      .update({ last_activity_at: newer })
    const winner = await expireIdleIndexIfUnchanged(userId, sessionId, observed, now)
    assert.equal(winner.lastActivityAt, newer)
    assert.isNotNull(await db.from('user_session_index').where('session_id', sessionId).first())
    const touched = await touchIndexIfUnchanged(userId, sessionId, observed, now)
    assert.equal(touched.lastActivityAt, newer)
    assert.equal(
      (await db.from('user_session_index').where('session_id', sessionId).first())!
        .last_activity_at,
      newer
    )
  })

  test('exact thirty-minute inactivity boundary revokes index authority', async ({
    client,
    assert,
  }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const cookie = signUp.cookie('adonis-session')!.value
    const indexed = (await db.from('user_session_index').first())!
    await db
      .from('adonis_sessions')
      .where('id', indexed.session_id)
      .update({ expires_at: '2100-01-01T00:00:00.000Z' })
    const realNow = Date.now
    try {
      Date.now = () => Number(indexed.last_activity_at) + 30 * 60 * 1000
      ;(await withSession(client.get('/api/auth/me'), cookie).send()).assertStatus(401)
    } finally {
      Date.now = realNow
    }
    assert.isNull(
      await db.from('user_session_index').where('session_id', indexed.session_id).first()
    )
  })

  test('twelve-hour absolute boundary ignores recent activity', async ({ client, assert }) => {
    const signUp = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', setupToken)
      .json({ email, password, name: 'Bruce Wayne' })
      .send()
    signUp.assertStatus(201)
    const cookie = signUp.cookie('adonis-session')!.value
    const indexed = (await db.from('user_session_index').first())!
    await db
      .from('adonis_sessions')
      .where('id', indexed.session_id)
      .update({ expires_at: '2100-01-01T00:00:00.000Z' })
    await db
      .from('user_session_index')
      .where('session_id', indexed.session_id)
      .update({ last_activity_at: Number(indexed.authenticated_at) + 12 * 60 * 60 * 1000 - 60_000 })
    const realNow = Date.now
    try {
      Date.now = () => Number(indexed.authenticated_at) + 12 * 60 * 60 * 1000 - 1
      ;(await withSession(client.get('/api/auth/me'), cookie).send()).assertStatus(200)
      Date.now = () => Number(indexed.authenticated_at) + 12 * 60 * 60 * 1000
      ;(await withSession(client.get('/api/auth/me'), cookie).send()).assertStatus(401)
    } finally {
      Date.now = realNow
    }
    assert.isNull(
      await db.from('user_session_index').where('session_id', indexed.session_id).first()
    )
  })
})
