import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { asDataOwner, resetAuthenticatedData } from '../helpers/authenticated_data_fixture.js'
import { freshDatabase } from '../helpers/fresh_database.js'
import type { ApiClient } from '@japa/api-client'
import { randomUUID } from 'node:crypto'
import { withTransaction } from '#services/with_transaction'
import { getPlanningRevision } from '#services/planning_revision'

const accountId = 'a-studio'

async function proof(client: ApiClient, cookie: string) {
  const issued = await asDataOwner(client.post('/api/auth/action-proof/password'), cookie)
    .json({ action: 'anonymise', accountId, intent: {}, password: 'fixture-password-2026' })
    .send()
  issued.assertStatus(200)
  return (issued.body() as { proofId: string }).proofId
}

test.group('company anonymisation', (group) => {
  group.setup(() => freshDatabase())

  test('retired generic lifecycle and company deletion routes are absent', async ({ client }) => {
    const { cookie } = await resetAuthenticatedData(client, true)
    for (const path of [
      '/api/resources/r-tyler/delete',
      '/api/resources/r-tyler/purge',
      '/api/resources/r-tyler/archive',
    ]) {
      const response = await asDataOwner(client.post(path), cookie).json({ accountId }).send()
      response.assertStatus(404)
    }
    const removed = await asDataOwner(client.delete(`/api/accounts/${accountId}`), cookie).send()
    removed.assertStatus(404)
  })

  test('resource anonymisation scrubs only its person and notes with one audit and revision', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client, true)
    const resources = await db.from('resources').where('account_id', accountId).limit(2)
    const target = resources[0]!
    const other = resources[1]!
    await db
      .from('resources')
      .where('id', target.id)
      .update({ avatar_url: 'https://example.invalid/avatar.png' })
    await db
      .from('allocations')
      .where({ account_id: accountId, resource_id: target.id })
      .limit(1)
      .update({ note: 'Private note' })
    const before = await withTransaction((trx) => getPlanningRevision(trx, accountId))
    const changed = await asDataOwner(
      client.post(`/api/accounts/${accountId}/resources/${target.id}/anonymise`),
      cookie
    )
      .json({})
      .send()
    changed.assertStatus(204)
    const scrubbed = await db.from('resources').where('id', target.id).first()
    assert.match(String(scrubbed.name), /^Removed person #/)
    assert.equal(scrubbed.role, 'Removed resource')
    assert.isNull(scrubbed.avatar_url)
    const untouched = await db.from('resources').where('id', other.id).first()
    assert.equal(untouched.name, other.name)
    assert.lengthOf(
      await db
        .from('allocations')
        .where({ account_id: accountId, resource_id: target.id })
        .whereNotNull('note'),
      0
    )
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, action: 'anonymise' }),
      1
    )
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, accountId)), before + 1)
  })

  test('an Editor cannot anonymise an individual resource', async ({ client, assert }) => {
    const { cookie, userId } = await resetAuthenticatedData(client, true)
    const target = await db.from('resources').where('account_id', accountId).first()
    await db
      .from('memberships')
      .where({ account_id: accountId, user_id: userId })
      .update({ role: 'editor' })
    const refused = await asDataOwner(
      client.post(`/api/accounts/${accountId}/resources/${target.id}/anonymise`),
      cookie
    )
      .json({})
      .send()
    refused.assertStatus(403)
    const unchanged = await db.from('resources').where('id', target.id).first()
    assert.equal(unchanged.name, target.name)
  })

  test('requires proof and scrubs all resources in one audited revision while retaining company identity', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client, true)
    const resource = await db.from('resources').where('account_id', accountId).first()
    await db.table('account_member_resources').insert({
      id: 'link-bruce-person',
      account_id: accountId,
      user_id: userId,
      resource_id: resource.id,
      revision: 'test',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    await db
      .from('resources')
      .where('id', resource.id)
      .update({ avatar_url: 'https://example.invalid/person.png' })
    await db
      .from('allocations')
      .where({ account_id: accountId, resource_id: resource.id })
      .limit(1)
      .update({ note: 'Sensitive allocation note' })
    await db
      .from('time_off')
      .where({ account_id: accountId, resource_id: resource.id })
      .limit(1)
      .update({ note: 'Sensitive time off note' })
    const before = await withTransaction((trx) => getPlanningRevision(trx, accountId))
    const missing = await asDataOwner(client.post(`/api/accounts/${accountId}/anonymise`), cookie)
      .json({ proofId: '' })
      .send()
    missing.assertStatus(403)
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, accountId)), before)
    const proofId = await proof(client, cookie)
    const applied = await asDataOwner(client.post(`/api/accounts/${accountId}/anonymise`), cookie)
      .json({ proofId })
      .send()
    applied.assertStatus(204)
    const resources = await db.from('resources').where('account_id', accountId)
    assert.isAbove(resources.length, 0)
    for (const savedResource of resources) {
      assert.match(String(savedResource.name), /^Removed person #/)
      assert.equal(savedResource.role, 'Removed resource')
      assert.isNull(savedResource.avatar_url)
    }
    assert.lengthOf(await db.from('deleted_groups').where('account_id', accountId), 0)
    assert.lengthOf(
      await db
        .from('allocations')
        .where({ account_id: accountId, resource_id: resource.id })
        .whereNotNull('note'),
      0
    )
    assert.lengthOf(
      await db
        .from('time_off')
        .where({ account_id: accountId, resource_id: resource.id })
        .whereNotNull('note'),
      0
    )
    assert.lengthOf(await db.from('accounts').where('id', accountId), 1)
    const memberships = await db.from('memberships').where('account_id', accountId)
    assert.isAbove(memberships.length, 0)
    assert.lengthOf(await db.from('account_member_resources').where('id', 'link-bruce-person'), 1)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, action: 'anonymise' }),
      1
    )
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, accountId)), before + 1)
  })

  test('a failed audit write rolls back the scrub, groups, proof spend and revision', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client, true)
    const resource = await db.from('resources').where('account_id', accountId).first()
    await db
      .from('allocations')
      .where({ account_id: accountId, resource_id: resource.id })
      .limit(1)
      .update({ note: 'Private note' })
    const groupId = '11111111-1111-4111-8111-111111111111'
    await db.table('deleted_groups').insert({
      group_id: groupId,
      account_id: accountId,
      actor_id: userId,
      session_id: 'fixture-session',
      mutation_id: '22222222-2222-4222-8222-222222222222',
      created_at: new Date().toISOString(),
      consumed_at: null,
    })
    const before = await withTransaction((trx) => getPlanningRevision(trx, accountId))
    const proofId = await proof(client, cookie)
    await db.rawQuery(`CREATE TRIGGER fail_anonymise_audit BEFORE INSERT ON audit_entries
      WHEN NEW.action = 'anonymise' BEGIN SELECT RAISE(ABORT, 'injected failure'); END`)
    try {
      const failed = await asDataOwner(client.post(`/api/accounts/${accountId}/anonymise`), cookie)
        .json({ proofId })
        .send()
      failed.assertStatus(500)
    } finally {
      await db.rawQuery('DROP TRIGGER fail_anonymise_audit')
    }
    const restoredResource = await db.from('resources').where('id', resource.id).first()
    assert.equal(restoredResource.name, resource.name)
    assert.lengthOf(await db.from('deleted_groups').where('group_id', groupId), 1)
    assert.lengthOf(
      await db.from('action_proofs').where({ id: proofId }).whereNull('consumed_at'),
      1
    )
    assert.equal(await withTransaction((trx) => getPlanningRevision(trx, accountId)), before)
    const notedAllocations = await db
      .from('allocations')
      .where({ account_id: accountId, resource_id: resource.id })
      .where('note', 'Private note')
    assert.isAbove(notedAllocations.length, 0)
  })

  test('wrong-company and spent proofs do not mutate another company', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client, true)
    const before = await db.from('resources').where('account_id', 'a-loft').first()
    const proofId = await proof(client, cookie)
    const mismatch = await asDataOwner(client.post('/api/accounts/a-loft/anonymise'), cookie)
      .json({ proofId })
      .send()
    mismatch.assertStatus(403)
    const unchangedBefore = await db.from('resources').where('id', before.id).first()
    assert.equal(unchangedBefore.name, before.name)
    const first = await asDataOwner(client.post(`/api/accounts/${accountId}/anonymise`), cookie)
      .json({ proofId })
      .send()
    first.assertStatus(204)
    const replay = await asDataOwner(client.post(`/api/accounts/${accountId}/anonymise`), cookie)
      .json({ proofId })
      .send()
    replay.assertStatus(403)
    const unchangedAfter = await db.from('resources').where('id', before.id).first()
    assert.equal(unchangedAfter.name, before.name)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: accountId, action: 'anonymise' }),
      1
    )
  })

  test('an Editor cannot anonymise the company with a previously issued Owner proof', async ({
    client,
    assert,
  }) => {
    const { cookie, userId } = await resetAuthenticatedData(client, true)
    const proofId = await proof(client, cookie)
    const resource = await db.from('resources').where('account_id', accountId).first()
    await db
      .from('memberships')
      .where({ account_id: accountId, user_id: userId })
      .update({ role: 'editor' })
    const denied = await asDataOwner(client.post(`/api/accounts/${accountId}/anonymise`), cookie)
      .json({ proofId })
      .send()
    denied.assertStatus(403)
    const unchanged = await db.from('resources').where('id', resource.id).first()
    assert.equal(unchanged.name, resource.name)
    assert.lengthOf(
      await db.from('action_proofs').where({ id: proofId }).whereNull('consumed_at'),
      1
    )
  })

  test('a scrubbed deleted allocation refuses restoration with 409 and removes its saved note', async ({
    client,
    assert,
  }) => {
    const { cookie } = await resetAuthenticatedData(client, true)
    const allocation = await db.from('allocations').where('account_id', accountId).first()
    await db.from('allocations').where('id', allocation.id).update({ note: 'Private note' })
    const removed = await asDataOwner(
      client.post(`/api/accounts/${accountId}/allocations/${allocation.id}/delete`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 0,
        intent: { operation: 'allocation.delete', id: allocation.id },
      })
      .send()
    removed.assertStatus(200)
    const groupId = (removed.body() as { restoration: { replacementGroupId: string } }).restoration
      .replacementGroupId
    const proofId = await proof(client, cookie)
    const scrubbed = await asDataOwner(client.post(`/api/accounts/${accountId}/anonymise`), cookie)
      .json({ proofId })
      .send()
    scrubbed.assertStatus(204)
    assert.lengthOf(await db.from('deleted_groups').where('group_id', groupId), 0)
    assert.lengthOf(await db.from('deleted_rows').where('group_id', groupId), 0)
    const commitment = await db
      .from('planning_mutations')
      .where({ account_id: accountId, restoration_group_id: groupId })
      .first()
    assert.isString(commitment.origin_session_id)
    const revision = await withTransaction((trx) => getPlanningRevision(trx, accountId))
    const restored = await asDataOwner(
      client.post(`/api/accounts/${accountId}/planning/restore-group`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: revision,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
      })
      .send()
    restored.assertStatus(409)
    assert.lengthOf(await db.from('allocations').where('id', allocation.id), 0)
    const unknown = await asDataOwner(
      client.post(`/api/accounts/${accountId}/planning/restore-group`),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: revision,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: randomUUID() },
      })
      .send()
    unknown.assertStatus(403)
    const signIn = await client
      .post('/api/auth/sign-in')
      .json({ email: 'bruce.wayne@wayne.example', password: 'fixture-password-2026' })
      .send()
    signIn.assertStatus(200)
    const otherSession = signIn.cookie('adonis-session')?.value
    assert.isString(otherSession)
    const foreignSession = await asDataOwner(
      client.post(`/api/accounts/${accountId}/planning/restore-group`),
      otherSession!
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: revision,
        intent: { operation: 'planning.restoreGroup', restorationGroupId: groupId },
      })
      .send()
    foreignSession.assertStatus(403)
  })
})
