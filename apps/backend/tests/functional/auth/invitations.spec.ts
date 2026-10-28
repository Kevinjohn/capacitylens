import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import db from '@adonisjs/lucid/services/db'
import limiter from '@adonisjs/limiter/services/main'
import mailService from '@adonisjs/mail/services/main'
import accountKit from 'adonisjs-account-kit/services/main'
import { DeliveryError, RegistrationEmailAlreadyRegisteredError } from 'adonisjs-account-kit/errors'
import env from '#start/env'
import { resetState } from '#services/state_repository'
import { freshDatabase } from '../../helpers/fresh_database.js'
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js'
import { rememberSessionCookie } from '../../helpers/identities.js'
import {
  captureMail,
  clearIdentities,
  createIdentity,
  signIn,
  expectStatus,
} from '../../helpers/identities.js'
import { requestBarrier } from '../../helpers/request_barrier.js'

const accountId = 'a-studio'
const owner = 'bruce.wayne@wayne.example'
const invitee = 'clark.kent@wayne.example'
const password = 'invitation-password-2026'

async function company() {
  const ownerId = await createIdentity(owner, { name: 'Bruce Wayne' })
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', accountId)
  return ownerId
}

async function member(email: string, role: 'admin' | 'editor' | 'viewer') {
  const userId = await createIdentity(email)
  const now = new Date().toISOString()
  await db.table('memberships').insert({
    id: crypto.randomUUID(),
    account_id: accountId,
    user_id: userId,
    role,
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  return userId
}

const invite = (client: ApiClient, cookie: string, email: string, role = 'editor') =>
  asDataOwner(client.post('/api/invites'), cookie)
    .timeout({ response: 10000, deadline: 15000 })
    .json({ accountId, email, role })
    .send()

const accept = (client: ApiClient, token: string, name = 'Clark Kent') =>
  client
    .post(`/api/invites/${token}/signup`)
    .header('sec-fetch-site', 'same-origin')
    .json({ name, password })
    .send()

async function revision() {
  const row = await db.from('company_planning_revisions').where('account_id', accountId).first()
  return Number(row?.revision)
}

test.group('company invitations', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
    await limiter.clear()
  })

  test('an emailed invitation previews without spending, accepts once into its role and waits for approval', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup)
    await company()
    const { cookie } = await signIn(client, owner)
    const sent = await invite(client, cookie, 'Clark.Kent@Wayne.example')
    sent.assertStatus(201)
    assert.include(sent.body(), { role: 'editor', preauthEmail: invitee, emailed: true })
    const listed = await asDataOwner(
      client.get(`/api/accounts/${accountId}/invites`),
      cookie
    ).send()
    assert.deepEqual(
      listed.body().invites.map((row: { preauthEmail: string }) => row.preauthEmail),
      [invitee]
    )
    const token = mail.tokenFor(invitee)
    for (let look = 0; look < 2; look++) {
      const preview = await client.get(`/api/invites/${token}/preview`).send()
      preview.assertStatus(200)
      assert.deepEqual(preview.body(), {
        accountId,
        accountName: 'Wayne Enterprises',
        role: 'editor',
        email: invitee,
      })
    }
    const before = await revision()
    const accepted = await accept(client, token)
    accepted.assertStatus(201)
    const userId = (accepted.body() as { user: { id: string } }).user.id
    assert.deepInclude(await db.from('memberships').where('user_id', userId).first(), {
      account_id: accountId,
      role: 'editor',
      status: 'active',
    })
    assert.equal(await revision(), before + 1)
    assert.isNotNull(
      await db
        .from('audit_entries')
        .where({ action: 'invitation.accepted', actor_id: userId })
        .first()
    )
    // Acceptance confirms the address; company data still waits for an Owner or Admin approval.
    rememberSessionCookie(accepted)
    const inviteeCookie = accepted.cookie('adonis-session')!.value
    const pending = await asDataOwner(client.get('/api/auth/me'), inviteeCookie).send()
    assert.isTrue(pending.body().emailVerified)
    assert.isFalse(pending.body().admission.admitted)
    const planning = () =>
      asDataOwner(client.get(`/api/accounts/${accountId}/planning`), inviteeCookie).send()
    await expectStatus(planning(), 403)
    const approved = await asDataOwner(
      client.post(`/api/admission/${userId}/approve`),
      cookie
    ).send()
    approved.assertStatus(200)
    await expectStatus(planning(), 200)
    await expectStatus(accept(client, token), 400)
    await expectStatus(client.get(`/api/invites/${token}/preview`).send(), 404)
  })

  test('only Owners and Admins invite, never as Owner, and never without mail', async ({
    client,
    assert,
    cleanup,
  }) => {
    await company()
    await member('diana.prince@wayne.example', 'admin')
    await member('barry.allen@wayne.example', 'editor')
    const { cookie: ownerCookie } = await signIn(client, owner)
    const unavailable = await invite(client, ownerCookie, invitee)
    unavailable.assertStatus(503)
    assert.equal((unavailable.body() as { code?: string }).code, 'MAIL_UNAVAILABLE')
    captureMail(cleanup)
    await expectStatus(invite(client, ownerCookie, invitee, 'owner'), 400)
    const { cookie: editorCookie } = await signIn(client, 'barry.allen@wayne.example')
    await expectStatus(invite(client, editorCookie, invitee), 403)
    const { cookie: adminCookie } = await signIn(client, 'diana.prince@wayne.example')
    await expectStatus(invite(client, adminCookie, invitee, 'admin'), 201)
    await expectStatus(invite(client, ownerCookie, 'diana.prince@wayne.example'), 409)
    assert.lengthOf(await db.from('account_invitations'), 1)
  })

  test('a failed invitation email reports the committed invitation without repeating it', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureMail(cleanup)
    await company()
    const { cookie } = await signIn(client, owner)
    const sendLater = mailService.sendLater
    mailService.sendLater = async () => {
      throw new Error('The mail transport refused the message.')
    }
    cleanup(() => {
      mailService.sendLater = sendLater
    })
    const sent = await invite(client, cookie, invitee)
    sent.assertStatus(202)
    assert.deepEqual(sent.body(), { committed: true, emailed: false })
    assert.lengthOf(await db.from('account_invitations'), 1)
    const listed = await asDataOwner(
      client.get(`/api/accounts/${accountId}/invites`),
      cookie
    ).send()
    const { id } = (listed.body() as { invites: { id: number }[] }).invites[0]
    const resent = await asDataOwner(
      client.post(`/api/accounts/${accountId}/invites/${id}/resend`),
      cookie
    ).send()
    resent.assertStatus(202)
    assert.deepEqual(resent.body(), { committed: true, emailed: false })
  })

  test('an acceptance whose follow-up failed sends the person to sign in', async ({
    client,
    cleanup,
    assert,
  }) => {
    const original = accountKit.invitations.accept
    accountKit.invitations.accept = async () => {
      throw new DeliveryError('The welcome notification failed.')
    }
    cleanup(() => {
      accountKit.invitations.accept = original
    })
    const accepted = await accept(client, 'committed-token')
    accepted.assertStatus(202)
    assert.deepEqual(accepted.body(), { accepted: true, signInRequired: true })
  })

  test('accepting an invitation for an existing identity keeps the product 409 response', async ({
    client,
    cleanup,
    assert,
  }) => {
    const original = accountKit.invitations.accept
    accountKit.invitations.accept = async () => {
      throw new RegistrationEmailAlreadyRegisteredError()
    }
    cleanup(() => {
      accountKit.invitations.accept = original
    })

    const response = await accept(client, 'existing-identity-token')

    response.assertStatus(409)
    assert.deepEqual(response.body(), {
      error: 'An account already uses this email. Sign in instead.',
      code: 'EMAIL_REGISTERED',
    })
    assert.equal(response.header('cache-control'), 'no-store')
    assert.equal(response.header('referrer-policy'), 'no-referrer')
  })

  test('a resent invitation replaces its link and a revoked one stops working', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup)
    await company()
    const { cookie } = await signIn(client, owner)
    const sent = await invite(client, cookie, invitee)
    const first = mail.tokenFor(invitee)
    const { id } = sent.body() as { id: number }
    const resent = await asDataOwner(
      client.post(`/api/accounts/${accountId}/invites/${id}/resend`),
      cookie
    ).send()
    resent.assertStatus(200)
    const second = mail.tokenFor(invitee)
    assert.notEqual(second, first)
    await expectStatus(client.get(`/api/invites/${first}/preview`).send(), 404)
    env.set('CAPACITYLENS_MAIL_HOST', '')
    const unavailable = await asDataOwner(
      client.post(`/api/accounts/${accountId}/invites/${id}/resend`),
      cookie
    ).send()
    unavailable.assertStatus(503)
    assert.equal((unavailable.body() as { code?: string }).code, 'MAIL_UNAVAILABLE')
    env.set('CAPACITYLENS_MAIL_HOST', 'mail.wayne.example')
    await expectStatus(client.get(`/api/invites/${second}/preview`).send(), 200)
    const revoked = await asDataOwner(
      client.delete(`/api/accounts/${accountId}/invites/${id}`),
      cookie
    ).send()
    revoked.assertStatus(204)
    await expectStatus(accept(client, second), 400)
    assert.lengthOf(await db.from('users').where('email', invitee), 0)
  })

  test('concurrent acceptances of one link create one identity and one membership', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup)
    await company()
    const { cookie } = await signIn(client, owner)
    await invite(client, cookie, invitee)
    const token = mail.tokenFor(invitee)
    const results = await Promise.all([accept(client, token), accept(client, token)])
    assert.deepEqual(results.map((result) => result.status()).sort(), [201, 400])
    assert.lengthOf(await db.from('users').where('email', invitee), 1)
    assert.lengthOf(await db.from('memberships').where('account_id', accountId), 2)
  })

  test('a sender demoted after manager approval cannot insert or email an invitation', async ({
    client,
    assert,
    cleanup,
  }) => {
    captureMail(cleanup)
    const send = mailService.send
    let sent = 0
    mailService.send = async (...args: Parameters<typeof mailService.send>) => {
      sent += 1
      return send.apply(mailService, args)
    }
    await company()
    const adminId = await member('diana.prince@wayne.example', 'admin')
    const { cookie } = await signIn(client, 'diana.prince@wayne.example')
    const original = accountKit.invitations.send.bind(accountKit.invitations)
    const barrier = requestBarrier()
    accountKit.invitations.send = async (...args) => {
      await barrier.pause()
      return original(...args)
    }
    const audits = await db.from('audit_entries')
    const before = await revision()
    const pending = invite(client, cookie, invitee)
    try {
      await barrier.entered()
      await db.from('memberships').where('user_id', adminId).update({ role: 'viewer' })
      barrier.release()
      const refused = await pending
      refused.assertStatus(403)
      assert.lengthOf(await db.from('account_invitations'), 0)
      assert.equal(sent, 0)
      assert.equal(await revision(), before)
      assert.deepEqual(await db.from('audit_entries'), audits)
    } finally {
      barrier.release()
      accountKit.invitations.send = original
      mailService.send = send
      await pending
    }
  })

  test('an address the company removed cannot rejoin through an invitation', async ({
    client,
    assert,
    cleanup,
  }) => {
    const mail = captureMail(cleanup)
    await company()
    const now = new Date().toISOString()
    await db.table('account_access_restrictions').insert({
      id: crypto.randomUUID(),
      account_id: accountId,
      principal_id: crypto.randomUUID(),
      verified_email: invitee,
      role: 'editor',
      created_at: now,
    })
    const { cookie } = await signIn(client, owner)
    await invite(client, cookie, invitee)
    const refused = await accept(client, mail.tokenFor(invitee))
    refused.assertStatus(403)
    assert.lengthOf(await db.from('users').where('email', invitee), 0)
    assert.lengthOf(await db.from('memberships').where('account_id', accountId), 1)
  })
})
