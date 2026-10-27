import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { test } from '@japa/runner'
import app from '@adonisjs/core/services/app'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { seed } from '@capacitylens/shared/data/seed'
import { encodeRow } from '#services/state_repository'
import Allocation from '#models/allocation'
import Client from '#models/client'
import Closure from '#models/closure'
import Discipline from '#models/discipline'
import Phase from '#models/phase'
import TimeOff from '#models/time_off'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { fixtureSession } from '../../helpers/identities.js'
import ConvertPlanningDeleteSnapshots from '../../../database/migrations/202610270002_convert_planning_delete_snapshots.js'

type NativeConnection = {
  pragma(sql: string): unknown
  prepare(sql: string): { run(...values: string[]): unknown }
  close(): void
}
const NativeDatabase = createRequire(import.meta.url)('better-sqlite3') as new (
  path: string
) => NativeConnection
import CreateBaseline from '../../../database/migrations/202610120001_create_capacitylens_baseline.js'
import { resetPlanningFixture } from './helpers.js'

const models = {
  allocations: Allocation,
  closures: Closure,
  disciplines: Discipline,
  phases: Phase,
  time_off: TimeOff,
} as const

async function group(accountId: string, sessionId: number) {
  const groupId = randomUUID()
  await db.table('deleted_groups').insert({
    group_id: groupId,
    account_id: accountId,
    actor_id: 'u-bruce',
    session_id: sessionId,
    mutation_id: randomUUID(),
    created_at: new Date().toISOString(),
  })
  return groupId
}

test.group('planning deletion ownership', (suite) => {
  suite.setup(() => freshDatabase())
  suite.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('package deletion, association and restore work for all five row types', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    const now = new Date().toISOString()
    await db.table('closures').insert({
      id: randomUUID(),
      account_id: 'a-studio',
      name: 'Gotham Founders Day',
      start_date: '2026-11-02',
      end_date: '2026-11-02',
      created_at: now,
      updated_at: now,
    })
    for (const [table, modelClass] of Object.entries(models)) {
      const row = await (modelClass as typeof Allocation)
        .query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .firstOrFail()
      const id = row.id
      const groupId = await group('a-studio', sessionId)
      await row.delete()
      await db.from(table).where('id', id).update({ deletion_group_id: groupId })
      const deleted = await (modelClass as typeof Allocation)
        .query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .withTrashed()
        .where('id', id)
        .firstOrFail()
      assert.isTrue(deleted.trashed)
      assert.isUndefined(deleted.serialize().deletedAt)
      assert.isUndefined(deleted.serialize().deletionGroupId)
      await db.from(table).where('id', id).update({ deletion_group_id: null })
      await deleted.restore()
      assert.isNull((await db.from(table).where('id', id).first())!.deleted_at)
      assert.isNull((await db.from(table).where('id', id).first())!.deletion_group_id)
    }
  })

  test('rejects active and cross-company associations and group-company changes', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    const foreignGroupId = await group('a-loft', sessionId)
    const ownGroupId = await group('a-studio', sessionId)
    const row = await Allocation.query()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .firstOrFail()
    await assert.rejects(() =>
      db.from('allocations').where('id', row.id).update({ deletion_group_id: ownGroupId })
    )
    await row.delete()
    await assert.rejects(() =>
      db.from('allocations').where('id', row.id).update({ deletion_group_id: foreignGroupId })
    )
    await db.from('allocations').where('id', row.id).update({ deletion_group_id: ownGroupId })
    const groupBefore = await db.from('deleted_groups').where('group_id', ownGroupId).first()
    const rowBefore = await db.from('allocations').where('id', row.id).first()
    await assert.rejects(() =>
      db.from('deleted_groups').where('group_id', ownGroupId).update({
        account_id: 'a-loft',
        consumed_at: new Date().toISOString(),
      })
    )
    assert.deepEqual(
      await db.from('deleted_groups').where('group_id', ownGroupId).first(),
      groupBefore
    )
    assert.deepEqual(await db.from('allocations').where('id', row.id).first(), rowBefore)
  })

  test('session cleanup removes attached trash but preserves a newer deletion generation', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    const oldGroup = await group('a-studio', sessionId)
    const currentGroup = await group('a-studio', sessionId)
    const first = await Allocation.query()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .firstOrFail()
    await first.delete()
    await db.from('allocations').where('id', first.id).update({ deletion_group_id: oldGroup })
    await db.from('allocations').where('id', first.id).update({ deletion_group_id: null })
    await first.restore()
    await first.delete()
    await db.from('allocations').where('id', first.id).update({ deletion_group_id: currentGroup })
    await db
      .from('deleted_groups')
      .where('group_id', oldGroup)
      .update({ consumed_at: new Date().toISOString() })
    await db.from('deleted_groups').where('group_id', oldGroup).delete()
    assert.exists(await db.from('allocations').where('id', first.id).first())
    await db.from('account_sessions').where('id', sessionId).delete()
    assert.isNull(await db.from('allocations').where('id', first.id).first())
    assert.isNull(await db.from('deleted_groups').where('group_id', currentGroup).first())
  })

  test('active-row group guard aborts cleanup and rolls back earlier deletions', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    const cleanGroup = await group('a-studio', sessionId)
    const blockedGroup = await group('a-studio', sessionId)
    const rows = await Allocation.query()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .limit(2)
    assert.lengthOf(rows, 2)
    await rows[0]!.delete()
    await db.from('allocations').where('id', rows[0]!.id).update({ deletion_group_id: cleanGroup })
    await assert.rejects(() =>
      db.transaction(async (trx) => {
        // Simulate historical corruption while retaining the production guard on group deletion.
        await trx.rawQuery('DROP TRIGGER allocations_deletion_group_update')
        await trx
          .from('allocations')
          .where('id', rows[1]!.id)
          .update({ deletion_group_id: blockedGroup })
        await trx.from('deleted_groups').where('group_id', cleanGroup).delete()
        await trx.from('deleted_groups').where('group_id', blockedGroup).delete()
      })
    )
    assert.exists(await db.from('deleted_groups').where('group_id', cleanGroup).first())
    assert.exists(await db.from('allocations').where('id', rows[0]!.id).first())
    assert.isNull(
      (await db.from('allocations').where('id', rows[1]!.id).first())!.deletion_group_id
    )
  })

  test('legacy pending generations retain only the latest row and keep older receipts conflicting', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    const oldGroup = await group('a-studio', sessionId)
    const currentGroup = await group('a-studio', sessionId)
    const row = await Allocation.query()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .firstOrFail()
    const original = row.serialize()
    await db.table('deleted_rows').multiInsert(
      [oldGroup, currentGroup].map((groupId) => ({
        group_id: groupId,
        entity: 'allocations',
        row_id: row.id,
        payload_json: JSON.stringify({ kind: 'row', row: original }),
      }))
    )
    await db.from('allocations').where('id', row.id).delete()
    await db.transaction(async (trx) => {
      await new ConvertPlanningDeleteSnapshots(trx, 'legacy-upgrade-proof').execUp()
    })
    const retained = await db.from('allocations').where('id', row.id).first()
    assert.exists(retained?.deleted_at)
    assert.equal(retained?.deletion_group_id, currentGroup)
    const receipts = await db.from('deleted_rows').where('row_id', row.id).orderBy('id')
    assert.deepEqual(
      receipts.map((receipt) => JSON.parse(receipt.payload_json)),
      [{ kind: 'row' }, { kind: 'row' }]
    )
    await db.from('deleted_groups').where('group_id', oldGroup).delete()
    assert.exists(await db.from('allocations').where('id', row.id).first())
  })

  test('legacy active collisions and missing parents keep receipts without replacing live rows', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    const collisionGroup = await group('a-studio', sessionId)
    const missingParentGroup = await group('a-studio', sessionId)
    const rows = await Allocation.query().withScopes((scopes) => scopes.forCompany('a-studio'))
    const active = rows[0]!
    const orphan = rows.find((row) => row.resourceId !== active.resourceId)!
    await db.table('deleted_rows').multiInsert([
      {
        group_id: collisionGroup,
        entity: 'allocations',
        row_id: active.id,
        payload_json: JSON.stringify({ kind: 'row', row: active.serialize() }),
      },
      {
        group_id: missingParentGroup,
        entity: 'allocations',
        row_id: orphan.id,
        payload_json: JSON.stringify({ kind: 'row', row: orphan.serialize() }),
      },
    ])
    await db.from('resources').where('id', orphan.resourceId).delete()
    await db.transaction(async (trx) => {
      await new ConvertPlanningDeleteSnapshots(trx, 'legacy-upgrade-proof').execUp()
    })
    const stillActive = await db.from('allocations').where('id', active.id).first()
    assert.isNull(stillActive?.deleted_at)
    assert.isNull(stillActive?.deletion_group_id)
    assert.isNull(await db.from('allocations').where('id', orphan.id).first())
    const receipts = await db
      .from('deleted_rows')
      .whereIn('group_id', [collisionGroup, missingParentGroup])
    assert.deepEqual(
      receipts.map((receipt) => JSON.parse(receipt.payload_json)),
      [{ kind: 'row' }, { kind: 'row' }]
    )
  })

  test('populated baseline upgrade preserves rows, links and pending deletion receipts', async ({
    assert,
  }) => {
    const ace = await app.container.make('ace')
    const wipe = await ace.exec('db:wipe', ['--force'])
    if (wipe.exitCode) throw wipe.error ?? new Error('Database wipe failed')
    try {
      await new CreateBaseline(db.connection(), 'populated-upgrade-proof').execUp()
      await db.connection().schema.createTable('adonis_schema', (table) => {
        table.increments('id')
        table.string('name').notNullable()
        table.integer('batch').notNullable()
        table.timestamp('migration_time')
      })
      await db.connection().schema.createTable('adonis_schema_versions', (table) => {
        table.integer('version').primary()
      })
      await db.table('adonis_schema').insert({
        name: 'database/migrations/202610120001_create_capacitylens_baseline',
        batch: 1,
      })
      await db.table('adonis_schema_versions').insert({ version: 2 })
      const data = seed()
      const mappings = {
        accounts: 'accounts',
        clients: 'clients',
        disciplines: 'disciplines',
        projects: 'projects',
        phases: 'phases',
        resources: 'resources',
        activities: 'activities',
        allocations: 'allocations',
        timeOff: 'time_off',
        closures: 'closures',
      } as const
      for (const [key, table] of Object.entries(mappings)) {
        const columns = new Set(
          ((await db.rawQuery(`PRAGMA table_info(${table})`)) as Array<{ name: string }>).map(
            (column) => column.name
          )
        )
        const rows = data[key as keyof typeof mappings]
        if (rows.length)
          await db
            .table(table)
            .multiInsert(
              rows.map((row) =>
                Object.fromEntries(
                  Object.entries(
                    encodeRow(table, row as unknown as Record<string, unknown>)
                  ).filter(([name]) => columns.has(name))
                )
              )
            )
      }
      const sessionId = await fixtureSession('u-bruce')
      const groupId = await group('a-studio', sessionId)
      const removed = data.allocations.find((row) => row.accountId === 'a-studio')!
      await db.table('deleted_rows').insert({
        group_id: groupId,
        entity: 'allocations',
        row_id: removed.id,
        payload_json: JSON.stringify({ kind: 'row', row: removed }),
      })
      await db.from('allocations').where('id', removed.id).delete()
      const before = Object.fromEntries(
        await Promise.all(
          Object.values(mappings).map(async (table) => [table, await db.from(table).orderBy('id')])
        )
      )
      await db.rawQuery('CREATE INDEX time_off_deletion_group_id_index ON time_off(id)')
      const receiptBefore = await db.from('deleted_rows').where('group_id', groupId).first()
      const schemaBefore = await db
        .from('sqlite_master')
        .whereNot('name', 'like', 'sqlite_%')
        .select('type', 'name', 'sql')
        .orderBy('name')
      const groupsBefore = await db.from('deleted_groups').orderBy('group_id')
      const rowsBefore = await db.from('deleted_rows').orderBy('id')
      const migrationLedgerBefore = await db.from('adonis_schema').orderBy('id')
      const dryRun = await ace.exec('migration:run', [
        '--dry-run',
        '--force',
        '--no-schema-generate',
      ])
      if (dryRun.exitCode) throw dryRun.error ?? new Error('Migration dry run failed')
      assert.deepEqual(
        await db
          .from('sqlite_master')
          .whereNot('name', 'like', 'sqlite_%')
          .select('type', 'name', 'sql')
          .orderBy('name'),
        schemaBefore
      )
      for (const table of Object.values(mappings))
        assert.deepEqual(await db.from(table).orderBy('id'), before[table])
      assert.deepEqual(await db.from('deleted_groups').orderBy('group_id'), groupsBefore)
      assert.deepEqual(await db.from('deleted_rows').orderBy('id'), rowsBefore)
      const failedApply = await ace.exec('migration:run', ['--force', '--no-schema-generate'])
      assert.isAbove(failedApply.exitCode ?? 0, 0)
      assert.deepEqual(
        await db
          .from('sqlite_master')
          .whereNot('name', 'like', 'sqlite_%')
          .select('type', 'name', 'sql')
          .orderBy('name'),
        schemaBefore
      )
      for (const table of Object.values(mappings))
        assert.deepEqual(await db.from(table).orderBy('id'), before[table])
      assert.deepEqual(await db.from('deleted_groups').orderBy('group_id'), groupsBefore)
      assert.deepEqual(await db.from('deleted_rows').orderBy('id'), rowsBefore)
      assert.deepEqual(await db.from('adonis_schema').orderBy('id'), migrationLedgerBefore)
      await db.rawQuery('DROP INDEX time_off_deletion_group_id_index')
      const applied = await ace.exec('migration:run', ['--force', '--no-schema-generate'])
      if (applied.exitCode) throw applied.error ?? new Error('Migration apply failed')
      for (const table of Object.values(mappings)) {
        const actualRows = await db.from(table).orderBy('id')
        const after = actualRows
          .filter((row) => table !== 'allocations' || row.id !== removed.id)
          .map((row) => {
            if (!['allocations', 'time_off', 'closures', 'phases', 'disciplines'].includes(table))
              return row
            const original = { ...row }
            delete original.deleted_at
            delete original.deletion_group_id
            return original
          })
        assert.deepEqual(after, before[table], `${table} changed during schema migration`)
      }
      const receiptAfter = await db.from('deleted_rows').where('group_id', groupId).first()
      assert.equal(receiptAfter?.id, receiptBefore?.id)
      const retained = await db.from('allocations').where('id', removed.id).first()
      assert.equal(retained?.account_id, removed.accountId)
      assert.equal(retained?.created_at, removed.createdAt)
      assert.equal(retained?.updated_at, removed.updatedAt)
      assert.exists(retained?.deleted_at)
      assert.equal(retained?.deletion_group_id, groupId)
      assert.deepEqual(
        JSON.parse(
          (await db.from('deleted_rows').where('group_id', groupId).first())!.payload_json
        ),
        { kind: 'row' }
      )
      const native = new NativeDatabase(env.get('CAPACITYLENS_DB')!)
      try {
        native.pragma('foreign_keys = ON')
        const project = data.projects.find((row) => row.accountId === 'a-loft')!
        native.prepare('DELETE FROM projects WHERE id = ?').run(project.id)
      } finally {
        native.close()
      }
      const client = data.clients.find(
        (row) =>
          row.accountId === 'a-studio' &&
          data.projects.some((project) => project.clientId === row.id)
      )!
      await db
        .from('clients')
        .where('id', client.id)
        .update({ deleted_at: new Date().toISOString() })
      await db.manager.close('sqlite')
      const purged = await Client.query()
        .onlyTrashed()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', client.id)
        .forceDelete()
      assert.equal(purged, 1)
    } finally {
      await freshDatabase()
    }
  })
})
