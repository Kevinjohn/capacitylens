import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { seed } from '@capacitylens/shared/data/seed'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { encodeRow, resetState } from '#services/state_repository'

const setupToken = 'ownership-setup-token-0123456789abcdef'
const password = 'batman-secret-2026'

async function principalId(email: string) {
  const row = await db.from('users').where('email', email).first()
  if (!row) throw new Error(`Missing test principal: ${email}`)
  return String(row.id)
}

async function fixture(client: ApiClient) {
  const owner = await client
    .post('/api/auth/sign-up')
    .header('x-capacitylens-setup-token', setupToken)
    .json({ email: 'bruce.wayne@wayne.example', password, name: 'Bruce Wayne' })
    .send()
  owner.assertStatus(201)
  const ownerCookie = owner.cookie('adonis-session')!.value
  const org = await signed(client.post('/api/orgs'), ownerCookie)
    .json({ id: 'a-studio', name: 'Wayne Enterprises' })
    .send()
  org.assertStatus(201)
  const admin = await client
    .post('/api/auth/sign-up')
    .json({ email: 'clark.kent@wayne.example', password, name: 'Clark Kent' })
    .send()
  admin.assertStatus(201)
  const adminCookie = admin.cookie('adonis-session')!.value
  const ownerId = await principalId('bruce.wayne@wayne.example')
  const adminId = await principalId('clark.kent@wayne.example')
  const now = new Date().toISOString()
  await db.table('memberships').insert({
    id: 'member-clark',
    account_id: 'a-studio',
    user_id: adminId,
    role: 'admin',
    status: 'active',
    created_at: now,
    updated_at: now,
  })
  return { ownerId, adminId, ownerCookie, adminCookie, now }
}

function signed<
  T extends { setup(callback: () => void): T; withCookie(name: string, value: string): T },
>(request: T, cookie: string): T {
  return request.setup(() => {
    request.withCookie('adonis-session', cookie)
  })
}

async function transferProof(client: ApiClient, cookie: string, toUserId: string) {
  const result = await signed(client.post('/api/auth/action-proof/password'), cookie)
    .header('sec-fetch-site', 'same-origin')
    .json({ action: 'transfer-ownership', accountId: 'a-studio', intent: { toUserId }, password })
    .send()
  result.assertStatus(200)
  return (result.body() as { proofId: string }).proofId
}

test.group('atomic ownership transfer', (group) => {
  group.setup(() => {
    const previous = {
      mode: env.get('CAPACITYLENS_MODE'),
      setup: env.get('CAPACITYLENS_SETUP_TOKEN'),
      signup: env.get('CAPACITYLENS_ALLOW_OPEN_SIGNUP'),
    }
    env.set('CAPACITYLENS_MODE', 'password-only')
    env.set('CAPACITYLENS_SETUP_TOKEN', setupToken)
    env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', true)
    return () => {
      env.set('CAPACITYLENS_MODE', previous.mode)
      env.set('CAPACITYLENS_SETUP_TOKEN', previous.setup)
      env.set('CAPACITYLENS_ALLOW_OPEN_SIGNUP', previous.signup)
    }
  })
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await db.from('user_session_index').delete()
    await db.from('adonis_sessions').delete()
    await db.from('users').delete()
  })

  test('retired and unknown lifecycle actions return 404 before body validation', async ({
    client,
  }) => {
    const { adminId, ownerCookie } = await fixture(client)
    const retired = await signed(
      client.post('/api/accounts/a-studio/transfer-ownership'),
      ownerCookie
    )
      .json({ toUserId: adminId })
      .send()
    retired.assertStatus(404)
    const unknown = await signed(client.post('/api/accounts/a-studio/unknown-action'), ownerCookie)
      .json({})
      .send()
    unknown.assertStatus(404)
    const retiredCompanyArchive = await signed(
      client.post('/api/accounts/a-studio/archive'),
      ownerCookie
    )
      .json({})
      .send()
    retiredCompanyArchive.assertStatus(404)
  })

  test('swaps exactly one Owner, burns both recovery links and replays the same receipt after demotion', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie, now } = await fixture(client)
    const otherCompany = { ...seed().accounts[0]!, id: 'a-loft', name: 'Stark Industries' }
    await db.table('accounts').insert(encodeRow('accounts', otherCompany))
    await db
      .table('clients')
      .insert(encodeRow('clients', { ...buildInternalClient('a-loft', now) }))
    await db.table('memberships').insert([
      {
        id: 'owner-clark-loft',
        account_id: 'a-loft',
        user_id: ownerId,
        role: 'owner',
        status: 'active',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'member-clark-loft',
        account_id: 'a-loft',
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
      'x-account-command-id': 'ownership-transfer-command-0001',
      'idempotency-key': 'ownership-transfer-key-0001',
    }
    const proofId = await transferProof(client, ownerCookie, adminId)
    const transfer = (toUserId: string) =>
      signed(client.post('/api/accounts/a-studio/ownership-transfer'), ownerCookie)
        .headers(command)
        .json({ toUserId, proofId })
        .send()
    const completed = await transfer(adminId)
    completed.assertStatus(200)
    assert.deepEqual(completed.body(), { fromUserId: ownerId, toUserId: adminId })
    const roles = await db
      .from('memberships')
      .where('account_id', 'a-studio')
      .select('user_id', 'role')
    assert.equal(roles.find((row) => row.user_id === ownerId)?.role, 'admin')
    assert.equal(roles.find((row) => row.user_id === adminId)?.role, 'owner')
    assert.equal(roles.filter((row) => row.role === 'owner').length, 1)
    assert.lengthOf(
      await db.from('password_reset_tokens').whereIn('tokenable_id', [ownerId, adminId]),
      0
    )
    const replay = await transfer(adminId)
    replay.assertStatus(200)
    assert.deepEqual(replay.body(), completed.body())
    const mismatch = await transfer(ownerId)
    mismatch.assertStatus(409)
    const differentCompany = await signed(
      client.post('/api/accounts/a-loft/ownership-transfer'),
      ownerCookie
    )
      .headers(command)
      .json({ toUserId: adminId })
      .send()
    differentCompany.assertStatus(409)
    const audits = await db
      .from('audit_entries')
      .where({ account_id: 'a-studio', action: 'ownership.transferred' })
    assert.lengthOf(audits, 1)
    assert.equal(audits[0].actor_id, ownerId)
    assert.equal(audits[0].entity_id, adminId)
  })

  test('refuses stale, non-Owner, self, ineligible and out-of-company requests', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie, adminCookie } = await fixture(client)
    const unsigned = await client
      .post('/api/accounts/a-studio/ownership-transfer')
      .json({ toUserId: adminId })
      .send()
    unsigned.assertStatus(401)
    const post = (cookie: string, accountId: string, toUserId: string) =>
      signed(client.post(`/api/accounts/${accountId}/ownership-transfer`), cookie)
        .json({ toUserId })
        .send()
    const missingProof = await post(ownerCookie, 'a-studio', adminId)
    missingProof.assertStatus(403)
    assert.equal((missingProof.body() as unknown as { code: string }).code, 'ACTION_PROOF_REQUIRED')
    const nonOwner = await post(adminCookie, 'a-studio', ownerId)
    nonOwner.assertStatus(403)
    const self = await post(ownerCookie, 'a-studio', ownerId)
    self.assertStatus(409)
    const absent = await post(ownerCookie, 'a-studio', 'missing-principal')
    absent.assertStatus(404)
    const wrongCompany = await post(ownerCookie, 'a-missing', adminId)
    wrongCompany.assertStatus(404)
    const legacyBody = await signed(
      client.post('/api/accounts/a-studio/ownership-transfer'),
      ownerCookie
    )
      .json({ toUserId: adminId, expectedRevision: 'old-ceremony' })
      .send()
    legacyBody.assertStatus(400)
    const unpaired = await signed(
      client.post('/api/accounts/a-studio/ownership-transfer'),
      ownerCookie
    )
      .header('x-account-command-id', 'ownership-unpaired-command-0001')
      .json({ toUserId: adminId })
      .send()
    unpaired.assertStatus(400)
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: adminId })
      .update({ status: 'disabled' })
    const inactive = await post(ownerCookie, 'a-studio', adminId)
    inactive.assertStatus(409)
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: adminId })
      .update({ status: 'active' })
    await db.table('account_access_restrictions').insert({
      id: 'restrict-clark',
      account_id: 'a-studio',
      principal_id: adminId,
      verified_email: null,
      role: 'admin',
      created_at: new Date().toISOString(),
    })
    const restricted = await post(ownerCookie, 'a-studio', adminId)
    restricted.assertStatus(409)
    const ownerAfterRefusal = await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: ownerId })
      .first()
    assert.equal(ownerAfterRefusal.role, 'owner')
    assert.lengthOf(
      await db.from('command_results').where('operation', 'like', 'semantic:transfer-ownership:%'),
      0
    )
  })

  test('masquerade is read-only and duplicate command identities cannot cross actors', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie, adminCookie } = await fixture(client)
    const command = {
      'x-account-command-id': 'ownership-cross-actor-command-0001',
      'idempotency-key': 'ownership-cross-actor-key-0001',
    }
    const proofId = await transferProof(client, ownerCookie, adminId)
    const ownerRequest = () =>
      signed(client.post('/api/accounts/a-studio/ownership-transfer'), ownerCookie)
        .headers(command)
        .json({ toUserId: adminId, proofId })
        .send()
    const started = await signed(client.post('/api/accounts/a-studio/masquerade'), ownerCookie)
      .json({ targetUserId: adminId })
      .send()
    started.assertStatus(200)
    const refused = await ownerRequest()
    refused.assertStatus(403)
    assert.equal((refused.body() as { code: string }).code, 'MASQUERADE_READ_ONLY')
    const token = (started.body() as { token: string }).token
    const ended = await signed(client.delete('/api/masquerade'), ownerCookie)
      .json({ token, reason: 'explicit' })
      .send()
    ended.assertStatus(204)
    const completed = await ownerRequest()
    completed.assertStatus(200)
    const otherActor = await signed(
      client.post('/api/accounts/a-studio/ownership-transfer'),
      adminCookie
    )
      .headers(command)
      .json({ toUserId: ownerId })
      .send()
    otherActor.assertStatus(409)
    assert.lengthOf(await db.from('audit_entries').where({ action: 'ownership.transferred' }), 1)
  })

  test('promotion and audit faults roll back both roles, recovery tokens and command receipts', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie, now } = await fixture(client)
    const proofId = await transferProof(client, ownerCookie, adminId)
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
      signed(client.post('/api/accounts/a-studio/ownership-transfer'), ownerCookie)
        .headers({
          'x-account-command-id': `ownership-fault-command-${suffix}`,
          'idempotency-key': `ownership-fault-key-${suffix}`,
        })
        .json({ toUserId: adminId, proofId })
        .send()
    const assertions = async (suffix: string) => {
      const owner = await db
        .from('memberships')
        .where({ account_id: 'a-studio', user_id: ownerId })
        .first()
      const admin = await db
        .from('memberships')
        .where({ account_id: 'a-studio', user_id: adminId })
        .first()
      assert.equal(owner.role, 'owner')
      assert.equal(admin.role, 'admin')
      assert.lengthOf(
        await db.from('password_reset_tokens').whereIn('tokenable_id', [ownerId, adminId]),
        2
      )
      assert.isNull(
        await db
          .from('command_results')
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
      "CREATE TRIGGER fail_ownership_receipt BEFORE UPDATE OF result ON command_results WHEN NEW.operation LIKE 'semantic:transfer-ownership:%' BEGIN SELECT RAISE(ABORT, 'forced receipt failure'); END"
    )
    try {
      const failed = await tryTransfer('receipt')
      assert.isAtLeast(failed.status(), 500)
      await assertions('receipt')
    } finally {
      await db.rawQuery('DROP TRIGGER IF EXISTS fail_ownership_receipt')
    }
  })

  test('two distinct concurrent commands produce one swap and one refused stale authority', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie } = await fixture(client)
    const proofId = await transferProof(client, ownerCookie, adminId)
    const request = (suffix: string) =>
      signed(client.post('/api/accounts/a-studio/ownership-transfer'), ownerCookie)
        .headers({
          'x-account-command-id': `ownership-race-command-${suffix}`,
          'idempotency-key': `ownership-race-key-${suffix}`,
        })
        .json({ toUserId: adminId, proofId })
        .send()
    const responses = await Promise.all([request('first'), request('second')])
    assert.deepEqual(responses.map((response) => response.status()).sort(), [200, 403])
    assert.lengthOf(
      await db
        .from('memberships')
        .where({ account_id: 'a-studio', role: 'owner', status: 'active' }),
      1
    )
    const formerOwner = await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: ownerId })
      .first()
    const newOwner = await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: adminId })
      .first()
    assert.equal(formerOwner.role, 'admin')
    assert.equal(newOwner.role, 'owner')
    assert.lengthOf(await db.from('audit_entries').where({ action: 'ownership.transferred' }), 1)
    assert.lengthOf(
      await db.from('command_results').where('operation', 'like', 'semantic:transfer-ownership:%'),
      1
    )
  })

  test('a broken multiple-Owner invariant fails closed before any transfer effect', async ({
    client,
    assert,
  }) => {
    const { ownerId, adminId, ownerCookie } = await fixture(client)
    const proofId = await transferProof(client, ownerCookie, adminId)
    await db
      .from('memberships')
      .where({ account_id: 'a-studio', user_id: adminId })
      .update({ role: 'owner' })
    const rejected = await signed(
      client.post('/api/accounts/a-studio/ownership-transfer'),
      ownerCookie
    )
      .headers({
        'x-account-command-id': 'ownership-broken-owner-command-0001',
        'idempotency-key': 'ownership-broken-owner-key-0001',
      })
      .json({ toUserId: adminId, proofId })
      .send()
    assert.isAtLeast(rejected.status(), 500)
    const owners = await db.from('memberships').where({ account_id: 'a-studio', role: 'owner' })
    assert.deepEqual(new Set(owners.map((row) => row.user_id)), new Set([ownerId, adminId]))
    assert.isNull(
      await db
        .from('command_results')
        .where('command_id', 'ownership-broken-owner-command-0001')
        .first()
    )
    assert.lengthOf(await db.from('audit_entries').where({ action: 'ownership.transferred' }), 0)
  })
})
