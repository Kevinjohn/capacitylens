import { test } from '@japa/runner'
import router from '@adonisjs/core/services/router'
import type { ApiRequest } from '@japa/api-client'
import type { ParsedNamedMiddleware } from '@adonisjs/core/types/http'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import { resetState } from '#tests/helpers/state_fixture'
import { freshDatabase } from '#tests/helpers/fresh_database'
import {
  asLoggedInDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture'
import { clearIdentities, createIdentity, signIn } from '#tests/helpers/identities'
import { companyId, owner, waiting } from '#tests/helpers/auth/account_gate'

test.group('account gate', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
    const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' })
    await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', companyId)
  })

  test('every route carries its reviewed account gate', ({ assert }) => {
    const routes = Object.values(router.toJSON()).flat()
    const access = Object.fromEntries(
      routes.map((route) => {
        const gate = [...route.middleware.all()].find(
          (entry): entry is ParsedNamedMiddleware =>
            typeof entry === 'object' && 'name' in entry && entry.name === 'accountGate'
        )
        return [`${route.methods.join(',')} ${route.pattern}`, gate ? gate.args.access : 'public']
      })
    )
    assert.deepEqual(access, {
      'GET,HEAD /*': 'public',
      'POST /api/v1/auth/change-password': 'public',
      'POST /api/v1/auth/delete-account': 'public',
      'POST /api/v1/auth/inspect-reset': 'public',
      'GET,HEAD /api/v1/auth/me': 'public',
      'POST /api/v1/auth/password-confirmation': 'public',
      'POST /api/v1/auth/request-reset': 'public',
      'POST /api/v1/auth/reset-password': 'public',
      'POST /api/v1/auth/sign-in': 'public',
      'POST /api/v1/auth/sign-out': 'public',
      'POST /api/v1/auth/sign-up': 'public',
      'POST /api/v1/auth/verification/complete': 'public',
      'POST /api/v1/auth/verification/inspect': 'public',
      'POST /api/v1/auth/verification/send': 'public',
      'GET,HEAD /api/v1/invitations/:token/preview': 'public',
      'POST /api/v1/invitations/:token/sign-up': 'public',
      'GET,HEAD /api/v1/masquerade': 'public',
      'GET,HEAD /health/live': 'public',
      'GET,HEAD /health/ready': 'public',
      'GET,HEAD /api/v1/*': 'limited',
      'GET,HEAD /api/v1/admission': 'limited',
      'POST /api/v1/admission/:userId/approve': 'limited',
      'POST /api/v1/admission/:userId/reject': 'limited',
      'POST /api/v1/admission/:userId/revoke': 'limited',
      'POST /api/v1/admission/request': 'limited',
      'GET,HEAD /api/v1/admission/requests': 'limited',
      'POST /api/v1/companies/:companyId/masquerade': 'limited',
      'DELETE /api/v1/masquerade': 'limited',
      'POST /api/v1/admission/complete': 'admitted',
      'GET,HEAD /api/v1/companies': 'admitted',
      'POST /api/v1/companies/:companyId/anonymise': 'admitted',
      'POST /api/v1/companies/:companyId/example-data': 'admitted',
      'GET,HEAD /api/v1/companies/:companyId/export': 'admitted',
      'GET,HEAD /api/v1/companies/:companyId/getting-started': 'admitted',
      'PUT /api/v1/companies/:companyId/getting-started': 'admitted',
      'GET,HEAD /api/v1/companies/:companyId/invitations': 'admitted',
      'DELETE /api/v1/companies/:companyId/invitations/:id': 'admitted',
      'POST /api/v1/companies/:companyId/invitations/:id/resend': 'admitted',
      'PUT /api/v1/companies/:companyId/member-sign-in-tracking': 'admitted',
      'GET,HEAD /api/v1/companies/:companyId/members': 'admitted',
      'PATCH /api/v1/companies/:companyId/members/:userId': 'admitted',
      'DELETE /api/v1/companies/:companyId/members/:userId/resource-link': 'admitted',
      'PUT /api/v1/companies/:companyId/members/:userId/resource-link': 'admitted',
      'PATCH /api/v1/companies/:companyId/members/:userId/status': 'admitted',
      'POST /api/v1/companies/:companyId/ownership-transfer': 'admitted',
      'GET,HEAD /api/v1/companies/:companyId/planning': 'admitted',
      'GET,HEAD /api/v1/companies/:companyId/planning/archive': 'admitted',
      'POST /api/v1/companies/:companyId/planning/mutations': 'admitted',
      'POST /api/v1/companies/:companyId/planning/redo': 'admitted',
      'POST /api/v1/companies/:companyId/planning/undo': 'admitted',
      'POST /api/v1/companies/:companyId/resources/:id/anonymise': 'admitted',
      'GET,HEAD /api/v1/diagnostics': 'admitted',
      'POST /api/v1/installation/company': 'admitted',
      'POST /api/v1/invitations': 'admitted',
      'GET,HEAD /api/v1/state': 'admitted',
      'POST /api/v1/import/apply': 'admitted',
      'POST /api/v1/import/preview': 'admitted',
    })
  })

  test('a request with no session is refused on admitted and limited routes', async ({
    client,
    assert,
  }) => {
    for (const request of [
      client.visit('api.planning.show', { companyId }),
      client.visit('api.companies.index'),
      client.visit('api.admission.show'),
    ]) {
      const refused = await request.send()
      refused.assertStatus(401)
      assert.deepEqual(refused.body(), { error: 'Sign-in required.', code: 'SIGN_IN_REQUIRED' })
    }
    const unmatched = await client.get('/api/v1/no-such-route').send()
    unmatched.assertStatus(401)
    assert.deepEqual(unmatched.body(), { error: 'Sign-in required.', code: 'SIGN_IN_REQUIRED' })
  })

  test('a signed-in person without admission is refused product routes before the handler and reaches the limited ones', async ({
    client,
    assert,
  }) => {
    const user = await User.findOrFail(
      await createIdentity(waiting, { name: 'Selina Kyle', admitted: false })
    )
    const get = (request: ApiRequest) => request.loginAs(user).send()

    const refusal = 'Your access to this company is waiting on admission.'
    for (const request of [
      client.visit('api.planning.show', { companyId }),
      client.visit('api.companies.index'),
      client.visit('api.company_state.show'),
    ]) {
      const refused = await get(request)
      refused.assertStatus(403)
      const body = refused.body() as { code?: string; error?: string; decision?: unknown }
      assert.equal(body.code, 'ADMISSION_REQUIRED')
      assert.equal(body.error, refusal)
      assert.isObject(body.decision)
    }
    // The body is invalid; the gate answers before the handler reads it.
    const write = await asLoggedInDataOwner(
      client.visit('api.planning_mutations.store', { companyId }),
      user
    )
      .json({ unknown: true } as never)
      .send()
    write.assertStatus(403)
    assert.equal((write.body() as { code?: string }).code, 'ADMISSION_REQUIRED')
    assert.equal((write.body() as { error?: string }).error, refusal)

    for (const [request, status] of [
      [client.visit('api.admission.show'), 200],
      [client.visit('api.session.show'), 200],
      // No route has this path, so it has no name to visit.
      [client.get('/api/v1/no-such-route'), 404],
    ] as const) {
      const reached = await get(request)
      reached.assertStatus(status)
    }
    const requested = await asLoggedInDataOwner(
      client.visit('api.admission_requests.store'),
      user
    ).send()
    requested.assertStatus(200)
    // The remaining limited routes pass the gate; their handlers then refuse a person with no
    // access, in their own words.
    const ownerRow = await db.from('users').where('email', owner).firstOrFail()
    const ownerId = String(ownerRow.id)
    const listed = await get(client.visit('api.admission_requests.index'))
    listed.assertStatus(403)
    const limited = [listed]
    for (const name of [
      'api.admission_approvals.store',
      'api.admission_rejections.store',
      'api.admission_revocations.store',
    ] as const) {
      limited.push(await asLoggedInDataOwner(client.visit(name, { userId: ownerId }), user).send())
    }
    limited.push(
      await asLoggedInDataOwner(client.visit('api.masquerade.store', { companyId }), user)
        .json({ userId: ownerId } as never)
        .send(),
      await asLoggedInDataOwner(client.visit('api.masquerade.destroy'), user).send()
    )
    for (const response of limited) {
      assert.notEqual(response.status(), 401)
      assert.notEqual((response.body() as { code?: string }).code, 'ADMISSION_REQUIRED')
    }
  })

  test('a session that lost its registry handle is refused', async ({ client, assert }) => {
    const { cookieHeader } = await signIn(client, owner)
    const allowed = await client.visit('api.companies.index').header('cookie', cookieHeader).send()
    allowed.assertStatus(200)
    const session = await db.from('adonis_sessions').firstOrFail()
    const data = String(session.data)
    assert.include(data, 'accountKitSession')
    await db
      .from('adonis_sessions')
      .where('id', session.id)
      .update({ data: data.replace('accountKitSession', 'retiredSessionHandle') })
    for (const request of [
      client.visit('api.companies.index'),
      client.visit('api.admission.show'),
    ]) {
      const refused = await request.header('cookie', cookieHeader).send()
      refused.assertStatus(401)
      assert.deepEqual(refused.body(), { error: 'Sign-in required.', code: 'SIGN_IN_REQUIRED' })
    }
  })
})
