import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import limiter from '@adonisjs/limiter/services/main'
import { AccountAdmission } from '@kevinjohn/adonisjs-account-kit/admission'
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main'
import { E_ACCOUNT_KIT_POST_COMMIT } from '@kevinjohn/adonisjs-account-kit/errors'
import { resetState } from '#tests/helpers/state_fixture'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { asDataOwner } from '#tests/helpers/authenticated_data_fixture'
import {
  captureMail,
  clearIdentities,
  createIdentity,
  signIn,
  expectStatus,
} from '#tests/helpers/identities'
import {
  companyId,
  person,
  password,
  decisionRoutes,
  as,
  planning,
  company,
  invitedIdentity,
} from '#tests/helpers/auth/admission'

test.group('admission and membership completion', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
    await limiter.clear()
  })

  test('signed-out status reports the sign-in code and whether operator setup is needed', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureMail(cleanup)
    const body = {
      error: 'Sign-in required.',
      code: 'E_SIGN_IN_REQUIRED',
      passwordResetEmail: true,
    }
    const first = await client.visit('api.session.show').send()
    first.assertStatus(401)
    assert.deepEqual(first.body(), { ...body, needsSetup: true })

    await createIdentity(person)
    const existing = await client.visit('api.session.show').send()
    existing.assertStatus(401)
    assert.deepEqual(existing.body(), body)
  })

  test('a pending person requests admission, an Owner approves, and completion grants the invited role once', async ({
    client: api,
    assert,
  }) => {
    const ownerUser = await company()
    const userId = await invitedIdentity('editor')
    const user = await User.findOrFail(userId)
    const status = await as(user).get(api.visit('api.admission.show'))
    status.assertStatus(200)
    assert.isFalse(status.body().data.decision.admitted)
    await expectStatus(planning(api, user), 403)
    await expectStatus(as(user).post(api.visit('api.memberships.store')), 403)
    const requested = await as(user).post(api.visit('api.admission_requests.store'))
    requested.assertStatus(200)
    assert.isString(requested.body().data.requestedAt)
    const pending = await as(ownerUser).get(
      api.visit('api.admission_requests.index').qs({ status: 'pending' })
    )
    pending.assertStatus(200)
    assert.deepEqual(
      pending.body().data.map((item: { userId: string }) => String(item.userId)),
      [userId]
    )
    // The SPA reads the cursor from `metadata`; a single page ends with a null cursor.
    assert.deepEqual(pending.body().metadata, { nextCursor: null })
    const approved = await as(ownerUser).post(
      api.visit('api.admission_approvals.store', { userId })
    )
    approved.assertStatus(200)
    assert.equal(approved.body().data.approval.status, 'approved')
    const revision = async () => {
      const row = await db.from('company_planning_revisions').where('company_id', companyId).first()
      return Number(row?.revision)
    }
    const membershipRequired = async () => {
      const me = await as(user).get(api.visit('api.session.show'))
      return me.body().data.membershipRequired
    }
    assert.isTrue(await membershipRequired())
    const before = await revision()
    const completed = await as(user).post(api.visit('api.memberships.store'))
    completed.assertStatus(200)
    assert.deepEqual(completed.body().data, { companyId, role: 'editor', created: true })
    assert.equal(await revision(), before + 1)
    const again = await as(user).post(api.visit('api.memberships.store'))
    assert.deepEqual(again.body().data, { companyId, role: 'editor', created: false })
    assert.isFalse(await membershipRequired())
    await expectStatus(planning(api, user), 200)
  })

  test('operator admission recovery preserves credentials after bootstrap stops partway', async ({
    client: api,
    assert,
  }) => {
    const recoveryEmail = 'admin@admin.admin'
    const recoveryUserId = await createIdentity(recoveryEmail, {
      name: 'Bruce Wayne',
      password,
      admitted: false,
    })
    const recoveryUser = await User.findOrFail(recoveryUserId)
    const pending = await as(recoveryUser).get(api.visit('api.admission.show'))
    pending.assertStatus(200)
    assert.isFalse(pending.body().data.decision.admitted)
    assert.isFalse(pending.body().data.decision.requirements.invitation.met)

    const admission = await app.container.make(AccountAdmission)
    await admission.operator.grantInvitation({ email: recoveryEmail, role: 'admin' })
    const invited = await as(recoveryUser).get(api.visit('api.admission.show'))
    invited.assertStatus(200)
    assert.isFalse(invited.body().data.decision.admitted)
    assert.isTrue(invited.body().data.decision.requirements.invitation.met)
    await admission.operator.approve({ email: recoveryEmail })

    const secondSignIn = await signIn(api, recoveryEmail, password)
    const admitted = await asDataOwner(api.visit('api.admission.show'), secondSignIn.cookie).send()
    admitted.assertStatus(200)
    assert.isTrue(admitted.body().data.decision.admitted)
    const recoveryUsers = await db.from('users').where('email', recoveryEmail).select('id')
    assert.equal(recoveryUsers.length, 1)
  })

  test('evidence without an assignable role completes as Viewer, never as Owner', async ({
    client: api,
    assert,
  }) => {
    const ownerUser = await company()
    const userId = await invitedIdentity('owner')
    await as(ownerUser).post(api.visit('api.admission_approvals.store', { userId }))
    const user = await User.findOrFail(userId)
    const completed = await as(user).post(api.visit('api.memberships.store'))
    assert.deepEqual(completed.body().data, { companyId, role: 'viewer', created: true })
  })

  test('rejection and revocation deny company data on the next request', async ({
    client: api,
  }) => {
    const ownerUser = await company()
    const userId = await invitedIdentity('viewer')
    const decide = (decision: keyof typeof decisionRoutes) =>
      as(ownerUser).post(api.visit(decisionRoutes[decision], { userId }))
    await expectStatus(decide('reject'), 200)
    // One session throughout: each decision must reach a sign-in that already exists.
    const { cookie } = await signIn(api, person, password)
    await expectStatus(planning(api, cookie), 403)
    await expectStatus(decide('approve'), 200)
    await expectStatus(as(cookie).post(api.visit('api.memberships.store')), 200)
    await expectStatus(planning(api, cookie), 200)
    await expectStatus(decide('revoke'), 200)
    await expectStatus(planning(api, cookie), 403)
  })

  test('completion never restores a suspended membership', async ({ client: api, assert }) => {
    await company()
    const userId = await createIdentity(person, { password })
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      scope_id: companyId,
      user_id: userId,
      role: 'editor',
      status: 'suspended',
      created_at: now,
      updated_at: now,
    })
    const user = await User.findOrFail(userId)
    const refused = await as(user).post(api.visit('api.memberships.store'))
    refused.assertStatus(409)
    assert.equal(refused.body().code, 'E_MEMBERSHIP_SUSPENDED')
    const membership = await db.from('memberships').where('user_id', userId).first()
    assert.equal(membership?.status, 'suspended')
  })

  test('an Admin whose admission was revoked can no longer list or decide admission', async ({
    client: api,
  }) => {
    const ownerUser = await company()
    const userId = await invitedIdentity('viewer')
    const adminId = await createIdentity('diana.prince@wayne.example', { password })
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      scope_id: companyId,
      user_id: adminId,
      role: 'admin',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    // The Admin's session predates the revocation, which must still reach it.
    const { cookie } = await signIn(api, 'diana.prince@wayne.example', password)
    await expectStatus(as(cookie).get(api.visit('api.admission_requests.index')), 200)
    await expectStatus(
      as(ownerUser).post(api.visit('api.admission_revocations.store', { userId: adminId })),
      200
    )
    await expectStatus(as(cookie).get(api.visit('api.admission_requests.index')), 403)
    await expectStatus(as(cookie).post(api.visit('api.admission_approvals.store', { userId })), 403)
  })

  test('a decision on a malformed account id answers the framework validation failure', async ({
    client: api,
    assert,
  }) => {
    const ownerUser = await company()
    for (const route of Object.values(decisionRoutes)) {
      const response = await as(ownerUser).post(api.visit(route, { userId: 'bad.id' }))
      response.assertStatus(422)
      const { errors } = response.body() as { errors: Array<{ field: string; rule: string }> }
      assert.deepEqual(
        errors.map(({ field, rule }) => ({ field, rule })),
        [{ field: 'params.userId', rule: 'regex' }]
      )
    }
  })

  test('Editors and Viewers cannot list or decide admission', async ({ client: api }) => {
    await company()
    const userId = await invitedIdentity('viewer')
    const editorId = await createIdentity('barry.allen@wayne.example', { password })
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      scope_id: companyId,
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const editorUser = await User.findOrFail(editorId)
    await expectStatus(as(editorUser).get(api.visit('api.admission_requests.index')), 403)
    await expectStatus(
      as(editorUser).post(api.visit('api.admission_approvals.store', { userId })),
      403
    )
  })
})

test.group('address confirmation', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
    await limiter.clear()
  })

  test('an unconfirmed identity confirms its address with the emailed link and chooses its password', async ({
    client: api,
    assert,
    cleanup,
  }) => {
    await company()
    const userId = await createIdentity(person, { password, verified: false })
    const user = await User.findOrFail(userId)
    const unavailable = await as(user).post(api.visit('api.email_verification_requests.store'))
    unavailable.assertStatus(503)
    const mail = captureMail(cleanup)
    await expectStatus(as(user).post(api.visit('api.email_verification_requests.store')), 200)
    const token = mail.tokenFor(person)
    const inspect = async () => {
      const response = await as(user).post(api.visit('api.email_verifications.show'), { token })
      return (response.body() as { data: { valid: boolean } }).data.valid
    }
    assert.isTrue(await inspect())
    assert.isTrue(await inspect(), 'inspection does not spend the link')
    const chosen = 'confirmed-password-2026'
    // Eight emoji are sixteen UTF-16 units but eight characters, under the fifteen-character minimum.
    for (const refused of ['😀'.repeat(8), 'a'.repeat(129)])
      await expectStatus(
        as(user).post(api.visit('api.email_verifications.update'), { token, password: refused }),
        422
      )
    const confirmed = await as(user).post(api.visit('api.email_verifications.update'), {
      token,
      password: chosen,
    })
    confirmed.assertStatus(200)
    assert.isFalse(await inspect())
    const signedIn = await signIn(api, person, chosen)
    const me = await asDataOwner(api.visit('api.session.show'), signedIn.cookie).send()
    assert.isTrue(me.body().data.emailVerified)
    const old = await api
      .visit('api.session.store')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: person, password })
      .send()
    old.assertStatus(401)
  })

  test('a confirmation whose follow-up failed reports the committed result', async ({
    client: api,
    assert,
    cleanup,
  }) => {
    const original = accountKit.emailVerification.complete
    accountKit.emailVerification.complete = async () => {
      throw new E_ACCOUNT_KIT_POST_COMMIT('A follow-up failed.')
    }
    cleanup(() => {
      accountKit.emailVerification.complete = original
    })
    const confirmed = await api
      .visit('api.email_verifications.update')
      .header('sec-fetch-site', 'same-origin')
      .json({
        token: 'committed-token',
        password: 'confirmed-password-2026',
      })
      .send()
    confirmed.assertStatus(503)
    assert.equal((confirmed.body() as { code?: string }).code, 'E_VERIFICATION_COMMITTED')
  })

  test('a database holding two companies refuses membership completion and the company list', async ({
    client: api,
    assert,
  }) => {
    await resetState(true)
    const userId = await createIdentity(person, { password })
    const user = await User.findOrFail(userId)
    const completed = await as(user).post(api.visit('api.memberships.store'))
    completed.assertStatus(409)
    assert.equal(completed.body().code, 'E_MULTIPLE_COMPANIES')
    const companies = await as(user).get(api.visit('api.companies.index'))
    companies.assertStatus(409)
    assert.deepEqual(companies.body(), {
      error:
        'This installation has more than one company. Contact the administrator to resolve it.',
      code: 'E_MULTIPLE_COMPANIES',
    })
  })
})
