import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { freshDatabase } from '../helpers/fresh_database.js'
import { replaceWithSeed } from '#services/state_repository'
import { withTransaction } from '#services/with_transaction'

const accountId = 'a-studio'
const timestamp = '2026-10-12T00:00:00.000Z'

function clientRow(id: string) {
  return {
    id,
    account_id: accountId,
    name: 'Bruce Wayne',
    color: '#111111',
    created_at: timestamp,
    updated_at: timestamp,
  }
}

test.group('M2a SQLite transaction faults', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(() => replaceWithSeed())

  test('uses one SQLite connection with the required durability and contention settings', async ({
    assert,
  }) => {
    const pool = (db.manager.get('sqlite') as any).connection.pool
    const pragma = async (name: string) => {
      const result = await db.rawQuery(`PRAGMA ${name}`)
      const column = name === 'busy_timeout' ? 'timeout' : name
      return (result as Array<Record<string, unknown>>)[0]?.[column]
    }

    assert.equal(pool.max, 1)
    assert.equal(await pragma('journal_mode'), 'wal')
    assert.equal(await pragma('synchronous'), 2)
    assert.equal(await pragma('foreign_keys'), 1)
    assert.equal(await pragma('busy_timeout'), 1000)
  })

  test('keeps outside queries queued until the owning transaction commits', async ({ assert }) => {
    const trx = await db.transaction()
    await trx.table('clients').insert(clientRow('m2a-outside-commit'))
    let queryFinished = false
    const outsideRead = db
      .from('clients')
      .where('id', 'm2a-outside-commit')
      .first()
      .finally(() => {
        queryFinished = true
      })

    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.isFalse(queryFinished, 'root queries must wait for the active root transaction')
    await trx.commit()
    assert.isNotNull(await outsideRead)
  })

  test('rolls back a nested savepoint without rolling back the outer transaction', async ({
    assert,
  }) => {
    await db.transaction(async (outer) => {
      await outer.table('clients').insert(clientRow('m2a-savepoint-outer'))
      await assert.rejects(
        () =>
          outer.transaction(async (nested) => {
            await nested.table('clients').insert(clientRow('m2a-savepoint-inner'))
            throw new Error('rollback nested savepoint')
          }),
        /rollback nested savepoint/
      )

      assert.isNotNull(await outer.from('clients').where('id', 'm2a-savepoint-outer').first())
      assert.isNull(await outer.from('clients').where('id', 'm2a-savepoint-inner').first())
    })

    assert.isNotNull(await db.from('clients').where('id', 'm2a-savepoint-outer').first())
    assert.isNull(await db.from('clients').where('id', 'm2a-savepoint-inner').first())
  })

  test('bounds acquisition of a second root transaction while another remains open', async ({
    assert,
  }) => {
    const held = await db.transaction()
    const startedAt = Date.now()
    try {
      await assert.rejects(() => db.transaction(async () => {}), /timeout|acquire|pool/i)
      const elapsed = Date.now() - startedAt
      assert.isAtLeast(elapsed, 4000, 'normal queueing is allowed the configured 5 seconds')
      assert.isBelow(elapsed, 6500, 'acquisition refusal must remain bounded')
    } finally {
      await held.rollback()
    }
  })

  test('quarantines a connection after native rollback fails before a queued root read', async ({
    assert,
  }) => {
    const connection = (db.manager.get('sqlite') as any).connection
    const pool = connection.pool as { validate: (resource: any) => boolean }
    const originalValidate = pool.validate
    const disableValidation = process.env.M2A_DISABLE_POOL_VALIDATION === '1'

    if (disableValidation) pool.validate = () => true

    let queuedRead: Promise<Record<string, unknown> | undefined> | undefined
    let dirtyNativeConnection: any
    try {
      await assert.rejects(
        () =>
          withTransaction(async (trx) => {
            dirtyNativeConnection = await (trx.knexClient as any).client.acquireConnection()
            const originalPrepare = dirtyNativeConnection.prepare.bind(dirtyNativeConnection)
            dirtyNativeConnection.prepare = (sql: string) => {
              if (/^\s*ROLLBACK\b/i.test(sql)) throw new Error('forced native rollback failure')
              return originalPrepare(sql)
            }

            await trx.table('clients').insert(clientRow('m2a-rollback-fault'))
            queuedRead = db.from('clients').where('id', 'm2a-rollback-fault').first()
            await new Promise((resolve) => setTimeout(resolve, 30))
            throw new Error('force helper rollback')
          }),
        /force helper rollback|rollback both failed/
      )

      assert.isTrue(dirtyNativeConnection?.inTransaction)
      assert.isTrue(dirtyNativeConnection?.open)
      assert.isDefined(queuedRead)

      const queuedResult = await queuedRead!
      assert.isNull(queuedResult, 'queued root read must never observe uncommitted data')
      assert.isFalse(
        dirtyNativeConnection?.open,
        'the failed-rollback connection must be destroyed before pool reuse'
      )
      assert.isNull(await db.from('clients').where('id', 'm2a-rollback-fault').first())
    } finally {
      pool.validate = originalValidate
      if (queuedRead) await queuedRead.catch(() => undefined)
      // Returning the dirty resource to Tarn runs validation and leaves a clean connection available.
      await db.rawQuery('select 1')
    }
  })

  test('does not report rollback when an after-commit callback fails', async ({ assert }) => {
    await withTransaction(async (trx) => {
      await trx.table('clients').insert(clientRow('m2a-after-commit'))
      trx.after('commit', () => {
        throw new Error('post-commit callback failure')
      })
    })

    assert.isNotNull(await db.from('clients').where('id', 'm2a-after-commit').first())
  })
})
