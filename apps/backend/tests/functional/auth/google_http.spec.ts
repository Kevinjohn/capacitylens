/* eslint-disable @unicorn/no-await-expression-member -- Keep each HTTP result beside its assertion. */
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import env from '#start/env'
import { GoogleDriver } from '@adonisjs/ally/drivers/google'
import db from '@adonisjs/lucid/services/db'
import { createHash } from 'node:crypto'
import { googleSignInUser } from '#services/auth/google_identity'
import { withTransaction } from '#services/with_transaction'
import { asDataOwner, resetAuthenticatedData } from '../../helpers/authenticated_data_fixture.js'

function browserRequest<
  T extends {
    setup: (callback: () => void) => T
    withCookie: (name: string, value: string) => T
    withEncryptedCookie: (name: string, value: string) => T
  },
>(request: T, cookies: { session: string; state?: string }) {
  return request.setup(() => {
    request.withCookie('adonis-session', cookies.session)
    if (cookies.state) request.withEncryptedCookie('google_oauth_state', cookies.state)
  })
}

async function withGoogleHttp(profile: Record<string, unknown>, work: () => Promise<void>) {
  const prototype = GoogleDriver.prototype as unknown as { httpClient: (url: string) => unknown }
  const original = prototype.httpClient
  prototype.httpClient = function () {
    const request = {
      field() {
        return request
      },
      header() {
        return request
      },
      parseAs() {
        return request
      },
      getResponseType() {
        return 'json'
      },
      async post() {
        return { access_token: 'test-only-token', token_type: 'Bearer' }
      },
      async get() {
        return profile
      },
    }
    return request
  }
  try {
    await work()
  } finally {
    prototype.httpClient = original
  }
}

test.group('Google browser entry', (group) => {
  group.setup(() => freshDatabase())
  group.setup(() => {
    const previous = {
      mode: env.get('CAPACITYLENS_MODE'),
      clientId: env.get('CAPACITYLENS_GOOGLE_CLIENT_ID'),
      clientSecret: env.get('CAPACITYLENS_GOOGLE_CLIENT_SECRET'),
      bootstrap: env.get('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      screening: env.get('CAPACITYLENS_PASSWORD_BREACH_CHECK'),
    }
    env.set('CAPACITYLENS_MODE', 'password-and-sso')
    env.set('CAPACITYLENS_GOOGLE_CLIENT_ID', 'test-google-client')
    env.set('CAPACITYLENS_GOOGLE_CLIENT_SECRET', 'test-google-secret')
    env.set('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS', 'bruce.wayne@wayne.example')
    env.set('CAPACITYLENS_SETUP_TOKEN', 'google-link-test-setup-token-0123456789')
    env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', false)
    return () => {
      env.set('CAPACITYLENS_MODE', previous.mode || 'password-only')
      env.set('CAPACITYLENS_GOOGLE_CLIENT_ID', previous.clientId || '')
      env.set('CAPACITYLENS_GOOGLE_CLIENT_SECRET', previous.clientSecret || '')
      env.set('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS', previous.bootstrap || '')
      env.set('CAPACITYLENS_SETUP_TOKEN', previous.setup || '')
      env.set('CAPACITYLENS_PASSWORD_BREACH_CHECK', previous.screening)
    }
  })
  group.each.setup(async () => {
    await db.from('audit_entries').delete()
    await db.from('command_results').delete()
    await db.from('account_joining_policies').delete()
    await db.from('company_join_intents').delete()
    await db.from('invitations').delete()
    await db.from('memberships').delete()
    await db.from('user_session_index').delete()
    await db.from('provider_identities').delete()
    await db.from('email_proofs').delete()
    await db.from('users').delete()
    await db.from('accounts').delete()
  })
  group.each.teardown(async () => {
    await db.from('audit_entries').delete()
  })

  test('rejects a truthy string Google mailbox claim after valid Ally state without creating identity', async ({
    client,
    assert,
  }) => {
    const callbackURL = new URL('/login', env.get('APP_URL')).href
    const started = await client
      .post('/api/auth/provider-start')
      .json({ provider: 'google', callbackURL, errorCallbackURL: callbackURL })
      .send()
    started.assertStatus(200)
    const state = new URL((started.body() as unknown as { url: string }).url).searchParams.get(
      'state'
    )!
    await withGoogleHttp(
      { sub: 'google-subject-bruce', email: 'bruce.wayne@wayne.example', email_verified: 'false' },
      async () => {
        const callback = await browserRequest(
          client.get(`/api/auth/callback/google?state=${state}&code=test-code`).redirects(0),
          {
            session: started.cookie('adonis-session')!.value,
            state: started.cookie('google_oauth_state')!.value,
          }
        ).send()
        callback.assertStatus(302)
        assert.include(callback.header('location'), 'google_identity_denied')
        assert.isNull(await db.from('users').first())
        assert.isNull(await db.from('user_session_index').first())
      }
    )
  })

  test('links only a fresh matching Google mailbox to the current local principal', async ({
    client,
    assert,
  }) => {
    const signed = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', 'google-link-test-setup-token-0123456789')
      .json({
        email: 'bruce.wayne@wayne.example',
        password: 'batman-secret-2026',
        name: 'Bruce Wayne',
      })
      .send()
    signed.assertStatus(201)
    const session = signed.cookie('adonis-session')!.value
    const user = (await db.from('users').first())!
    const now = new Date().toISOString()
    await db.from('users').where('id', user.id).update({ email_verified: true })
    await db.table('email_proofs').insert({
      id: 'proof-bruce',
      user_id: user.id,
      email: user.email,
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    const callbackURL = new URL('/team?capacitylensIdentityProvider=google', env.get('APP_URL'))
      .href
    const started = await browserRequest(
      client
        .post('/api/identity/link-provider')
        .json({ providerId: 'google', callbackURL, errorCallbackURL: callbackURL }),
      { session }
    ).send()
    started.assertStatus(200)
    const state = new URL((started.body() as unknown as { url: string }).url).searchParams.get(
      'state'
    )!
    await withGoogleHttp(
      { sub: 'google-subject-bruce', email: 'bruce.wayne@wayne.example', email_verified: true },
      async () => {
        const callback = await browserRequest(
          client.get(`/api/auth/callback/google?state=${state}&code=test-code`).redirects(0),
          {
            session: started.cookie('adonis-session')!.value,
            state: started.cookie('google_oauth_state')!.value,
          }
        ).send()
        callback.assertStatus(302)
        assert.include(callback.header('location'), 'capacitylensSsoLinked=google')
        assert.equal((await db.from('provider_identities').first())!.user_id, user.id)
        const info = await browserRequest(client.get('/api/identity/provider?providerId=google'), {
          session,
        }).send()
        info.assertStatus(200)
        assert.equal(
          (info.body() as unknown as { provider: { id: string }; connected: boolean }).provider.id,
          'google'
        )
        assert.isTrue((info.body() as unknown as { connected: boolean }).connected)
      }
    )
  })

  test('a stale link is refused and an already-bound Google subject never merges local users', async ({
    client,
    assert,
    cleanup,
  }) => {
    assert.lengthOf(await db.from('users'), 0)
    const signed = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', 'google-link-test-setup-token-0123456789')
      .json({
        email: 'bruce.wayne@wayne.example',
        password: 'batman-secret-2026',
        name: 'Bruce Wayne',
      })
      .send()
    signed.assertStatus(201)
    let session = signed.cookie('adonis-session')!.value
    const user = (await db.from('users').first())!
    const now = new Date().toISOString()
    await db.from('users').where('id', user.id).update({ email_verified: true })
    await db.table('email_proofs').insert({
      id: 'proof-bruce',
      user_id: user.id,
      email: user.email,
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    const callbackURL = new URL('/team', env.get('APP_URL')).href
    const request = () =>
      browserRequest(
        client
          .post('/api/identity/link-provider')
          .json({ providerId: 'google', callbackURL, errorCallbackURL: callbackURL }),
        { session }
      )
    const originalNow = Date.now
    cleanup(() => {
      Date.now = originalNow
    })
    const index = (await db.from('user_session_index').first())!
    Date.now = () => Number(index.authenticated_at) + 15 * 60_000
    const stale = await request().send()
    stale.assertStatus(403)
    assert.equal((stale.body() as unknown as { code: string }).code, 'SESSION_NOT_FRESH')
    const reauthenticated = await browserRequest(
      client
        .post('/api/auth/sign-in')
        .json({ email: 'bruce.wayne@wayne.example', password: 'batman-secret-2026' }),
      { session }
    ).send()
    reauthenticated.assertStatus(200)
    session = reauthenticated.cookie('adonis-session')!.value
    await db.table('users').insert({
      id: 'user-clark',
      email: 'clark.kent@wayne.example',
      display_name: 'Clark Kent',
      email_verified: true,
      password_hash: null,
      created_at: now,
      updated_at: now,
    })
    await db.table('provider_identities').insert({
      id: 'google-clark',
      user_id: 'user-clark',
      provider: 'google',
      issuer: 'https://accounts.google.com',
      subject: 'bound-elsewhere',
      email: 'clark.kent@wayne.example',
      created_at: now,
      updated_at: now,
    })
    const started = await request().send()
    started.assertStatus(200)
    const state = new URL((started.body() as unknown as { url: string }).url).searchParams.get(
      'state'
    )!
    await withGoogleHttp(
      { sub: 'bound-elsewhere', email: 'bruce.wayne@wayne.example', email_verified: true },
      async () => {
        const callback = await browserRequest(
          client.get(`/api/auth/callback/google?state=${state}&code=test-code`).redirects(0),
          {
            session: started.cookie('adonis-session')!.value,
            state: started.cookie('google_oauth_state')!.value,
          }
        ).send()
        callback.assertStatus(302)
        assert.include(
          callback.header('location'),
          'capacitylensSsoLinkFailed=google_link_conflict'
        )
        assert.isNull(await db.from('provider_identities').where('user_id', user.id).first())
        assert.lengthOf(await db.from('users'), 2)
      }
    )
  })

  test('an already linked Google principal may explicitly join under current open policy', async ({
    client,
    assert,
  }) => {
    const now = new Date().toISOString()
    await db.table('accounts').insert({
      id: 'a-studio',
      name: 'Wayne Enterprises',
      color: '#123456',
      created_at: now,
      updated_at: now,
    })
    await db.table('account_joining_policies').insert({
      id: 'policy-studio',
      account_id: 'a-studio',
      policy: 'open',
      approved_domains: '[]',
      created_at: now,
      updated_at: now,
    })
    await withTransaction((trx) =>
      googleSignInUser(trx, {
        subject: 'google-subject-bruce',
        email: 'bruce.wayne@wayne.example',
        name: 'Bruce Wayne',
      })
    )
    const started = await client
      .post('/api/accounts/a-studio/join/provider/start')
      .json({ providerId: 'google', purpose: 'policy', email: 'bruce.wayne@wayne.example' })
      .send()
    started.assertStatus(200)
    const state = new URL((started.body() as unknown as { url: string }).url).searchParams.get(
      'state'
    )!
    await withGoogleHttp(
      {
        sub: 'google-subject-bruce',
        email: 'bruce.wayne@wayne.example',
        name: 'Bruce Wayne',
        email_verified: true,
      },
      async () => {
        const callback = await browserRequest(
          client.get(`/api/auth/callback/google?state=${state}&code=test-code`).redirects(0),
          {
            session: started.cookie('adonis-session')!.value,
            state: started.cookie('google_oauth_state')!.value,
          }
        ).send()
        callback.assertStatus(302)
        assert.equal(callback.header('location'), '/join/a-studio')
        const session = callback.cookie('adonis-session')!.value
        const complete = await browserRequest(
          client.post('/api/company-join/complete-provider').json({}),
          { session }
        ).send()
        complete.assertStatus(200)
        assert.equal((complete.body() as unknown as { role: string }).role, 'viewer')
        assert.equal((await db.from('memberships').first())!.role, 'viewer')
      }
    )
  })

  test('holds an addressed Google invitation until explicit browser completion', async ({
    client,
    assert,
  }) => {
    const now = new Date().toISOString()
    const token = 'A'.repeat(43)
    await db.table('accounts').insert({
      id: 'a-studio',
      name: 'Wayne Enterprises',
      color: '#123456',
      created_at: now,
      updated_at: now,
    })
    await db.table('users').insert({
      id: 'bootstrap-bruce',
      email: 'bruce.wayne@wayne.example',
      display_name: 'Bruce Wayne',
      email_verified: true,
      password_hash: null,
      created_at: now,
      updated_at: now,
    })
    await db.table('invitations').insert({
      id: 'invite-clark',
      account_id: 'a-studio',
      token_hash: createHash('sha256')
        .update('capacitylens-invite\0')
        .update(token)
        .digest('base64url'),
      email: 'clark.kent@wayne.example',
      role: 'editor',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      accepted_at: null,
      created_at: now,
      updated_at: now,
    })
    const started = await client
      .post('/api/accounts/a-studio/join/provider/start')
      .json({
        providerId: 'google',
        purpose: 'invitation',
        email: 'clark.kent@wayne.example',
        invitationToken: token,
      })
      .send()
    started.assertStatus(200)
    const cookies = {
      session: started.cookie('adonis-session')!.value,
      state: started.cookie('google_oauth_state')!.value,
    }
    const state = new URL((started.body() as unknown as { url: string }).url).searchParams.get(
      'state'
    )!
    const pending = await browserRequest(client.get('/api/company-join/status'), cookies).send()
    pending.assertStatus(200)
    assert.equal((pending.body() as unknown as { state: string }).state, 'pending')
    await withGoogleHttp(
      {
        sub: 'google-subject-clark',
        email: 'clark.kent@wayne.example',
        name: 'Clark Kent',
        email_verified: true,
      },
      async () => {
        const callback = await browserRequest(
          client.get(`/api/auth/callback/google?state=${state}&code=test-code`).redirects(0),
          cookies
        ).send()
        callback.assertStatus(302)
        assert.equal(callback.header('location'), '/join/a-studio')
        const session = callback.cookie('adonis-session')!.value
        assert.equal(
          (
            (
              await browserRequest(client.get('/api/company-join/status'), { session }).send()
            ).body() as unknown as { state: string }
          ).state,
          'approved'
        )
        assert.isNull(await db.from('memberships').first())
        assert.isNull(
          (await db.from('invitations').where('id', 'invite-clark').first())!.accepted_at
        )
        await db.from('company_join_intents').update({ expires_at: Date.now() - 1 })
        const uncommittedExpired = await browserRequest(
          client.post('/api/company-join/complete-provider').json({}),
          { session }
        ).send()
        uncommittedExpired.assertStatus(409)
        assert.isNull(await db.from('memberships').first())
        await db.from('company_join_intents').update({ expires_at: Date.now() + 60_000 })
        const completeRequest = () =>
          client
            .post('/api/company-join/complete-provider')
            .header('x-account-command-id', '11111111-1111-4111-8111-111111111111')
            .header('idempotency-key', '22222222-2222-4222-8222-222222222222')
            .json({})
        const complete = await browserRequest(completeRequest(), { session }).send()
        complete.assertStatus(200)
        assert.equal((complete.body() as unknown as { role: string }).role, 'editor')
        assert.equal((await db.from('memberships').first())!.role, 'editor')
        assert.isNotNull(
          (await db.from('invitations').where('id', 'invite-clark').first())!.accepted_at
        )
        await db.from('company_join_intents').update({ expires_at: Date.now() - 1 })
        const replay = await browserRequest(completeRequest(), { session }).send()
        replay.assertStatus(200)
        assert.equal((replay.body() as unknown as { role: string }).role, 'editor')
        assert.lengthOf(await db.from('memberships'), 1)
      }
    )
  })

  test('refuses a same-origin callback whose path would redirect to another host', async ({
    client,
  }) => {
    for (const path of ['//evil.example/login', '/\\evil.example/login']) {
      const callbackURL = `${env.get('APP_URL')}${path}`
      const refused = await client
        .post('/api/auth/provider-start')
        .json({ provider: 'google', callbackURL, errorCallbackURL: callbackURL })
        .send()
      refused.assertStatus(400)
    }
  })

  test('starts a stateful Google browser journey and refuses a callback without matching state', async ({
    client,
    assert,
  }) => {
    const callbackURL = new URL('/login', env.get('APP_URL')).href
    const started = await client
      .post('/api/auth/provider-start')
      .json({ provider: 'google', callbackURL, errorCallbackURL: callbackURL })
      .send()
    started.assertStatus(200)
    const url = new URL((started.body() as unknown as { url: string }).url)
    assert.equal(url.hostname, 'accounts.google.com')
    assert.isNotEmpty(url.searchParams.get('state'))
    assert.isNotEmpty(started.cookie('google_oauth_state'))
    const request = browserRequest(
      client.get(`/api/auth/callback/google?state=wrong&code=unused`).redirects(0),
      {
        session: started.cookie('adonis-session')!.value,
        state: started.cookie('google_oauth_state')!.value,
      }
    )
    const denied = await request.send()
    denied.assertStatus(302)
    assert.include(denied.header('location'), 'google_state_mismatch')
  })

  test('uses Ally state and mapped Google profile to create an indexed native session', async ({
    client,
    assert,
    cleanup,
  }) => {
    const callbackURL = new URL('/login', env.get('APP_URL')).href
    const started = await client
      .post('/api/auth/provider-start')
      .json({ provider: 'google', callbackURL, errorCallbackURL: callbackURL })
      .send()
    started.assertStatus(200)
    const state = new URL((started.body() as unknown as { url: string }).url).searchParams.get(
      'state'
    )!
    await withGoogleHttp(
      {
        sub: 'google-subject-bruce',
        email: 'bruce.wayne@wayne.example',
        name: 'Bruce Wayne',
        email_verified: true,
      },
      async () => {
        const callback = await browserRequest(
          client
            .get(`/api/auth/callback/google?state=${encodeURIComponent(state)}&code=test-code`)
            .redirects(0),
          {
            session: started.cookie('adonis-session')!.value,
            state: started.cookie('google_oauth_state')!.value,
          }
        ).send()
        callback.assertStatus(302)
        assert.equal(callback.header('location'), '/login')
        assert.isNotEmpty(callback.cookie('adonis-session'))
        const me = await browserRequest(client.get('/api/auth/me'), {
          session: callback.cookie('adonis-session')!.value,
        }).send()
        me.assertStatus(200)
        assert.equal(me.body().user.email, 'bruce.wayne@wayne.example')
        assert.equal(me.body().reauthMethod, 'provider')
        assert.equal(me.body().reauthProviderId, 'google')
        assert.isNotNull(await db.from('user_session_index').first())
        const priorMode = env.get('CAPACITYLENS_MODE')
        cleanup(() => {
          env.set('CAPACITYLENS_MODE', priorMode)
        })
        env.set('CAPACITYLENS_MODE', 'sso-only')
        const session = callback.cookie('adonis-session')!.value
        const ssoMe = await browserRequest(client.get('/api/auth/me'), { session }).send()
        ssoMe.assertStatus(200)
        assert.equal(ssoMe.body().reauthMethod, 'provider')
        assert.equal(ssoMe.body().reauthProviderId, 'google')
        const first = await browserRequest(
          client
            .post('/api/orgs')
            .header('sec-fetch-site', 'same-origin')
            .json({ id: 'a-studio', name: 'Wayne Enterprises' }),
          { session }
        ).send()
        first.assertStatus(201)
        const owner = await db.from('memberships').where('account_id', 'a-studio').first()
        assert.equal(owner.role, 'owner')
        const second = await browserRequest(
          client
            .post('/api/orgs')
            .header('sec-fetch-site', 'same-origin')
            .json({ id: 'a-loft', name: 'Stark Industries' }),
          { session }
        ).send()
        second.assertStatus(403)
        assert.isNull(await db.from('accounts').where('id', 'a-loft').first())
        await db.from('memberships').where('user_id', owner.user_id).update({ role: 'editor' })
        const editorDenied = await browserRequest(
          client
            .post('/api/orgs')
            .header('sec-fetch-site', 'same-origin')
            .json({ id: 'a-denied', name: 'Denied Industries' }),
          { session }
        ).send()
        editorDenied.assertStatus(403)
        await db.from('memberships').where('user_id', owner.user_id).update({ role: 'admin' })
        const eligible = await browserRequest(
          client
            .post('/api/orgs')
            .header('sec-fetch-site', 'same-origin')
            .json({ id: 'a-admin', name: 'Justice League' }),
          { session }
        ).send()
        eligible.assertStatus(403)
        const now = new Date().toISOString()
        await db.table('account_access_restrictions').insert({
          id: 'restriction-a-studio',
          account_id: 'a-studio',
          principal_id: String(owner.user_id),
          verified_email: 'bruce.wayne@wayne.example',
          role: 'admin',
          created_at: now,
        })
        const restricted = await browserRequest(
          client
            .post('/api/orgs')
            .header('sec-fetch-site', 'same-origin')
            .json({ id: 'a-restricted', name: 'Restricted Industries' }),
          { session }
        ).send()
        restricted.assertStatus(403)
        assert.lengthOf(await db.from('accounts'), 1)
      }
    )
  })

  test('refuses an old indexed password session after switching to SSO-only', async ({
    client,
    assert,
    cleanup,
  }) => {
    const signed = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', 'google-link-test-setup-token-0123456789')
      .json({
        email: 'bruce.wayne@wayne.example',
        password: 'batman-secret-2026',
        name: 'Bruce Wayne',
      })
      .send()
    signed.assertStatus(201)
    const session = signed.cookie('adonis-session')!.value
    const priorMode = env.get('CAPACITYLENS_MODE')
    cleanup(() => env.set('CAPACITYLENS_MODE', priorMode))
    env.set('CAPACITYLENS_MODE', 'sso-only')
    for (const request of [
      client.get('/api/auth/me'),
      client.get('/api/state?accountId=a-studio'),
      client
        .post('/api/orgs')
        .header('sec-fetch-site', 'same-origin')
        .json({ id: 'a-studio', name: 'Wayne Enterprises' }),
    ]) {
      const denied = await browserRequest(request, { session }).send()
      denied.assertStatus(401)
    }
    assert.isNull(await db.from('accounts').first())
  })

  test('provider step-up keeps the real principal, rotates on matching subject, and refuses revoked proof', async ({
    client,
    assert,
  }) => {
    const callbackURL = new URL('/team', env.get('APP_URL')).href
    const google = {
      sub: 'google-subject-bruce',
      email: 'bruce.wayne@wayne.example',
      name: 'Bruce Wayne',
      email_verified: true,
    }
    const start = async (session?: string) => {
      const request = client
        .post('/api/auth/provider-start')
        .json({ provider: 'google', callbackURL, errorCallbackURL: callbackURL })
      const response = await (session ? browserRequest(request, { session }) : request).send()
      response.assertStatus(200)
      return response
    }
    const finish = async (response: Awaited<ReturnType<typeof start>>) => {
      const state = new URL((response.body() as unknown as { url: string }).url).searchParams.get(
        'state'
      )!
      return browserRequest(
        client.get(`/api/auth/callback/google?state=${state}&code=test-code`).redirects(0),
        {
          session: response.cookie('adonis-session')!.value,
          state: response.cookie('google_oauth_state')!.value,
        }
      ).send()
    }
    await withGoogleHttp(google, async () => {
      const initial = await finish(await start())
      initial.assertStatus(302)
      let session = initial.cookie('adonis-session')!.value
      const principalId = (await db.from('users').first())!.id

      google.sub = 'other-google-subject'
      const wrong = await finish(await start(session))
      wrong.assertStatus(302)
      assert.include(wrong.header('location'), 'google_reauth_denied')
      assert.lengthOf(await db.from('user_session_index'), 1)
      assert.lengthOf(await db.from('users'), 1)

      google.sub = 'google-subject-bruce'
      const fresh = await finish(await start(session))
      fresh.assertStatus(302)
      assert.equal(fresh.header('location'), '/team')
      session = fresh.cookie('adonis-session')!.value
      const current = await browserRequest(client.get('/api/auth/me'), { session }).send()
      current.assertStatus(200)
      assert.equal(current.body().user.id, principalId)

      const revokedStart = await start(session)
      await db.from('user_session_index').delete()
      const revoked = await finish(revokedStart)
      revoked.assertStatus(302)
      assert.notEqual(revoked.header('location'), '/team')
      assert.isNull(await db.from('user_session_index').first())
    })
  })

  test('refuses foreign callback origins and unavailable providers before redirect', async ({
    client,
  }) => {
    const invalid = await client
      .post('/api/auth/provider-start')
      .json({
        provider: 'google',
        callbackURL: 'https://other.example/login',
        errorCallbackURL: 'https://other.example/login',
      })
      .send()
    invalid.assertStatus(400)
    const deferred = await client
      .post('/api/auth/provider-start')
      .json({
        provider: 'microsoft',
        callbackURL: env.get('APP_URL'),
        errorCallbackURL: env.get('APP_URL'),
      })
      .send()
    deferred.assertStatus(404)
  })

  test('offers Google only in configured mixed or SSO-only modes', async ({ client, cleanup }) => {
    const previous = env.get('CAPACITYLENS_MODE')
    cleanup(() => env.set('CAPACITYLENS_MODE', previous || 'password-only'))
    const callbackURL = new URL('/login', env.get('APP_URL')).href
    const start = () =>
      client
        .post('/api/auth/provider-start')
        .json({ provider: 'google', callbackURL, errorCallbackURL: callbackURL })
        .send()
    env.set('CAPACITYLENS_MODE', 'password-only')
    ;(await start()).assertStatus(404)
    env.set('CAPACITYLENS_MODE', 'sso-only')
    ;(await start()).assertStatus(200)
    const password = await client
      .post('/api/auth/sign-in')
      .json({ email: 'bruce.wayne@wayne.example', password: 'batman-secret-2026' })
      .send()
    password.assertStatus(404)
  })

  test('verifies only the linked Google subject for the pending action without rotating the native session', async ({
    client,
    assert,
    cleanup,
  }) => {
    const priorSetup = env.get('CAPACITYLENS_SETUP_TOKEN')
    env.set('CAPACITYLENS_SETUP_TOKEN', 'capacitylens-japa-setup-token-0123456789abcdef')
    cleanup(() => env.set('CAPACITYLENS_SETUP_TOKEN', priorSetup))
    const { cookie, userId } = await resetAuthenticatedData(client)
    const now = new Date().toISOString()
    await db.table('provider_identities').insert({
      id: 'google-bruce-action',
      user_id: userId,
      provider: 'google',
      issuer: 'https://accounts.google.com',
      subject: 'google-subject-bruce',
      email: 'bruce.wayne@wayne.example',
      created_at: now,
      updated_at: now,
    })
    const indexedBefore = await db.from('user_session_index').where('user_id', userId)
    const callbackURL = new URL('/settings', env.get('APP_URL')).href
    const start = () =>
      asDataOwner(client.post('/api/auth/action-proof/google-start'), cookie)
        .json({
          action: 'anonymise',
          accountId: 'a-studio',
          intent: {},
          callbackURL,
          errorCallbackURL: callbackURL,
        })
        .send()
    const first = await start()
    first.assertStatus(200)
    const firstProof = (first.body() as { proofId: string }).proofId
    const firstState = new URL((first.body() as { url: string }).url).searchParams.get('state')!
    assert.include((first.body() as { url: string }).url, 'prompt=select_account')
    await withGoogleHttp(
      { sub: 'different-subject', email: 'bruce.wayne@wayne.example', email_verified: true },
      async () => {
        const denied = await browserRequest(
          client.get(`/api/auth/callback/google?state=${firstState}&code=test-code`).redirects(0),
          {
            session: first.cookie('adonis-session')!.value,
            state: first.cookie('google_oauth_state')!.value,
          }
        ).send()
        denied.assertStatus(302)
        assert.include(denied.header('location'), 'google_reauth_denied')
      }
    )
    assert.isNull((await db.from('action_proofs').where('id', firstProof).first())?.verified_at)

    const second = await start()
    second.assertStatus(200)
    const secondProof = (second.body() as { proofId: string }).proofId
    const secondState = new URL((second.body() as { url: string }).url).searchParams.get('state')!
    await withGoogleHttp(
      { sub: 'google-subject-bruce', email: 'bruce.wayne@wayne.example', email_verified: true },
      async () => {
        const accepted = await browserRequest(
          client.get(`/api/auth/callback/google?state=${secondState}&code=test-code`).redirects(0),
          {
            session: second.cookie('adonis-session')!.value,
            state: second.cookie('google_oauth_state')!.value,
          }
        ).send()
        accepted.assertStatus(302)
        assert.include(accepted.header('location'), 'capacitylensActionConfirmed=1')
        const repeated = await browserRequest(
          client.get(`/api/auth/callback/google?state=${secondState}&code=test-code`).redirects(0),
          {
            session: second.cookie('adonis-session')!.value,
            state: second.cookie('google_oauth_state')!.value,
          }
        ).send()
        repeated.assertStatus(302)
        assert.notInclude(repeated.header('location'), 'capacitylensActionConfirmed=1')
      }
    )
    assert.isNotNull((await db.from('action_proofs').where('id', secondProof).first())?.verified_at)
    assert.isNull((await db.from('action_proofs').where('id', firstProof).first())?.verified_at)
    const indexedAfter = await db.from('user_session_index').where('user_id', userId)
    assert.lengthOf(indexedAfter, 1)
    assert.equal(indexedAfter[0]?.session_id, indexedBefore[0]?.session_id)
    assert.equal(indexedAfter[0]?.authenticated_at, indexedBefore[0]?.authenticated_at)

    const roleLost = await start()
    roleLost.assertStatus(200)
    const roleProof = (roleLost.body() as { proofId: string }).proofId
    const roleState = new URL((roleLost.body() as { url: string }).url).searchParams.get('state')!
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: userId })
      .update({ role: 'admin' })
    await withGoogleHttp(
      { sub: 'google-subject-bruce', email: 'bruce.wayne@wayne.example', email_verified: true },
      async () => {
        const denied = await browserRequest(
          client.get(`/api/auth/callback/google?state=${roleState}&code=test-code`).redirects(0),
          {
            session: roleLost.cookie('adonis-session')!.value,
            state: roleLost.cookie('google_oauth_state')!.value,
          }
        ).send()
        denied.assertStatus(302)
        assert.notInclude(denied.header('location'), 'capacitylensActionConfirmed=1')
      }
    )
    assert.isNull((await db.from('action_proofs').where('id', roleProof).first())?.verified_at)

    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: userId })
      .update({ role: 'owner' })
    const revoked = await start()
    revoked.assertStatus(200)
    const revokedProof = (revoked.body() as { proofId: string }).proofId
    const revokedState = new URL((revoked.body() as { url: string }).url).searchParams.get('state')!
    await db.from('user_session_index').where('user_id', userId).delete()
    await withGoogleHttp(
      { sub: 'google-subject-bruce', email: 'bruce.wayne@wayne.example', email_verified: true },
      async () => {
        const denied = await browserRequest(
          client.get(`/api/auth/callback/google?state=${revokedState}&code=test-code`).redirects(0),
          {
            session: revoked.cookie('adonis-session')!.value,
            state: revoked.cookie('google_oauth_state')!.value,
          }
        ).send()
        denied.assertStatus(302)
        assert.notInclude(denied.header('location'), 'capacitylensActionConfirmed=1')
      }
    )
    assert.isNull((await db.from('action_proofs').where('id', revokedProof).first())?.verified_at)
  })

  test('a late callback for an earlier Google start cannot verify the newer action proof', async ({
    client,
    assert,
    cleanup,
  }) => {
    const priorSetup = env.get('CAPACITYLENS_SETUP_TOKEN')
    env.set('CAPACITYLENS_SETUP_TOKEN', 'capacitylens-japa-setup-token-0123456789abcdef')
    cleanup(() => env.set('CAPACITYLENS_SETUP_TOKEN', priorSetup))
    const { cookie, userId } = await resetAuthenticatedData(client)
    const now = new Date().toISOString()
    await db.table('provider_identities').insert({
      id: 'google-bruce-late',
      user_id: userId,
      provider: 'google',
      issuer: 'https://accounts.google.com',
      subject: 'google-subject-bruce',
      email: 'bruce.wayne@wayne.example',
      created_at: now,
      updated_at: now,
    })
    const callbackURL = new URL('/settings', env.get('APP_URL')).href
    const start = () =>
      asDataOwner(client.post('/api/auth/action-proof/google-start'), cookie)
        .json({
          action: 'anonymise',
          accountId: 'a-studio',
          intent: {},
          callbackURL,
          errorCallbackURL: callbackURL,
        })
        .send()
    const first = await start()
    const second = await start()
    first.assertStatus(200)
    second.assertStatus(200)
    const firstState = new URL((first.body() as { url: string }).url).searchParams.get('state')!
    const secondProof = (second.body() as { proofId: string }).proofId
    await withGoogleHttp(
      { sub: 'google-subject-bruce', email: 'bruce.wayne@wayne.example', email_verified: true },
      async () => {
        const late = await browserRequest(
          client.get(`/api/auth/callback/google?state=${firstState}&code=test-code`).redirects(0),
          {
            session: second.cookie('adonis-session')!.value,
            state: first.cookie('google_oauth_state')!.value,
          }
        ).send()
        late.assertStatus(302)
        assert.include(late.header('location'), 'google_state_mismatch')
      }
    )
    assert.isNull((await db.from('action_proofs').where('id', secondProof).first())?.verified_at)
  })
})
