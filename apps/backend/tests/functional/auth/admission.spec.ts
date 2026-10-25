import { test } from '@japa/runner'
import type { ApiClient, ApiResponse } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import { AccountAdmission } from 'adonisjs-account-kit/admission'
import { resetState } from '#services/state_repository'
import { freshDatabase } from '../../helpers/fresh_database.js'
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js'
import {
  captureMail,
  clearIdentities,
  createIdentity,
  signIn,
  expectStatus,
} from '../../helpers/identities.js'

const accountId = 'a-studio'
const owner = 'bruce.wayne@wayne.example'
const person = 'clark.kent@wayne.example'
const password = 'admission-password-2026'

const as = (cookie: string) => ({
  get: (client: ApiClient, path: string): Promise<ApiResponse> =>
    asDataOwner(client.get(path), cookie).send(),
  post: (client: ApiClient, path: string, body: object = {}): Promise<ApiResponse> =>
    asDataOwner(client.post(path), cookie).json(body).send(),
})

const planning = (client: ApiClient, cookie: string) =>
  as(cookie).get(client, `/api/accounts/${accountId}/planning`)

async function company(api: ApiClient) {
  const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' })
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', accountId)
  return signIn(api, owner)
}

/** A confirmed identity with operator invitation evidence for `role`, waiting for approval. */
async function invitedIdentity(role: string) {
  const userId = await createIdentity(person, { password, admitted: false })
  const admission = await app.container.make(AccountAdmission)
  await admission.operator.grantInvitation({ email: person, role })
  return userId
}

test.group('admission and membership completion', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
    await limiter.clear()
  })

  test('a pending person requests admission, an Owner approves, and completion grants the invited role once', async ({
    client: api,
    assert,
  }) => {
    const ownerSession = await company(api)
    const userId = await invitedIdentity('editor')
    const { cookie } = await signIn(api, person, password)
    const status = await as(cookie).get(api, '/api/admission')
    status.assertStatus(200)
    assert.isFalse(status.body().decision.admitted)
    await expectStatus(planning(api, cookie), 403)
    await expectStatus(as(cookie).post(api, '/api/admission/complete'), 403)
    const requested = await as(cookie).post(api, '/api/admission/request')
    requested.assertStatus(200)
    assert.isString(requested.body().requestedAt)
    const pending = await as(ownerSession.cookie).get(api, '/api/admission/requests?status=pending')
    pending.assertStatus(200)
    assert.deepEqual(
      pending.body().items.map((item: { userId: string }) => String(item.userId)),
      [userId]
    )
    const approved = await as(ownerSession.cookie).post(api, `/api/admission/${userId}/approve`)
    approved.assertStatus(200)
    assert.equal(approved.body().approval.status, 'approved')
    const revision = async () => {
      const row = await db.from('company_planning_revisions').where('account_id', accountId).first()
      return Number(row?.revision)
    }
    const membershipRequired = async () => {
      const me = await as(cookie).get(api, '/api/auth/me')
      return me.body().membershipRequired
    }
    assert.isTrue(await membershipRequired())
    const before = await revision()
    const completed = await as(cookie).post(api, '/api/admission/complete')
    completed.assertStatus(200)
    assert.deepEqual(completed.body(), { accountId, role: 'editor', created: true })
    assert.equal(await revision(), before + 1)
    const again = await as(cookie).post(api, '/api/admission/complete')
    assert.deepEqual(again.body(), { accountId, role: 'editor', created: false })
    assert.isFalse(await membershipRequired())
    await expectStatus(planning(api, cookie), 200)
  })

  test('evidence without an assignable role completes as Viewer, never as Owner', async ({
    client: api,
    assert,
  }) => {
    const ownerSession = await company(api)
    const userId = await invitedIdentity('owner')
    await as(ownerSession.cookie).post(api, `/api/admission/${userId}/approve`)
    const { cookie } = await signIn(api, person, password)
    const completed = await as(cookie).post(api, '/api/admission/complete')
    assert.deepEqual(completed.body(), { accountId, role: 'viewer', created: true })
  })

  test('rejection and revocation deny company data on the next request', async ({
    client: api,
  }) => {
    const ownerSession = await company(api)
    const userId = await invitedIdentity('viewer')
    const decide = (decision: string) =>
      as(ownerSession.cookie).post(api, `/api/admission/${userId}/${decision}`)
    await expectStatus(decide('reject'), 200)
    const { cookie } = await signIn(api, person, password)
    await expectStatus(planning(api, cookie), 403)
    await expectStatus(decide('approve'), 200)
    await expectStatus(as(cookie).post(api, '/api/admission/complete'), 200)
    await expectStatus(planning(api, cookie), 200)
    await expectStatus(decide('revoke'), 200)
    await expectStatus(planning(api, cookie), 403)
  })

  test('completion never reactivates disabled access', async ({ client: api, assert }) => {
    await company(api)
    const userId = await createIdentity(person, { password })
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-clark',
      account_id: accountId,
      user_id: userId,
      role: 'editor',
      status: 'disabled',
      created_at: now,
      updated_at: now,
    })
    const { cookie } = await signIn(api, person, password)
    const refused = await as(cookie).post(api, '/api/admission/complete')
    refused.assertStatus(409)
    assert.equal(refused.body().code, 'MEMBERSHIP_DISABLED')
    const membership = await db.from('memberships').where('user_id', userId).first()
    assert.equal(membership?.status, 'disabled')
  })

  test('an Admin whose admission was revoked can no longer list or decide admission', async ({
    client: api,
  }) => {
    const ownerSession = await company(api)
    const userId = await invitedIdentity('viewer')
    const adminId = await createIdentity('diana.prince@wayne.example', { password })
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-diana',
      account_id: accountId,
      user_id: adminId,
      role: 'admin',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const { cookie } = await signIn(api, 'diana.prince@wayne.example', password)
    await expectStatus(as(cookie).get(api, '/api/admission/requests'), 200)
    await expectStatus(as(ownerSession.cookie).post(api, `/api/admission/${adminId}/revoke`), 200)
    await expectStatus(as(cookie).get(api, '/api/admission/requests'), 403)
    await expectStatus(as(cookie).post(api, `/api/admission/${userId}/approve`), 403)
  })

  test('Editors and Viewers cannot list or decide admission', async ({ client: api }) => {
    await company(api)
    const userId = await invitedIdentity('viewer')
    const editorId = await createIdentity('barry.allen@wayne.example', { password })
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: 'member-barry',
      account_id: accountId,
      user_id: editorId,
      role: 'editor',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const { cookie } = await signIn(api, 'barry.allen@wayne.example', password)
    await expectStatus(as(cookie).get(api, '/api/admission/requests'), 403)
    await expectStatus(as(cookie).post(api, `/api/admission/${userId}/approve`), 403)
  })
})

test.group('address confirmation', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
    await limiter.clear()
  })

  test('a removed member cannot rejoin on their own; Enable access restores the role held at removal', async ({
    client: api,
    assert,
  }) => {
    const ownerSession = await company(api)
    const userId = await invitedIdentity('admin')
    const admission = await app.container.make(AccountAdmission)
    await admission.operator.approve({ email: person })
    const { cookie } = await signIn(api, person, password)
    const joined = await as(cookie).post(api, '/api/admission/complete')
    joined.assertStatus(200)
    assert.equal(joined.body().role, 'admin')
    const asOwner = (method: 'patch' | 'delete' | 'post', path: string) =>
      asDataOwner(
        api[method](`/api/accounts/${accountId}/members/${userId}${path}`),
        ownerSession.cookie
      )
    const demoted = await asOwner('patch', '').json({ role: 'viewer' }).send()
    demoted.assertStatus(200)
    const removed = await asOwner('delete', '').send()
    removed.assertStatus(204)

    await expectStatus(as(cookie).post(api, '/api/admission/complete'), 403)
    await expectStatus(planning(api, cookie), 403)
    assert.lengthOf(await db.from('memberships').where('user_id', userId), 0)

    const enabled = await asOwner('post', '/enable-access').send()
    enabled.assertStatus(200)
    const membership = await db.from('memberships').where('user_id', userId).first()
    assert.equal(membership?.role, 'viewer')
    assert.equal(membership?.status, 'active')
    await expectStatus(planning(api, cookie), 200)
  })

  test('an unconfirmed identity confirms its address with the emailed link and chooses its password', async ({
    client: api,
    assert,
    cleanup,
  }) => {
    await company(api)
    await createIdentity(person, { password, verified: false })
    const { cookie } = await signIn(api, person, password)
    const unavailable = await as(cookie).post(api, '/api/auth/verification/send')
    unavailable.assertStatus(503)
    const mail = captureMail(cleanup)
    await expectStatus(as(cookie).post(api, '/api/auth/verification/send'), 200)
    const token = mail.tokenFor(person)
    const inspect = async () => {
      const response = await as(cookie).post(api, '/api/auth/verification/inspect', { token })
      return (response.body() as { valid: boolean }).valid
    }
    assert.isTrue(await inspect())
    assert.isTrue(await inspect(), 'inspection does not spend the link')
    const chosen = 'confirmed-password-2026'
    // Eight emoji are sixteen UTF-16 units but eight characters, under the fifteen-character minimum.
    for (const refused of ['😀'.repeat(8), 'a'.repeat(129)])
      await expectStatus(
        as(cookie).post(api, '/api/auth/verification/complete', { token, password: refused }),
        400
      )
    const confirmed = await as(cookie).post(api, '/api/auth/verification/complete', {
      token,
      password: chosen,
    })
    confirmed.assertStatus(200)
    assert.isFalse(await inspect())
    const signedIn = await signIn(api, person, chosen)
    const me = await as(signedIn.cookie).get(api, '/api/auth/me')
    assert.isTrue(me.body().emailVerified)
    const old = await api
      .post('/api/auth/sign-in')
      .header('sec-fetch-site', 'same-origin')
      .json({ email: person, password })
      .send()
    old.assertStatus(401)
  })
})
