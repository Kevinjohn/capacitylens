import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { GoogleDriver } from '@adonisjs/ally/drivers/google'
import { Session } from '@adonisjs/session'
import { googleSignInUser } from '#services/auth/google_identity'
import { withTransaction } from '#services/with_transaction'

function browser<
  T extends {
    setup(callback: () => void): T
    withCookie(name: string, value: string): T
    withEncryptedCookie(name: string, value: string): T
  },
>(request: T, cookies: { session: string; state?: string }) {
  return request.setup(() => {
    request.withCookie('adonis-session', cookies.session)
    if (cookies.state) request.withEncryptedCookie('google_oauth_state', cookies.state)
  })
}

async function profileFromGoogle(profile: Record<string, unknown>, work: () => Promise<void>) {
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

const bruce = {
  sub: 'google-bruce',
  email: 'bruce.wayne@wayne.example',
  name: 'Bruce Wayne',
  email_verified: true,
}

async function startSignIn(client: ApiClient) {
  const callbackURL = new URL('/login', env.get('APP_URL')).href
  const response = await client
    .post('/api/auth/provider-start')
    .json({ provider: 'google', callbackURL, errorCallbackURL: callbackURL })
    .send()
  response.assertStatus(200)
  return {
    state: new URL((response.body() as { url: string }).url).searchParams.get('state')!,
    cookies: {
      session: response.cookie('adonis-session')!.value,
      state: response.cookie('google_oauth_state')!.value,
    },
  }
}

async function callback(
  client: ApiClient,
  started: Awaited<ReturnType<typeof startSignIn>>,
  profile: Record<string, unknown>
) {
  let response: Awaited<ReturnType<ReturnType<ApiClient['get']>['send']>>
  await profileFromGoogle(profile, async () => {
    response = await browser(
      client
        .get(`/api/auth/callback/google?state=${started.state}&code=private-test-code`)
        .redirects(0),
      started.cookies
    ).send()
  })
  return response!
}

test.group('Google denial and rollback boundaries', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.setup(() => {
    const previous = {
      mode: env.get('CAPACITYLENS_MODE'),
      id: env.get('CAPACITYLENS_GOOGLE_CLIENT_ID'),
      secret: env.get('CAPACITYLENS_GOOGLE_CLIENT_SECRET'),
      bootstrap: env.get('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
    }
    env.set('CAPACITYLENS_MODE', 'password-and-sso')
    env.set('CAPACITYLENS_GOOGLE_CLIENT_ID', 'test-google-client')
    env.set('CAPACITYLENS_GOOGLE_CLIENT_SECRET', 'test-google-secret')
    env.set('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS', bruce.email)
    env.set('CAPACITYLENS_SETUP_TOKEN', 'google-negative-setup-token-2026')
    return () => {
      env.set('CAPACITYLENS_MODE', previous.mode || 'off')
      env.set('CAPACITYLENS_GOOGLE_CLIENT_ID', previous.id || '')
      env.set('CAPACITYLENS_GOOGLE_CLIENT_SECRET', previous.secret || '')
      env.set('CAPACITYLENS_PROVIDER_BOOTSTRAP_EMAILS', previous.bootstrap || '')
      env.set('CAPACITYLENS_SETUP_TOKEN', previous.setup || '')
    }
  })
  group.each.setup(async () => {
    for (const table of [
      'audit_entries',
      'command_results',
      'account_joining_policies',
      'company_join_intents',
      'invitations',
      'memberships',
      'user_session_index',
      'provider_identities',
      'email_proofs',
      'users',
      'accounts',
    ])
      await db.from(table).delete()
  })
  group.each.teardown(async () => {
    await db.from('audit_entries').delete()
  })

  test('a second new Google subject without an addressed invitation cannot sign in', async ({
    client,
    assert,
  }) => {
    const first = await startSignIn(client)
    const admitted = await callback(client, first, bruce)
    admitted.assertStatus(302)
    const next = await startSignIn(client)
    const denied = await callback(client, next, {
      ...bruce,
      sub: 'google-diana',
      email: 'diana.prince@wayne.example',
    })
    denied.assertStatus(302)
    assert.include(denied.header('location'), 'google_identity_denied')
    assert.lengthOf(await db.from('users'), 1)
    assert.lengthOf(await db.from('provider_identities'), 1)
    assert.lengthOf(await db.from('user_session_index'), 1)
  })

  test('joining callback refuses a missing browser, changed policy, or another verified address', async ({
    client,
    assert,
  }) => {
    await withTransaction((trx) =>
      googleSignInUser(trx, { subject: bruce.sub, email: bruce.email, name: bruce.name })
    )
    const now = new Date().toISOString()
    await db.table('accounts').insert({
      id: 'a-studio',
      name: 'Wayne Enterprises',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    await db.table('account_joining_policies').insert({
      id: randomUUID(),
      account_id: 'a-studio',
      policy: 'open',
      approved_domains: '[]',
      created_at: now,
      updated_at: now,
    })
    const start = async () => {
      const response = await client
        .post('/api/accounts/a-studio/join/provider/start')
        .json({ providerId: 'google', purpose: 'policy', email: bruce.email })
        .send()
      response.assertStatus(200)
      return {
        state: new URL((response.body() as { url: string }).url).searchParams.get('state')!,
        cookies: {
          session: response.cookie('adonis-session')!.value,
          state: response.cookie('google_oauth_state')!.value,
        },
      }
    }
    const first = await start()
    await profileFromGoogle(bruce, async () => {
      const response = await client
        .get(`/api/auth/callback/google?state=${first.state}&code=private-test-code`)
        .redirects(0)
        .send()
      response.assertStatus(302)
      assert.notInclude(response.header('location'), '/join/a-studio')
    })
    await db
      .from('account_joining_policies')
      .where('account_id', 'a-studio')
      .update({ policy: 'invitation_only' })
    const policyDenied = await callback(client, first, bruce)
    policyDenied.assertStatus(302)
    assert.include(policyDenied.header('location'), 'error=forbidden')
    assert.lengthOf(await db.from('company_join_intents').where('state', 'started'), 1)
    assert.lengthOf(await db.from('memberships'), 0)
    await db
      .from('account_joining_policies')
      .where('account_id', 'a-studio')
      .update({ policy: 'open' })
    const second = await start()
    const addressDenied = await callback(client, second, {
      ...bruce,
      email: 'barbara.gordon@wayne.example',
    })
    addressDenied.assertStatus(302)
    assert.include(addressDenied.header('location'), 'error=forbidden')
    assert.lengthOf(await db.from('users'), 1)
    assert.lengthOf(await db.from('memberships'), 0)
    assert.lengthOf(await db.from('user_session_index'), 0)
    assert.lengthOf(await db.from('company_join_intents').where('state', 'approved'), 0)
    assert.notInclude(
      JSON.stringify([policyDenied.body(), addressDenied.body()]),
      'private-test-code'
    )
  })

  test('unverified or mismatched local email cannot link a Google subject', async ({
    client,
    assert,
  }) => {
    const signed = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', 'google-negative-setup-token-2026')
      .json({ email: bruce.email, password: 'google-negative-password-2026', name: bruce.name })
      .send()
    signed.assertStatus(201)
    const cookie = signed.cookie('adonis-session')!.value
    const start = async () => {
      const url = new URL('/team', env.get('APP_URL')).href
      const response = await browser(
        client
          .post('/api/identity/link-provider')
          .json({ providerId: 'google', callbackURL: url, errorCallbackURL: url }),
        { session: cookie }
      ).send()
      response.assertStatus(200)
      return {
        state: new URL((response.body() as { url: string }).url).searchParams.get('state')!,
        cookies: {
          session: response.cookie('adonis-session')!.value,
          state: response.cookie('google_oauth_state')!.value,
        },
      }
    }
    const unverified = await callback(client, await start(), bruce)
    assert.include(unverified.header('location'), 'local_email_not_verified')
    assert.lengthOf(await db.from('provider_identities'), 0)
    const user = await db.from('users').where('email', bruce.email).first()
    const now = new Date().toISOString()
    await db.table('email_proofs').insert({
      id: randomUUID(),
      user_id: user.id,
      email: bruce.email,
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    await db.from('users').where('id', user.id).update({ email_verified: true })
    const mismatch = await callback(client, await start(), {
      ...bruce,
      email: 'barbara.gordon@wayne.example',
    })
    assert.include(mismatch.header('location'), 'local_email_not_verified')
    assert.lengthOf(await db.from('provider_identities'), 0)
  })

  test('an Owner restriction rolls back verified Google linking and proof changes', async ({
    client,
    assert,
  }) => {
    const signed = await client
      .post('/api/auth/sign-up')
      .header('x-capacitylens-setup-token', 'google-negative-setup-token-2026')
      .json({ email: bruce.email, password: 'google-negative-password-2026', name: bruce.name })
      .send()
    signed.assertStatus(201)
    const user = await db.from('users').where('email', bruce.email).first()
    const now = new Date().toISOString()
    await db.from('users').where('id', user.id).update({ email_verified: true })
    await db.table('email_proofs').insert({
      id: randomUUID(),
      user_id: user.id,
      email: bruce.email,
      verified_at: now,
      created_at: now,
      updated_at: now,
    })
    await db.table('accounts').insert({
      id: 'a-studio',
      name: 'Wayne Enterprises',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    await db.table('memberships').insert({
      id: randomUUID(),
      account_id: 'a-studio',
      user_id: user.id,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    await db.table('account_access_restrictions').insert({
      id: randomUUID(),
      account_id: 'a-studio',
      principal_id: 'prior-principal',
      verified_email: bruce.email,
      role: 'editor',
      created_at: now,
    })
    const url = new URL('/team', env.get('APP_URL')).href
    const started = await browser(
      client
        .post('/api/identity/link-provider')
        .json({ providerId: 'google', callbackURL: url, errorCallbackURL: url }),
      { session: signed.cookie('adonis-session')!.value }
    ).send()
    started.assertStatus(200)
    const before = await db.from('email_proofs').where('user_id', user.id).first()
    const denied = await callback(
      client,
      {
        state: new URL((started.body() as { url: string }).url).searchParams.get('state')!,
        cookies: {
          session: started.cookie('adonis-session')!.value,
          state: started.cookie('google_oauth_state')!.value,
        },
      },
      bruce
    )
    assert.include(denied.header('location'), 'google_link_denied')
    assert.lengthOf(await db.from('provider_identities'), 0)
    assert.deepEqual(await db.from('email_proofs').where('user_id', user.id).first(), before)
    assert.lengthOf(await db.from('user_session_index'), 1)
  })

  test('failed native tagging removes the new index authority without exposing provider secrets', async ({
    client,
    assert,
  }) => {
    const original = Session.prototype.tag
    Session.prototype.tag = async function () {
      throw new Error('test-only tag fault')
    }
    try {
      const started = await startSignIn(client)
      const failed = await callback(client, started, bruce)
      failed.assertStatus(302)
      assert.include(failed.header('location'), 'provider_unavailable')
      assert.lengthOf(await db.from('user_session_index'), 0)
      assert.notInclude(failed.header('location'), 'private-test-code')
      assert.notInclude(failed.header('location'), 'test-only-token')
    } finally {
      Session.prototype.tag = original
    }
  })

  test('session registration failure rolls back principal, provider proof and index together', async ({
    client,
    assert,
  }) => {
    const started = await startSignIn(client)
    await db.rawQuery(
      "CREATE TRIGGER fail_google_session BEFORE INSERT ON user_session_index BEGIN SELECT RAISE(ABORT, 'test-only registration fault'); END"
    )
    try {
      const failed = await callback(client, started, bruce)
      failed.assertStatus(302)
      assert.include(failed.header('location'), 'provider_unavailable')
      assert.notInclude(failed.header('location'), 'private-test-code')
      assert.notInclude(failed.header('location'), 'test-only-token')
      for (const table of [
        'users',
        'provider_identities',
        'email_proofs',
        'user_session_index',
        'memberships',
        'audit_entries',
      ])
        assert.lengthOf(await db.from(table), 0)
    } finally {
      await db.rawQuery('DROP TRIGGER fail_google_session')
    }
  })

  test('an expired browser OAuth intent refuses its callback before identity or session issuance', async ({
    client,
    assert,
  }) => {
    const started = await startSignIn(client)
    const now = Date.now
    Date.now = () => now() + 15 * 60_000 + 1
    try {
      const denied = await callback(client, started, bruce)
      denied.assertStatus(302)
      assert.include(denied.header('location'), 'provider_expired')
      assert.notInclude(denied.header('location'), 'private-test-code')
      for (const table of [
        'users',
        'provider_identities',
        'email_proofs',
        'user_session_index',
        'memberships',
      ])
        assert.lengthOf(await db.from(table), 0)
      assert.lengthOf(await db.from('adonis_sessions').whereNotNull('user_id'), 0)
    } finally {
      Date.now = now
    }
  })

  test('an expired company join intent refuses its callback without granting membership', async ({
    client,
    assert,
  }) => {
    await withTransaction((trx) =>
      googleSignInUser(trx, { subject: bruce.sub, email: bruce.email, name: bruce.name })
    )
    const now = new Date().toISOString()
    await db.table('accounts').insert({
      id: 'a-studio',
      name: 'Wayne Enterprises',
      color: '#6366f1',
      created_at: now,
      updated_at: now,
    })
    await db.table('account_joining_policies').insert({
      id: randomUUID(),
      account_id: 'a-studio',
      policy: 'open',
      approved_domains: '[]',
      created_at: now,
      updated_at: now,
    })
    const started = await client
      .post('/api/accounts/a-studio/join/provider/start')
      .json({ providerId: 'google', purpose: 'policy', email: bruce.email })
      .send()
    started.assertStatus(200)
    await db.from('company_join_intents').update({ expires_at: Date.now() - 1 })
    const denied = await callback(
      client,
      {
        state: new URL((started.body() as { url: string }).url).searchParams.get('state')!,
        cookies: {
          session: started.cookie('adonis-session')!.value,
          state: started.cookie('google_oauth_state')!.value,
        },
      },
      bruce
    )
    denied.assertStatus(302)
    assert.include(denied.header('location'), 'error=forbidden')
    assert.lengthOf(await db.from('company_join_intents').where('state', 'approved'), 0)
    assert.lengthOf(await db.from('memberships'), 0)
    assert.lengthOf(await db.from('user_session_index'), 0)
    assert.lengthOf(await db.from('adonis_sessions').whereNotNull('user_id'), 0)
    assert.lengthOf(await db.from('provider_identities'), 1)
    assert.lengthOf(await db.from('email_proofs'), 1)
  })

  test('Google access denial returns a safe callback error without creating authority', async ({
    client,
    assert,
  }) => {
    const started = await startSignIn(client)
    const denied = await browser(
      client
        .get(`/api/auth/callback/google?state=${started.state}&error=access_denied`)
        .redirects(0),
      started.cookies
    ).send()
    denied.assertStatus(302)
    assert.include(denied.header('location'), 'google_provider_denied')
    assert.notInclude(denied.header('location'), 'access_denied')
    for (const table of [
      'users',
      'provider_identities',
      'email_proofs',
      'user_session_index',
      'memberships',
    ])
      assert.lengthOf(await db.from(table), 0)
    assert.lengthOf(await db.from('adonis_sessions').whereNotNull('user_id'), 0)
  })
})
