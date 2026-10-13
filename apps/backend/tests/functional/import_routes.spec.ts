import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import { serializeData } from '@capacitylens/shared/data/transfer'
import { FIXTURE_CLOSURE } from '@capacitylens/shared/data/fixtures'
import { readState } from '#services/state_repository'
import { commitAccountImport, prepareAccountImport } from '#services/import_account'
import { withTransaction } from '#services/with_transaction'
import { interceptChildLoggers } from '../helpers/logger.js'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

test.group('M2b import routes', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await db.from('account_member_resources').delete()
    await db.from('audit_entries').delete()
    await db.from('member_resource_link_exceptions').delete()
    await db.from('account_access_restrictions').delete()
    await db.from('company_join_intents').delete()
    await db.from('account_joining_policies').delete()
    await db.from('account_getting_started_dismissals').delete()
  })

  test('import remaps records and keeps account and joining controls', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    await db.table('account_joining_policies').insert({
      id: 'jp-studio',
      account_id: 'a-studio',
      policy: 'approved_domains',
      approved_domains: '["wayne.com"]',
      created_at: '2026-10-13T00:00:00.000Z',
      updated_at: '2026-10-13T00:00:00.000Z',
    })
    const before = await db.from('account_joining_policies').where('account_id', 'a-studio').first()
    await db.table('company_join_intents').insert({
      id: 'join-studio',
      nonce_hash: 'nonce-studio',
      browser_hash: 'browser-studio',
      purpose: 'policy',
      account_id: 'a-studio',
      email: 'bruce@wayne.com',
      provider_id: 'google',
      state: 'approved',
      expires_at: 1791850000000,
      sent_count: 1,
      last_sent_at: 1791800000000,
      source_ip_hash: 'ip-studio',
      created_at: '2026-10-13T00:00:00.000Z',
      updated_at: '2026-10-13T00:00:00.000Z',
    })
    const intentBefore = await db.from('company_join_intents').where('id', 'join-studio').first()
    const incoming = await readState('a-studio', true)
    const oldId = incoming.resources[0]!.id
    const otherBefore = await readState('a-loft', true)
    const response = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: JSON.parse(serializeData(incoming)) })
      .send()
    assert.equal(response.status(), 200, JSON.stringify(response.body()))
    const after = await readState('a-studio', true)
    assert.isAbove((response.body() as { imported: number }).imported, 0)
    assert.isFalse(after.resources.some((row) => row.id === oldId))
    assert.isTrue(
      after.allocations.every((row) =>
        after.resources.some((resource) => resource.id === row.resourceId)
      )
    )
    assert.isTrue(
      after.projects.every((row) =>
        after.clients.some((clientRow) => clientRow.id === row.clientId)
      )
    )
    assert.deepEqual(await readState('a-loft', true), otherBefore)
    assert.deepEqual(
      await db.from('account_joining_policies').where('account_id', 'a-studio').first(),
      before
    )
    assert.deepEqual(
      await db.from('company_join_intents').where('id', 'join-studio').first(),
      intentBefore
    )
  })

  test('damaged import returns 400 without changing company rows', async ({ client, assert }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const response = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: { accounts: 'damaged' } })
      .send()
    response.assertStatus(400)
    assert.deepEqual(await readState('a-studio', true), before)
  })

  test('import refuses missing company scope and malformed present schema version', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const missingScope = await trusted(client.post('/api/import'))
      .json({ data: { resources: before.resources } })
      .send()
    missingScope.assertStatus(400)
    const malformedVersion = await trusted(client.post('/api/import'))
      .json({
        accountId: 'a-studio',
        data: { schemaVersion: '10', data: { resources: before.resources } },
      })
      .send()
    malformedVersion.assertStatus(400)
    assert.deepEqual(await readState('a-studio', true), before)
  })

  test('import rejects unrecognized, future-version and oversized record sets without replacing data', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    for (const data of [
      { random: [] },
      { schemaVersion: 999, data: before },
      {
        schemaVersion: 24,
        data: { ...before, resources: Array.from({ length: 200_001 }, () => ({})) },
      },
    ]) {
      const result = await trusted(client.post('/api/import'))
        .json({ accountId: 'a-studio', data })
        .send()
      result.assertStatus(400)
      assert.deepEqual(await readState('a-studio', true), before)
    }
  })

  test('import repairs malformed person working-day defaults and nullable availability', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const incoming = await readState('a-studio', true)
    const person = incoming.resources.find(
      (row) => row.kind === 'person' && row.deletedAt === null
    )!
    person.workingDays = null as unknown as typeof person.workingDays
    person.halfDays = null as unknown as typeof person.halfDays
    const result = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: JSON.parse(serializeData(incoming)) })
      .send()
    result.assertStatus(200)
    const repairedState = await readState('a-studio', true)
    const candidates = repairedState.resources
    const repaired = candidates.find((row) => row.name === person.name)
    assert.exists(
      repaired,
      JSON.stringify({ expected: person.name, candidates: candidates.map((row) => row.name) })
    )
    if (!repaired) throw new Error('Repaired person is missing')
    assert.deepEqual(repaired.workingDays, [1, 2, 3, 4, 5])
    assert.deepEqual(repaired.halfDays, [])
    assert.isNull(repaired.firstAvailableDate)
    assert.isNull(repaired.lastAvailableDate)
  })

  test('empty usable import reports counts and leaves the company unchanged', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const result = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: { accounts: before.accounts } })
      .send()
    result.assertStatus(400)
    assert.deepInclude(result.body(), { imported: 0, maxRecords: 200_000 })
    assert.deepEqual(await readState('a-studio', true), before)
  })

  test('legacy v1 import migrates freelancer status before replacement', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const person = { ...seed().resources.find((row) => row.kind === 'person')! } as Record<
      string,
      unknown
    >
    delete person.employmentType
    person.isFreelancer = true
    const result = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: { schemaVersion: 1, data: { resources: [person] } } })
      .send()
    result.assertStatus(200)
    const importedState = await readState('a-studio', true)
    const imported = importedState.resources[0]!
    assert.equal(imported.employmentType, 'freelancer')
    assert.notProperty(imported, 'isFreelancer')
  })

  test('import replaces time off and closures with remapped resource references', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const incoming = await readState('a-studio', true)
    incoming.closures = [{ ...FIXTURE_CLOSURE, accountId: 'a-studio' }]
    const priorTimeOffId = incoming.timeOff[0]!.id
    const result = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: JSON.parse(serializeData(incoming)) })
      .send()
    result.assertStatus(200)
    const after = await readState('a-studio', true)
    assert.lengthOf(after.timeOff, 1)
    assert.lengthOf(after.closures, 1)
    assert.notEqual(after.timeOff[0]?.id, priorTimeOffId)
    assert.isTrue(after.resources.some((row) => row.id === after.timeOff[0]?.resourceId))
    assert.deepInclude(after.closures[0], {
      name: 'Fixture shutdown',
      startDate: '2026-12-24',
      endDate: '2026-12-27',
    })
  })

  test('import scrubs dependent private notes for a deleted resource', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const incoming = await readState('a-studio', true)
    const person = incoming.resources.find((row) => row.id === 'r-tyler')!
    person.archivedAt = '2026-10-12T00:00:00.000Z'
    person.deletedAt = '2026-10-13T00:00:00.000Z'
    const allocation = incoming.allocations.find((row) => row.resourceId === person.id)!
    allocation.note = 'Private project context'
    const timeOff = incoming.timeOff.find((row) => row.resourceId === person.id)!
    timeOff.note = 'Private medical detail'
    const result = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: JSON.parse(serializeData(incoming)) })
      .send()
    result.assertStatus(200)
    const after = await readState('a-studio', true)
    const deleted = after.resources.find((row) => row.deletedAt === person.deletedAt)
    assert.exists(deleted)
    if (!deleted) throw new Error('Deleted resource was not imported')
    assert.match(deleted.name ?? '', /^Removed person #/)
    assert.isNull(after.allocations.find((row) => row.resourceId === deleted.id)?.note)
    assert.isNull(after.timeOff.find((row) => row.resourceId === deleted.id)?.note)
  })

  test('import drops dangling required parents and clears optional references', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const source = seed()
    const person = {
      ...source.resources.find((row) => row.kind === 'person')!,
      disciplineId: 'missing-discipline',
    }
    const project = { ...source.projects[0]!, clientId: 'missing-client' }
    const result = await trusted(client.post('/api/import'))
      .json({
        accountId: 'a-studio',
        data: { schemaVersion: 24, data: { resources: [person], projects: [project] } },
      })
      .send()
    result.assertStatus(200)
    const after = await readState('a-studio', true)
    assert.lengthOf(after.projects, 0)
    assert.lengthOf(after.resources, 1)
    assert.isNull(after.resources[0]?.disciplineId)
  })

  test('import clears member-resource links but retains company membership', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const stamp = '2026-10-13T00:00:00.000Z'
    const currentState = await readState('a-studio', true)
    const resource = currentState.resources.find((row) => row.kind === 'person')!
    await db.table('users').insert({
      id: 'u-bruce',
      email: 'bruce@wayne.com',
      email_verified: 1,
      display_name: 'Bruce Wayne',
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('memberships').insert({
      id: 'm-bruce',
      account_id: 'a-studio',
      user_id: 'u-bruce',
      role: 'viewer',
      status: 'active',
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('account_member_resources').insert({
      id: 'mr-bruce',
      account_id: 'a-studio',
      user_id: 'u-bruce',
      resource_id: resource.id,
      revision: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    const incoming = await readState('a-studio', true)
    const result = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: JSON.parse(serializeData(incoming)) })
      .send()
    assert.equal(result.status(), 200, JSON.stringify(result.body()))
    assert.isNull(await db.from('account_member_resources').where('id', 'mr-bruce').first())
    assert.exists(await db.from('memberships').where('id', 'm-bruce').first())
  })

  test('import retains company access restrictions and resource-link exceptions', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const stamp = '2026-10-13T00:00:00.000Z'
    await db.table('account_access_restrictions').insert({
      id: 'restriction-studio',
      account_id: 'a-studio',
      principal_id: 'blocked-principal',
      verified_email: 'blocked@wayne.com',
      role: 'editor',
      created_at: stamp,
    })
    await db.table('member_resource_link_exceptions').insert({
      id: 'exception-studio',
      account_id: 'a-studio',
      user_id: 'blocked-principal',
      proposed_resource_id: 'old-person-id',
      reason: 'resource_unavailable',
      created_at: stamp,
      updated_at: stamp,
    })
    const beforeRestriction = await db
      .from('account_access_restrictions')
      .where('id', 'restriction-studio')
      .first()
    const beforeException = await db
      .from('member_resource_link_exceptions')
      .where('id', 'exception-studio')
      .first()
    const incoming = await readState('a-studio', true)
    const result = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: JSON.parse(serializeData(incoming)) })
      .send()
    result.assertStatus(200)
    assert.deepEqual(
      await db.from('account_access_restrictions').where('id', 'restriction-studio').first(),
      beforeRestriction
    )
    assert.deepEqual(
      await db.from('member_resource_link_exceptions').where('id', 'exception-studio').first(),
      beforeException
    )
  })

  test('import rejects a stale same-company snapshot without replacing rows', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const prepared = await prepareAccountImport('a-studio', await readState('a-studio', true))
    const before = await readState('a-studio', true)
    await db.from('accounts').where('id', 'a-studio').update({ name: 'Wayne Studios Changed' })
    await assert.rejects(
      () => withTransaction((trx) => commitAccountImport(trx, prepared, 'local')),
      /changed while the import was being prepared/
    )
    const after = await readState('a-studio', true)
    assert.equal(after.accounts[0]?.name, 'Wayne Studios Changed')
    assert.deepEqual(after.resources, before.resources)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: 'a-studio', action: 'import' }),
      0
    )
  })

  test('another company changing does not invalidate a prepared import', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const prepared = await prepareAccountImport('a-studio', await readState('a-studio', true))
    await db.from('accounts').where('id', 'a-loft').update({ name: 'Stark Industries Changed' })
    const result = await withTransaction((trx) => commitAccountImport(trx, prepared, 'local'))
    assert.isAbove(result.imported, 0)
    const otherState = await readState('a-loft', true)
    assert.equal(otherState.accounts[0]?.name, 'Stark Industries Changed')
  })

  test('import rolls back row replacement and member cleanup when insertion fails', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const stamp = '2026-10-13T00:00:00.000Z'
    await db.table('users').insert({
      id: 'u-rollback',
      email: 'rollback@wayne.com',
      email_verified: 1,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('memberships').insert({
      id: 'm-rollback',
      account_id: 'a-studio',
      user_id: 'u-rollback',
      role: 'viewer',
      status: 'active',
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('account_member_resources').insert({
      id: 'mr-rollback',
      account_id: 'a-studio',
      user_id: 'u-rollback',
      resource_id: before.resources[0]!.id,
      revision: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    const prepared = await prepareAccountImport('a-studio', before)
    await db.rawQuery(
      "CREATE TRIGGER reject_import_resource BEFORE INSERT ON resources BEGIN SELECT RAISE(ABORT, 'test import failure'); END"
    )
    try {
      await assert.rejects(
        () => withTransaction((trx) => commitAccountImport(trx, prepared, 'local')),
        /test import failure/
      )
    } finally {
      await db.rawQuery('DROP TRIGGER reject_import_resource')
    }
    assert.deepEqual(await readState('a-studio', true), before)
    assert.exists(await db.from('account_member_resources').where('id', 'mr-rollback').first())
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: 'a-studio', action: 'import' }),
      0
    )
  })

  test('association cleanup trigger failure leaves imported rows, links and audit unchanged', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const stamp = '2026-10-13T00:00:00.000Z'
    await db.table('users').insert({
      id: 'u-cleanup',
      email: 'cleanup@wayne.com',
      email_verified: 1,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('memberships').insert({
      id: 'm-cleanup',
      account_id: 'a-studio',
      user_id: 'u-cleanup',
      role: 'viewer',
      status: 'active',
      created_at: stamp,
      updated_at: stamp,
    })
    await db.table('account_member_resources').insert({
      id: 'mr-cleanup',
      account_id: 'a-studio',
      user_id: 'u-cleanup',
      resource_id: before.resources[0]!.id,
      revision: stamp,
      created_at: stamp,
      updated_at: stamp,
    })
    await db.rawQuery(
      "CREATE TRIGGER reject_import_cleanup BEFORE DELETE ON account_member_resources BEGIN SELECT RAISE(ABORT, 'cleanup unavailable'); END"
    )
    try {
      const result = await trusted(client.post('/api/import'))
        .json({ accountId: 'a-studio', data: JSON.parse(serializeData(before)) })
        .send()
      result.assertStatus(500)
    } finally {
      await db.rawQuery('DROP TRIGGER reject_import_cleanup')
    }
    assert.deepEqual(await readState('a-studio', true), before)
    assert.exists(await db.from('account_member_resources').where('id', 'mr-cleanup').first())
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: 'a-studio', action: 'import' }),
      0
    )
  })

  test('full fixture import retains every entity table and explicit nullable properties', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const result = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: JSON.parse(serializeData(before)) })
      .send()
    result.assertStatus(200)
    const after = await readState('a-studio', true)
    for (const key of [
      'clients',
      'disciplines',
      'projects',
      'phases',
      'resources',
      'activities',
      'allocations',
      'timeOff',
      'closures',
    ] as const) {
      assert.lengthOf(after[key], before[key].length, key)
      assert.isTrue(
        after[key].every((row) => row.accountId === 'a-studio'),
        key
      )
    }
    assert.isTrue(
      after.resources.every(
        (row) => Object.hasOwn(row, 'firstAvailableDate') && Object.hasOwn(row, 'lastAvailableDate')
      )
    )
    assert.isTrue(
      after.projects.every(
        (row) => Object.hasOwn(row, 'archivedAt') && Object.hasOwn(row, 'deletedAt')
      )
    )
  })

  test('import keeps its committed result when post-commit logging fails', async ({
    client,
    assert,
    cleanup,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const incoming = await readState('a-studio', true)
    const restoreLogger = interceptChildLoggers((child) => {
      child.info = (() => {
        throw new Error('log unavailable')
      }) as typeof child.info
    })
    cleanup(restoreLogger)
    const response = await trusted(client.post('/api/import'))
      .json({ accountId: 'a-studio', data: JSON.parse(serializeData(incoming)) })
      .send()
    response.assertStatus(200)
    assert.equal(response.header('x-capacitylens-audit-warning'), 'true')
    assert.isTrue((response.body() as { auditWarning: boolean }).auditWarning)
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: 'a-studio', action: 'import' }),
      1
    )
  })
})
