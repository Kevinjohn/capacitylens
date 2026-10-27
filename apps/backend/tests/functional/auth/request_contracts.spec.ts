import { test } from '@japa/runner'
import accountKit from 'adonisjs-account-kit/services/main'
import { RegistrationEmailAlreadyRegisteredError } from 'adonisjs-account-kit/errors'
import limiter from '@adonisjs/limiter/services/main'
import env from '#start/env'
import { resetState } from '#services/state_repository'
import { createIdentity, clearIdentities, signIn } from '../../helpers/identities.js'
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js'
import { freshDatabase } from '../../helpers/fresh_database.js'

test.group('ordinary authentication request contracts', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
    await limiter.clear()
  })

  test('sign-in preserves shape and detail refusals before authentication', async ({
    client,
    assert,
  }) => {
    for (const [body, error] of [
      [[], 'Invalid sign-in request.'],
      [{ extra: true }, 'Invalid sign-in request.'],
      [{ email: 'clark@wayne.example', password: '', extra: true }, 'Invalid sign-in request.'],
      [{ email: 'invalid', password: '' }, 'Invalid email or password.'],
      [{ email: 'clark@wayne.example', password: null }, 'Invalid email or password.'],
      [{ password: 'secret' }, 'Invalid email or password.'],
      [{ email: 'clark@wayne.example', password: 123 }, 'Invalid email or password.'],
    ] as const) {
      const response = await client.post<string>('/api/auth/sign-in').json(body).send()
      response.assertStatus(400)
      assert.deepEqual(response.body(), { error })
    }
  })

  test('a string password reaches authentication without a sign-up length rule', async ({
    client,
    assert,
  }) => {
    const response = await client
      .post('/api/auth/sign-in')
      .json({ email: 'clark@wayne.example', password: '' })
      .send()
    response.assertStatus(401)
    assert.deepEqual(response.body(), { error: 'Invalid email or password.' })
  })

  test('sign-in normalizes email before authentication', async ({ client, assert }) => {
    const password = 'krypton-password-2026'
    const userId = await createIdentity('clark.kent@wayne.example', {
      name: 'Clark Kent',
      password,
    })
    const session = await signIn(client, '  Clark.Kent@Wayne.example  ', password)
    assert.equal(session.userId, userId)
  })

  test('admission query validates finite status and scalar cursor but ignores unrelated fields', async ({
    client,
    assert,
  }) => {
    const userId = await createIdentity('bruce.wayne@wayne.example', { name: 'Bruce Wayne' })
    await createFixtureCompanyForOwner(userId, 'Wayne Enterprises', 'a-studio')
    const { cookie } = await signIn(client, 'bruce.wayne@wayne.example')
    for (const query of [
      '',
      '?status=pending',
      '?status=approved',
      '?status=rejected',
      '?status=revoked',
      '?extra=ignored',
    ]) {
      const response = await asDataOwner(
        client.get(`/api/admission/requests${query}`),
        cookie
      ).send()
      assert.equal(response.status(), 200, query)
    }
    const emptyCursor = await asDataOwner(
      client.get('/api/admission/requests?cursor='),
      cookie
    ).send()
    // The HTTP scalar shape is valid; the Kit refuses an empty opaque cursor.
    emptyCursor.assertStatus(422)
    for (const query of [
      'status=unknown',
      'status=',
      'status[]=pending',
      'cursor[]=x',
      `cursor=${'x'.repeat(513)}`,
    ]) {
      const response = await asDataOwner(
        client.get(`/api/admission/requests?${query}`),
        cookie
      ).send()
      response.assertStatus(400)
      response.assertBody({ error: 'Invalid admission list request.' })
    }
  })

  test('sign-up keeps Unicode code-point passwords and trimmed names before policy', async ({
    client,
    assert,
  }) => {
    for (const password of ['a'.repeat(15), '😀'.repeat(15), '😀'.repeat(128)]) {
      const response = await client
        .post('/api/auth/sign-up')
        .json({
          email: '  Clark.Kent@Wayne.example  ',
          password,
          name: '  Clark Kent  ',
        })
        .send()
      response.assertStatus(403)
      assert.deepEqual(response.body(), { error: 'Sign-up is closed.', code: 'SIGN_UP_CLOSED' })
    }
  })

  test('open registration keeps the product 409 response for an existing email', async ({
    client,
    assert,
    cleanup,
  }) => {
    const userId = await createIdentity('bruce.wayne@wayne.example', { name: 'Bruce Wayne' })
    await createFixtureCompanyForOwner(userId, 'Wayne Enterprises', 'a-studio')
    const previousSignup = env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP')
    const originalRegister = accountKit.registration.register
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    accountKit.registration.register = async () => {
      throw new RegistrationEmailAlreadyRegisteredError()
    }
    cleanup(() => {
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', previousSignup)
      accountKit.registration.register = originalRegister
    })

    const response = await client
      .post('/api/auth/sign-up')
      .json({
        email: 'clark.kent@wayne.example',
        password: 'account-password-2026',
        name: 'Clark Kent',
      })
      .send()

    response.assertStatus(409)
    assert.deepEqual(response.body(), {
      error: 'An account already uses this email. Sign in or reset your password.',
      code: 'EMAIL_REGISTERED',
    })
  })

  test('sign-up rejects unknown fields and invalid details without changing flat errors', async ({
    client,
    assert,
  }) => {
    for (const [body, error] of [
      [
        { email: 'clark@wayne.example', password: 'a'.repeat(15), name: 'Clark Kent', extra: 1 },
        'Invalid sign-up request.',
      ],
      [[], 'Invalid sign-up request.'],
      [{ email: 'clark@wayne.example', password: 'a'.repeat(15) }, 'Invalid sign-up details.'],
      [
        { email: 'invalid', password: 'a'.repeat(15), name: 'Clark Kent' },
        'Invalid sign-up details.',
      ],
      [
        { email: 'clark@wayne.example', password: '😀'.repeat(14), name: 'Clark Kent' },
        'Invalid sign-up details.',
      ],
      [
        { email: 'clark@wayne.example', password: '😀'.repeat(129), name: 'Clark Kent' },
        'Invalid sign-up details.',
      ],
      [
        { email: 'clark@wayne.example', password: 'a'.repeat(15), name: '  ' },
        'Invalid sign-up details.',
      ],
    ] as const) {
      const response = await client.post<string>('/api/auth/sign-up').json(body).send()
      response.assertStatus(400)
      assert.deepEqual(response.body(), { error })
    }
  })
})
