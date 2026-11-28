import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import Allocation from '#models/allocation'
import { ClosureFactory } from '#database/factories/closure_factory'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { fixtureSession } from '#tests/helpers/identities'
import { resetPlanningFixture } from '#tests/helpers/planning/functional_helpers'
import { retainedModels, createDeletionBatch } from '#tests/helpers/planning/retained_rows'

test.group('planning deletion ownership', (suite) => {
  suite.setup(() => freshDatabase())
  suite.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('package deletion, association and restore work for all five row types', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    await ClosureFactory.merge({
      companyId: 'a-studio',
      name: 'Gotham Founders Day',
      startDate: '2026-11-02',
      endDate: '2026-11-02',
    }).create()
    for (const [table, modelClass] of Object.entries(retainedModels)) {
      const row = await (modelClass as typeof Allocation)
        .query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .firstOrFail()
      const id = row.id
      const groupId = await createDeletionBatch('a-studio', sessionId)
      await row.delete()
      await db.from(table).where('id', id).update({ deleted_batch_id: groupId })
      const deleted = await (modelClass as typeof Allocation)
        .query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .withTrashed()
        .where('id', id)
        .firstOrFail()
      assert.isTrue(deleted.trashed)
      assert.isUndefined(deleted.serialize().deletedAt)
      assert.isUndefined(deleted.serialize().deletedBatchId)
      await db.from(table).where('id', id).update({ deleted_batch_id: null })
      await deleted.restore()
      assert.isNull((await db.from(table).where('id', id).first())!.deleted_at)
      assert.isNull((await db.from(table).where('id', id).first())!.deleted_batch_id)
    }
  })

  test('rejects active and cross-company associations and group-company changes', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    const foreignGroupId = await createDeletionBatch('a-loft', sessionId)
    const ownGroupId = await createDeletionBatch('a-studio', sessionId)
    const row = await Allocation.query()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .firstOrFail()
    await assert.rejects(() =>
      db.from('allocations').where('id', row.id).update({ deleted_batch_id: ownGroupId })
    )
    await row.delete()
    await assert.rejects(() =>
      db.from('allocations').where('id', row.id).update({ deleted_batch_id: foreignGroupId })
    )
    await db.from('allocations').where('id', row.id).update({ deleted_batch_id: ownGroupId })
    const groupBefore = await db.from('deleted_batches').where('id', ownGroupId).first()
    const rowBefore = await db.from('allocations').where('id', row.id).first()
    await assert.rejects(() =>
      db.from('deleted_batches').where('id', ownGroupId).update({
        company_id: 'a-loft',
        consumed_at: new Date().toISOString(),
      })
    )
    assert.deepEqual(await db.from('deleted_batches').where('id', ownGroupId).first(), groupBefore)
    assert.deepEqual(await db.from('allocations').where('id', row.id).first(), rowBefore)
  })

  test('session cleanup removes attached trash but preserves a newer deletion generation', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    const oldGroup = await createDeletionBatch('a-studio', sessionId)
    const currentGroup = await createDeletionBatch('a-studio', sessionId)
    const first = await Allocation.query()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .firstOrFail()
    await first.delete()
    await db.from('allocations').where('id', first.id).update({ deleted_batch_id: oldGroup })
    await db.from('allocations').where('id', first.id).update({ deleted_batch_id: null })
    await first.restore()
    await first.delete()
    await db.from('allocations').where('id', first.id).update({ deleted_batch_id: currentGroup })
    await db
      .from('deleted_batches')
      .where('id', oldGroup)
      .update({ consumed_at: new Date().toISOString() })
    await db.from('deleted_batches').where('id', oldGroup).delete()
    assert.exists(await db.from('allocations').where('id', first.id).first())
    await db.from('account_sessions').where('id', sessionId).delete()
    assert.isNull(await db.from('allocations').where('id', first.id).first())
    assert.isNull(await db.from('deleted_batches').where('id', currentGroup).first())
  })

  test('active-row group guard aborts cleanup and rolls back earlier deletions', async ({
    assert,
  }) => {
    const sessionId = await fixtureSession('u-bruce')
    const cleanGroup = await createDeletionBatch('a-studio', sessionId)
    const blockedGroup = await createDeletionBatch('a-studio', sessionId)
    const rows = await Allocation.query()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .limit(2)
    assert.lengthOf(rows, 2)
    await rows[0]!.delete()
    await db.from('allocations').where('id', rows[0]!.id).update({ deleted_batch_id: cleanGroup })
    await assert.rejects(() =>
      db.transaction(async (trx) => {
        // Simulate historical corruption while retaining the production guard on group deletion.
        await trx.rawQuery('DROP TRIGGER allocations_deletion_group_update')
        await trx
          .from('allocations')
          .where('id', rows[1]!.id)
          .update({ deleted_batch_id: blockedGroup })
        await trx.from('deleted_batches').where('id', cleanGroup).delete()
        await trx.from('deleted_batches').where('id', blockedGroup).delete()
      })
    )
    assert.exists(await db.from('deleted_batches').where('id', cleanGroup).first())
    assert.exists(await db.from('allocations').where('id', rows[0]!.id).first())
    assert.isNull((await db.from('allocations').where('id', rows[1]!.id).first())!.deleted_batch_id)
  })
})
