import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { seed } from '@capacitylens/shared/data/seed'
import { readState } from '#services/state_repository'
import AuditEntry from '#models/audit_entry'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

const migration = (direction: 'up' | 'down') =>
  new MigrationRunner(
    db,
    app,
    direction === 'up'
      ? { direction, disableLocks: true }
      : { direction, step: 1, disableLocks: true }
  )

test.group('M2b deletion audit retention', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await db.from('audit_entries').delete()
    await db.from('accounts').delete()
  })

  test('forward and down migrations preserve live audit rows, columns, index and foreign key', async ({
    assert,
  }) => {
    const accounts = ['a-audit-migration', 'a-audit-migration-other'].map((id) => ({
      ...seed().accounts[0]!,
      id,
    }))
    await db.table('accounts').insert(
      accounts.map((account) => ({
        id: account.id,
        name: account.name,
        color: account.color,
        created_at: account.createdAt,
        updated_at: account.updatedAt,
      }))
    )
    const stamp = '2026-10-13T00:00:00.000Z'
    await db.table('audit_entries').insert([
      {
        id: 'audit-migrate-1',
        account_id: accounts[0]!.id,
        actor_id: 'bruce',
        action: 'create',
        entity: 'accounts',
        entity_id: accounts[0]!.id,
        details: '{"changedFields":[]}',
        created_at: stamp,
        updated_at: stamp,
      },
      {
        id: 'audit-migrate-2',
        account_id: accounts[1]!.id,
        actor_id: null,
        action: 'update',
        entity: 'accounts',
        entity_id: accounts[1]!.id,
        details: null,
        created_at: stamp,
        updated_at: stamp,
      },
    ])
    const rows = await db.from('audit_entries').orderBy('id')
    const columns = await db.rawQuery('PRAGMA table_info(audit_entries)')
    const down = migration('down')
    await down.run()
    assert.isNull(down.error)
    assert.deepEqual(await db.from('audit_entries').orderBy('id'), rows)
    assert.deepEqual(await db.rawQuery('PRAGMA table_info(audit_entries)'), columns)
    assert.isTrue(
      (
        (await db.rawQuery('PRAGMA foreign_key_list(audit_entries)')) as Array<{
          table: string
          on_delete: string
        }>
      ).some((key) => key.table === 'accounts' && key.on_delete === 'CASCADE')
    )
    assert.isTrue(
      ((await db.rawQuery('PRAGMA index_list(audit_entries)')) as Array<{ name: string }>).some(
        (index) => index.name.includes('account_id')
      )
    )
    const orphan = { ...rows[0], id: 'audit-orphan', account_id: 'missing-account' }
    await assert.rejects(() => db.table('audit_entries').insert(orphan))
    const up = migration('up')
    await up.run()
    assert.isNull(up.error)
    assert.deepEqual(await db.from('audit_entries').orderBy('id'), rows)
    assert.deepEqual(await db.rawQuery('PRAGMA table_info(audit_entries)'), columns)
    assert.isFalse(
      (
        (await db.rawQuery('PRAGMA foreign_key_list(audit_entries)')) as Array<{ table: string }>
      ).some((key) => key.table === 'accounts')
    )
    const indexes = (await db.rawQuery('PRAGMA index_list(audit_entries)')) as Array<{
      name: string
    }>
    const accountIndex = indexes.find((index) => index.name.includes('account_id'))
    assert.exists(accountIndex)
    const indexedColumns = (await db.rawQuery(
      `PRAGMA index_info(${accountIndex!.name})`
    )) as Array<{ name: string }>
    assert.deepEqual(
      indexedColumns.map((column) => column.name),
      ['account_id']
    )
    assert.isTrue(
      ((await db.rawQuery('PRAGMA foreign_key_list(clients)')) as Array<{ table: string }>).some(
        (key) => key.table === 'accounts'
      )
    )
    assert.deepEqual(await db.rawQuery('PRAGMA foreign_key_check'), [])
    const foreignKeys = (await db.rawQuery('PRAGMA foreign_keys')) as Array<{
      foreign_keys: number
    }>
    assert.equal(foreignKeys[0]?.foreign_keys, 1)
  })

  test('deletion retains metadata and prior history, stays scoped and is idempotent', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const created = await trusted(client.post('/api/accounts'))
      .json({ ...seed().accounts[0]!, id: 'a-audit-wayne' })
      .send()
    created.assertStatus(201)
    await db.table('accounts').insert({
      id: 'a-audit-stark',
      name: 'Stark Industries',
      color: '#2d75da',
      created_at: '2026-10-13T00:00:00.000Z',
      updated_at: '2026-10-13T00:00:00.000Z',
    })
    await db.table('audit_entries').insert({
      id: 'audit-stark',
      account_id: 'a-audit-stark',
      actor_id: null,
      action: 'create',
      entity: 'accounts',
      entity_id: 'a-audit-stark',
      details: '{}',
      created_at: '2026-10-13T00:00:00.000Z',
      updated_at: '2026-10-13T00:00:00.000Z',
    })
    const beforeOther = await db.from('audit_entries').where('account_id', 'a-audit-stark')
    const deleted = await trusted(client.delete('/api/accounts/a-audit-wayne')).send()
    deleted.assertStatus(204)
    const erased = await readState('a-audit-wayne', true)
    assert.lengthOf(erased.accounts, 0)
    const history = await db
      .from('audit_entries')
      .where('account_id', 'a-audit-wayne')
      .orderBy('created_at')
    assert.lengthOf(history, 2)
    assert.deepInclude(
      history.map(({ action, entity, entity_id, account_id }) => ({
        action,
        entity,
        entity_id,
        account_id,
      })),
      {
        action: 'delete',
        entity: 'accounts',
        entity_id: 'a-audit-wayne',
        account_id: 'a-audit-wayne',
      }
    )
    assert.deepEqual(
      await db.from('audit_entries').where('account_id', 'a-audit-stark'),
      beforeOther
    )
    let scopeError: unknown
    try {
      await AuditEntry.query().first()
    } catch (error) {
      scopeError = error
    }
    assert.match(String(scopeError), /A company scope is required for model reads/)
    assert.lengthOf(
      await AuditEntry.query().withScopes((scopes) => scopes.forCompany('a-audit-stark')),
      1
    )
    const repeated = await trusted(client.delete('/api/accounts/a-audit-wayne')).send()
    repeated.assertStatus(204)
    assert.lengthOf(await db.from('audit_entries').where('account_id', 'a-audit-wayne'), 2)
    const journal = await db.from('adonis_schema').orderBy('id')
    const schema = await db.rawQuery('PRAGMA foreign_key_list(audit_entries)')
    const refused = migration('down')
    await refused.run()
    assert.match(String(refused.error), /Cannot restore audit account foreign key/)
    assert.deepEqual(await db.from('adonis_schema').orderBy('id'), journal)
    assert.deepEqual(await db.rawQuery('PRAGMA foreign_key_list(audit_entries)'), schema)
    assert.lengthOf(await db.from('audit_entries').where('account_id', 'a-audit-wayne'), 2)
    await db.from('audit_entries').where('account_id', 'a-audit-wayne').delete()
  })

  test('a failed audit insert rolls back deletion and related rows', async ({ client, assert }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const created = await trusted(client.post('/api/accounts'))
      .json({ ...seed().accounts[0]!, id: 'a-audit-fail' })
      .send()
    created.assertStatus(201)
    const before = await readState('a-audit-fail', true)
    const prior = await db.from('audit_entries').where('account_id', 'a-audit-fail')
    await db.rawQuery(
      "CREATE TRIGGER m2b_fail_delete_audit BEFORE INSERT ON audit_entries WHEN NEW.action = 'delete' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
    )
    try {
      const failed = await trusted(client.delete('/api/accounts/a-audit-fail')).send()
      failed.assertStatus(500)
      assert.deepEqual(await readState('a-audit-fail', true), before)
      assert.deepEqual(await db.from('audit_entries').where('account_id', 'a-audit-fail'), prior)
    } finally {
      await db.rawQuery('DROP TRIGGER m2b_fail_delete_audit')
    }
  })
})
