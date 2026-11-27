import { test } from '@japa/runner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { insertProductRows } from '#tests/helpers/product_rows'
import { resetState } from '#tests/helpers/state_fixture'
import { asDataOwner, asLoggedInDataOwner } from '#tests/helpers/authenticated_data_fixture'
import { createIdentity } from '#tests/helpers/identities'
import User from '#models/user'
import { password } from '#tests/helpers/membership/members'
import { failedFields, ownershipFixture, transferProof } from '#tests/helpers/membership/ownership'

test.group('atomic ownership transfer', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('account_admissions').delete()
    await db.from('account_invitations').delete()
    await db.from('adonis_sessions').delete()
    await db.from('memberships').delete()
    await db.from('users').delete()
  })

  test('a wrong-action password confirmation cannot authorize ownership transfer', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie } = await ownershipFixture(client)
    const issued = await asDataOwner(client.visit('api.password_confirmations.store'), ownerCookie)
      .json({ action: 'anonymise', companyId: 'a-studio', intent: {}, password })
      .send()
    issued.assertStatus(200)
    const response = await asDataOwner(
      client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
      ownerCookie
    )
      .json({ toUserId: adminId, confirmationId: issued.body().data.confirmationId })
      .send()
    response.assertStatus(403)
    assert.deepEqual(response.body(), {
      error: 'Confirm this action again.',
      code: 'PASSWORD_CONFIRMATION_REQUIRED',
    })
    const owner = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: ownerId })
      .firstOrFail()
    assert.equal(owner.role, 'owner')
    assert.lengthOf(await db.from('audit_entries').where('action', 'ownership.transferred'), 0)
  })

  test('retired and unknown lifecycle actions return 404 before body validation', async ({
    client,
  }) => {
    const { ownerId, adminId } = await ownershipFixture(client)
    const ownerUser = await User.findOrFail(ownerId)
    const retired = await asLoggedInDataOwner(
      client.post('/api/v1/companies/a-studio/transfer-ownership'),
      ownerUser
    )
      .json({ toUserId: adminId })
      .send()
    retired.assertStatus(404)
    const unknown = await asLoggedInDataOwner(
      client.post('/api/v1/companies/a-studio/unknown-action'),
      ownerUser
    )
      .json({})
      .send()
    unknown.assertStatus(404)
    const retiredCompanyArchive = await asLoggedInDataOwner(
      client.post('/api/v1/companies/a-studio/archive'),
      ownerUser
    )
      .json({})
      .send()
    retiredCompanyArchive.assertStatus(404)
  })

  test('swaps exactly one Owner, keeps both recovery links and replays the same receipt after demotion', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie, now } = await ownershipFixture(client)
    const otherCompany = { ...seed().companies[0]!, id: 'a-loft', name: 'Stark Industries' }
    await insertProductRows('companies', [otherCompany])
    await insertProductRows('clients', [buildInternalClient('a-loft', now)])
    await db.table('memberships').insert([
      {
        scope_id: 'a-loft',
        user_id: ownerId,
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        scope_id: 'a-loft',
        user_id: adminId,
        role: 'admin',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
    ])
    for (const [id, email] of [
      [ownerId, 'bruce.wayne@wayne.example'],
      [adminId, 'clark.kent@wayne.example'],
    ])
      await db.table('password_reset_tokens').insert({
        tokenable_id: id,
        email,
        hash: (id === ownerId ? 'a' : 'b').repeat(64),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        created_at: now,
      })
    const command = {
      'x-account-operation-id': 'ownership-transfer-command-0001',
      'idempotency-key': 'ownership-transfer-key-0001',
    }
    const confirmationId = await transferProof(client, ownerCookie, adminId)
    const transfer = (toUserId: string) =>
      asDataOwner(
        client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
        ownerCookie
      )
        .headers(command)
        .json({ toUserId, confirmationId })
        .send()
    const completed = await transfer(adminId)
    completed.assertStatus(200)
    assert.deepEqual(completed.body().data, { fromUserId: ownerId, toUserId: adminId })
    const roles = await db
      .from('memberships')
      .where('scope_id', 'a-studio')
      .select('user_id', 'role')
    assert.equal(roles.find((row) => row.user_id === ownerId)?.role, 'admin')
    assert.equal(roles.find((row) => row.user_id === adminId)?.role, 'owner')
    assert.equal(roles.filter((row) => row.role === 'owner').length, 1)
    assert.lengthOf(
      await db.from('password_reset_tokens').whereIn('tokenable_id', [ownerId, adminId]),
      2,
      'a role change never cancels identity recovery'
    )
    const replay = await transfer(adminId)
    replay.assertStatus(200)
    assert.deepEqual(replay.body().data, completed.body().data)
    const mismatch = await transfer(ownerId)
    mismatch.assertStatus(409)
    const differentCompany = await asDataOwner(
      client.visit('api.ownership_transfers.store', { companyId: 'a-loft' }),
      ownerCookie
    )
      .headers(command)
      .json({ toUserId: adminId })
      .send()
    differentCompany.assertStatus(409)
    const audits = await db
      .from('audit_entries')
      .where({ company_id: 'a-studio', action: 'ownership.transferred' })
    assert.lengthOf(audits, 1)
    assert.equal(audits[0].actor_id, ownerId)
    assert.equal(audits[0].entity_id, adminId)
  })

  test('refuses stale, non-Owner, self, ineligible and out-of-company requests', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie, adminCookie } = await ownershipFixture(client)
    const ownerUser = await User.findOrFail(ownerId)
    const unsigned = await client
      .visit('api.ownership_transfers.store', { companyId: 'a-studio' })
      .header('sec-fetch-site', 'same-origin')
      .json({ toUserId: adminId })
      .send()
    unsigned.assertStatus(401)
    const post = (cookie: string, companyId: string, toUserId: string) =>
      asDataOwner(client.visit('api.ownership_transfers.store', { companyId }), cookie)
        .json({ toUserId })
        .send()
    const missingProof = await post(ownerCookie, 'a-studio', adminId)
    missingProof.assertStatus(403)
    assert.equal(
      (missingProof.body() as unknown as { code: string }).code,
      'PASSWORD_CONFIRMATION_REQUIRED'
    )
    const nonOwner = await post(adminCookie, 'a-studio', ownerId)
    nonOwner.assertStatus(403)
    const self = await post(ownerCookie, 'a-studio', ownerId)
    self.assertStatus(409)
    const absent = await post(ownerCookie, 'a-studio', 'missing-user')
    absent.assertStatus(404)
    // An unknown company answers exactly like a company the caller holds no access in.
    const wrongCompany = await post(ownerCookie, 'a-missing', adminId)
    wrongCompany.assertStatus(403)
    assert.deepEqual(wrongCompany.body(), nonOwner.body())
    const legacyBody = await asLoggedInDataOwner(
      client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
      ownerUser
    )
      .json({ toUserId: adminId, expectedRevision: 'old-ceremony' } as never)
      .send()
    legacyBody.assertStatus(422)
    const unpaired = await asLoggedInDataOwner(
      client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
      ownerUser
    )
      .header('x-account-operation-id', 'ownership-unpaired-command-0001')
      .json({ toUserId: adminId })
      .send()
    unpaired.assertStatus(422)
    assert.deepEqual(failedFields(unpaired.body()), ['headers.idempotency-key'])
    const malformedKey = await asLoggedInDataOwner(
      client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
      ownerUser
    )
      .header('x-account-operation-id', 'ownership-malformed-command-0001')
      .header('idempotency-key', 'short')
      .json({ toUserId: adminId })
      .send()
    malformedKey.assertStatus(422)
    assert.deepEqual(failedFields(malformedKey.body()), ['headers.idempotency-key'])
    await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: adminId })
      .update({ status: 'suspended' })
    const inactive = await post(ownerCookie, 'a-studio', adminId)
    inactive.assertStatus(409)
    const ownerAfterRefusal = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: ownerId })
      .first()
    assert.equal(ownerAfterRefusal.role, 'owner')
    assert.lengthOf(
      await db
        .from('request_receipts')
        .whereRaw("json_extract(operation, '$[0]') = ?", ['transfer-ownership']),
      0
    )
  })

  test('masquerade is read-only and command identities are scoped to each actor', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie, adminCookie } = await ownershipFixture(client)
    const command = {
      'x-account-operation-id': 'ownership-cross-actor-command-0001',
      'idempotency-key': 'ownership-cross-actor-key-0001',
    }
    const confirmationId = await transferProof(client, ownerCookie, adminId)
    const ownerRequest = () =>
      asDataOwner(
        client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
        ownerCookie
      )
        .headers(command)
        .json({ toUserId: adminId, confirmationId })
        .send()
    const started = await asDataOwner(
      client.visit('api.masquerade.store', { companyId: 'a-studio' }),
      ownerCookie
    )
      .json({ targetUserId: adminId })
      .send()
    started.assertStatus(200)
    const refused = await ownerRequest()
    refused.assertStatus(403)
    assert.equal((refused.body() as unknown as { code: string }).code, 'MASQUERADE_READ_ONLY')
    const token = ((started.body() as { data: unknown }).data as { token: string }).token
    const ended = await asDataOwner(client.visit('api.masquerade.destroy'), ownerCookie)
      .json({ token, reason: 'explicit' })
      .send()
    ended.assertStatus(200)
    const completed = await ownerRequest()
    completed.assertStatus(200)
    const otherActor = await asDataOwner(
      client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
      adminCookie
    )
      .headers(command)
      .json({ toUserId: ownerId })
      .send()
    otherActor.assertStatus(403)
    assert.deepEqual(otherActor.body(), {
      error: 'Confirm this action again.',
      code: 'PASSWORD_CONFIRMATION_REQUIRED',
    })
    assert.lengthOf(await db.from('audit_entries').where({ action: 'ownership.transferred' }), 1)
    const reverseProof = await transferProof(client, adminCookie, ownerId)
    const reverse = () =>
      asDataOwner(
        client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
        adminCookie
      )
        .headers(command)
        .json({ toUserId: ownerId, confirmationId: reverseProof })
        .send()
    const reversed = await reverse()
    reversed.assertStatus(200)
    assert.deepEqual(reversed.body().data, { fromUserId: adminId, toUserId: ownerId })
    const replay = await reverse()
    replay.assertStatus(200)
    assert.deepEqual(replay.body().data, reversed.body().data)
    assert.lengthOf(await db.from('audit_entries').where({ action: 'ownership.transferred' }), 2)
    assert.lengthOf(
      await db
        .from('request_receipts')
        .where({ scope_id: 'a-studio', command_id: command['x-account-operation-id'] }),
      2
    )
  })

  test('promotion and audit faults roll back both roles and command receipts', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie, now } = await ownershipFixture(client)
    const confirmationId = await transferProof(client, ownerCookie, adminId)
    const revisionBefore = await db
      .from('company_planning_revisions')
      .where('company_id', 'a-studio')
      .first()
    for (const [id, email] of [
      [ownerId, 'bruce.wayne@wayne.example'],
      [adminId, 'clark.kent@wayne.example'],
    ])
      await db.table('password_reset_tokens').insert({
        tokenable_id: id,
        email,
        hash: (id === ownerId ? 'a' : 'b').repeat(64),
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        created_at: now,
      })
    const tryTransfer = (suffix: string) =>
      asDataOwner(
        client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
        ownerCookie
      )
        .headers({
          'x-account-operation-id': `ownership-fault-command-${suffix}`,
          'idempotency-key': `ownership-fault-key-${suffix}`,
        })
        .json({ toUserId: adminId, confirmationId })
        .send()
    const assertions = async (suffix: string) => {
      const owner = await db
        .from('memberships')
        .where({ scope_id: 'a-studio', user_id: ownerId })
        .first()
      const admin = await db
        .from('memberships')
        .where({ scope_id: 'a-studio', user_id: adminId })
        .first()
      assert.equal(owner.role, 'owner')
      assert.equal(admin.role, 'admin')
      assert.deepEqual(
        await db.from('company_planning_revisions').where('company_id', 'a-studio').first(),
        revisionBefore
      )
      const proof = await db.from('password_confirmations').where('id', confirmationId).first()
      assert.isNotNull(proof)
      assert.isNull(proof.consumed_at)
      assert.lengthOf(
        await db.from('password_reset_tokens').whereIn('tokenable_id', [ownerId, adminId]),
        2
      )
      assert.isNull(
        await db
          .from('request_receipts')
          .where('command_id', `ownership-fault-command-${suffix}`)
          .first()
      )
      assert.lengthOf(await db.from('audit_entries').where({ action: 'ownership.transferred' }), 0)
    }
    await db.rawQuery(
      `CREATE TRIGGER fail_owner_promotion BEFORE UPDATE OF role ON memberships WHEN OLD.user_id = '${adminId}' AND NEW.role = 'owner' BEGIN SELECT RAISE(ABORT, 'forced promotion failure'); END`
    )
    try {
      const failed = await tryTransfer('promotion')
      assert.isAtLeast(failed.status(), 500)
      await assertions('promotion')
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_owner_promotion')
    }
    await db.rawQuery(
      "CREATE TRIGGER fail_ownership_audit BEFORE INSERT ON audit_entries WHEN NEW.action = 'ownership.transferred' BEGIN SELECT RAISE(ABORT, 'forced audit failure'); END"
    )
    try {
      const failed = await tryTransfer('audit')
      assert.isAtLeast(failed.status(), 500)
      await assertions('audit')
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_ownership_audit')
    }
    await db.rawQuery(
      "CREATE TRIGGER fail_ownership_receipt BEFORE UPDATE OF result ON request_receipts WHEN json_extract(NEW.operation, '$[0]') = 'transfer-ownership' BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END"
    )
    try {
      const failed = await tryTransfer('receipt')
      assert.isAtLeast(failed.status(), 500)
      await assertions('receipt')
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_ownership_receipt')
    }
    const retried = await tryTransfer('receipt')
    retried.assertStatus(200)
    assert.deepEqual(retried.body().data, { fromUserId: ownerId, toUserId: adminId })
  })

  test('two distinct concurrent commands produce one swap and one refused stale access', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie } = await ownershipFixture(client)
    const confirmationId = await transferProof(client, ownerCookie, adminId)
    const request = (suffix: string) =>
      asDataOwner(
        client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
        ownerCookie
      )
        .headers({
          'x-account-operation-id': `ownership-race-command-${suffix}`,
          'idempotency-key': `ownership-race-key-${suffix}`,
        })
        .json({ toUserId: adminId, confirmationId })
        .send()
    const responses = await Promise.all([request('first'), request('second')])
    assert.deepEqual(responses.map((response) => response.status()).sort(), [200, 403])
    assert.lengthOf(
      await db.from('memberships').where({ scope_id: 'a-studio', role: 'owner', status: 'active' }),
      1
    )
    const formerOwner = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: ownerId })
      .first()
    const newOwner = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: adminId })
      .first()
    assert.equal(formerOwner.role, 'admin')
    assert.equal(newOwner.role, 'owner')
    assert.lengthOf(await db.from('audit_entries').where({ action: 'ownership.transferred' }), 1)
    assert.lengthOf(
      await db
        .from('request_receipts')
        .whereRaw("json_extract(operation, '$[0]') = ?", ['transfer-ownership']),
      1
    )
  })

  test('a broken multiple-Owner invariant fails closed before any transfer effect', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie, now } = await ownershipFixture(client)
    const confirmationId = await transferProof(client, ownerCookie, adminId)
    // A second stored Owner who is neither the actor nor the nominee.
    const extraOwnerId = await createIdentity('diana.prince@wayne.example', {
      name: 'Diana Prince',
    })
    await db.table('memberships').insert({
      scope_id: 'a-studio',
      user_id: extraOwnerId,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const rejected = await asDataOwner(
      client.visit('api.ownership_transfers.store', { companyId: 'a-studio' }),
      ownerCookie
    )
      .headers({
        'x-account-operation-id': 'ownership-broken-owner-command-0001',
        'idempotency-key': 'ownership-broken-owner-key-0001',
      })
      .json({ toUserId: adminId, confirmationId })
      .send()
    assert.isAtLeast(rejected.status(), 500)
    const owners = await db.from('memberships').where({ scope_id: 'a-studio', role: 'owner' })
    assert.deepEqual(new Set(owners.map((row) => row.user_id)), new Set([ownerId, extraOwnerId]))
    const nominee = await db
      .from('memberships')
      .where({ scope_id: 'a-studio', user_id: adminId })
      .first()
    assert.equal(nominee.role, 'admin')
    assert.isNull(
      await db
        .from('request_receipts')
        .where('command_id', 'ownership-broken-owner-command-0001')
        .first()
    )
    assert.lengthOf(await db.from('audit_entries').where({ action: 'ownership.transferred' }), 0)
  })
})
