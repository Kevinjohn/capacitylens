import { fixtureSession } from '#tests/helpers/identities'
import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import Allocation from '#models/allocation'
import { readState } from '#tests/helpers/state_fixture'
import { insertProductRows } from '#tests/helpers/product_rows'
import app from '@adonisjs/core/services/app'
import { RestorationService } from '#services/planning/restoration_service'
import {
  companyId,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  signIn,
  validationSentence,
} from '#tests/helpers/planning/functional_helpers'
import {
  note,
  deleteOne,
  deleteAllocationBatch,
  restore,
  createAllocations,
  stored,
  currentRevision,
  readAllocationIds,
  markers,
  planningAudit,
  consumedAt,
} from '#tests/helpers/planning/restoration_helpers'

const restoration = await app.container.make(RestorationService)

test.group('session-bound allocation restoration', (suite) => {
  suite.setup(() => freshDatabase())
  suite.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('an unexpected restoration assertion escapes and rollback leaves the group reusable', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [id] = await createAllocations(client, cookie, 1)
    const deleted = await deleteOne(client, cookie, id!, 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().data.restoration.replacementGroupId
    const unexpected = new Error('SENTINEL_RESTORATION_ASSERTION')
    const retainedBefore = await db.from('allocations').where('id', id!).first()
    const revisionBefore = await currentRevision(client, cookie)
    const originalSerialize = Allocation.prototype.serialize
    try {
      Allocation.prototype.serialize = function (...args) {
        const serialized = originalSerialize.apply(this, args)
        if (this.id === id && this.deletionGroupId === groupId)
          Object.defineProperty(serialized, 'activityId', {
            configurable: true,
            get() {
              throw unexpected
            },
          })
        return serialized
      }
      const failed = await restore(client, cookie, groupId, revisionBefore)
      failed.assertStatus(500)
    } finally {
      Allocation.prototype.serialize = originalSerialize
    }
    assert.isNull(await consumedAt(groupId))
    assert.equal(await currentRevision(client, cookie), revisionBefore)
    assert.deepEqual(await db.from('allocations').where('id', id!).first(), retainedBefore)
    const retry = await restore(client, cookie, groupId, revisionBefore)
    retry.assertStatus(200)
    assert.isDefined(await stored(id!))
  })

  test('delete and restore repeat with a fresh group each time and keep the row intact', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [id] = await createAllocations(client, cookie, 1)
    const original = await stored(id!)
    assert.equal(original?.note, note)
    const mutations: Array<{ mutationId: string; action: string }> = []
    const groups: string[] = []
    let revision = 1
    for (const round of [1, 2]) {
      const deleteId = randomUUID()
      const deleted = await deleteOne(client, cookie, id!, revision, deleteId)
      deleted.assertStatus(200)
      revision += 1
      assert.equal(deleted.body().data.revision, revision)
      assert.isNull(deleted.body().data.restoration.consumedGroupId)
      const groupId = deleted.body().data.restoration.replacementGroupId
      assert.isString(groupId)
      assert.notInclude(groups, groupId, `round ${round} must mint a new group`)
      groups.push(groupId)
      assert.notInclude(await readAllocationIds(client, cookie), id!)
      assert.notInclude(deleted.text(), note)
      assert.isUndefined(await stored(id!))
      const retained = await db.from('allocations').where('id', id!).first()
      assert.isDefined(retained)
      assert.isNotNull(retained.deleted_at)
      assert.equal(retained.deletion_group_id, groupId)
      const ledger = await db.from('deleted_rows').where('group_id', groupId).first()
      assert.deepEqual(JSON.parse(ledger.payload_json), { kind: 'row' })
      assert.equal(ledger.entity, 'allocations')
      assert.equal(ledger.row_id, id)
      assert.notInclude(ledger.payload_json, note)
      mutations.push({ mutationId: deleteId, action: 'allocation.delete' })

      const restoreId = randomUUID()
      const restored = await restore(client, cookie, groupId, revision, restoreId)
      restored.assertStatus(200)
      revision += 1
      assert.equal(restored.body().data.revision, revision)
      assert.deepEqual(restored.body().data.restoration, {
        consumedGroupId: groupId,
        replacementGroupId: null,
      })
      assert.deepEqual(await stored(id!), original)
      const restoredRow = await db.from('allocations').where('id', id!).first()
      assert.isNull(restoredRow.deleted_at)
      assert.isNull(restoredRow.deletion_group_id)
      mutations.push({ mutationId: restoreId, action: 'planning.restoreGroup' })
    }
    assert.equal(await currentRevision(client, cookie), 5)
    assert.lengthOf(await markers(), 5)
    const audit = await planningAudit()
    assert.lengthOf(audit, 5)
    for (const { mutationId, action } of mutations)
      assert.deepEqual(
        audit.filter((row) => row.entity_id === mutationId).map((row) => row.action),
        [action]
      )
  })

  for (const changed of [
    'archived activity',
    'invalid activity',
    'external resource',
    'changed availability',
  ] as const) {
    test(`restore refuses ${changed} atomically and permits retry after repair`, async ({
      client,
      assert,
      cleanup,
    }) => {
      configureAuth(cleanup)
      const { cookie } = await signIn(client)
      const [id] = await createAllocations(client, cookie, 1)
      const original = (await stored(id!))!
      const deleted = await deleteOne(client, cookie, id!, 1)
      deleted.assertStatus(200)
      const groupId = deleted.body().data.restoration.replacementGroupId
      const table = changed.includes('activity') ? 'activities' : 'resources'
      const targetId = table === 'activities' ? original.activityId : original.resourceId
      const target = await db.from(table).where('id', targetId).first()
      const changes =
        changed === 'archived activity'
          ? { archived_at: new Date().toISOString() }
          : changed === 'invalid activity'
            ? { kind: 'project', project_id: null }
            : changed === 'external resource'
              ? { kind: 'external' }
              : { first_available_date: '2026-12-01' }
      await db.from(table).where('id', targetId).update(changes)
      const before = await readState(companyId, true)
      const failed = await restore(client, cookie, groupId, 2)
      failed.assertStatus(409)
      assert.deepEqual(await readState(companyId, true), before)
      assert.isNull(await consumedAt(groupId))
      assert.equal(await currentRevision(client, cookie), 2)
      assert.lengthOf(await markers(), 2)
      assert.lengthOf(await planningAudit(), 2)
      await db.from(table).where('id', targetId).update(target)
      const retried = await restore(client, cookie, groupId, 2)
      retried.assertStatus(200)
      assert.deepEqual(await stored(id!), original)
    })
  }

  test('a consumed group refuses a second restore with 409 and changes nothing', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [id] = await createAllocations(client, cookie, 1)
    const deleted = await deleteOne(client, cookie, id!, 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().data.restoration.replacementGroupId
    const restored = await restore(client, cookie, groupId, 2)
    restored.assertStatus(200)
    const before = await readState(companyId, true)
    const again = await restore(client, cookie, groupId, 3)
    again.assertStatus(409)
    assert.isUndefined(again.body().code)
    assert.deepEqual(await readState(companyId, true), before)
    assert.equal(await currentRevision(client, cookie), 3)
    assert.lengthOf(await markers(), 3)
    assert.lengthOf(await planningAudit(), 3)
  })

  test('deleting listed allocations keeps unlisted rows and an unknown id deletes nothing', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [first, second, kept] = await createAllocations(client, cookie, 3)
    const keptRow = await stored(kept!)
    const deleted = await deleteAllocationBatch(client, cookie, [first!, second!], 1)
    deleted.assertStatus(200)
    const readIds = await readAllocationIds(client, cookie)
    assert.notInclude(readIds, first!)
    assert.notInclude(readIds, second!)
    assert.include(readIds, kept!)
    assert.isUndefined(await stored(first!))
    assert.isUndefined(await stored(second!))
    assert.deepEqual(await stored(kept!), keptRow)
    const before = await readState(companyId, true)
    const partial = await deleteAllocationBatch(client, cookie, [kept!, randomUUID()], 2)
    partial.assertStatus(422)
    assert.isString(validationSentence(partial))
    assert.deepEqual(await readState(companyId, true), before)
    assert.lengthOf(await db.from('deleted_groups'), 1)
    const restored = await restore(
      client,
      cookie,
      deleted.body().data.restoration.replacementGroupId,
      2
    )
    restored.assertStatus(200)
    const after = await readState(companyId, true)
    assert.lengthOf(
      after.allocations.filter((row) => ([first, second, kept] as string[]).includes(row.id)),
      3
    )
  })

  test('a group larger than one SQLite compound select deletes and restores as one mutation', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [kept] = await createAllocations(client, cookie, 1)
    // Seed an existing large series so this exercises the delete and restore request limits.
    const allocation = (await stored(kept!))!
    const listed = Array.from({ length: 501 }, () => randomUUID())
    await insertProductRows(
      'allocations',
      listed.map((id) => ({ ...allocation, id }))
    )
    const before = await readState(companyId, true)
    const deleted = await deleteAllocationBatch(client, cookie, listed, 1)
    deleted.assertStatus(200)
    assert.equal(deleted.body().data.revision, 2)
    const readIds = await readAllocationIds(client, cookie)
    assert.isFalse(listed.some((id) => readIds.includes(id)))
    assert.notInclude(deleted.text(), note)
    const groupId = deleted.body().data.restoration.replacementGroupId
    assert.isString(groupId)
    assert.lengthOf(await db.from('deleted_groups'), 1)
    assert.lengthOf(await db.from('deleted_rows').where('group_id', groupId), 501)
    const afterDelete = await readState(companyId, true)
    assert.lengthOf(
      afterDelete.allocations.filter((row) => (listed as string[]).includes(row.id)),
      0
    )
    assert.deepEqual(
      await stored(kept!),
      before.allocations.find((row) => row.id === kept)
    )
    assert.lengthOf(await markers(), 2)
    assert.lengthOf(await planningAudit(), 2)
    const restored = await restore(client, cookie, groupId, 2)
    restored.assertStatus(200)
    assert.equal(restored.body().data.revision, 3)
    const afterRestore = await readState(companyId, true)
    assert.sameDeepMembers(afterRestore.allocations, before.allocations)
    assert.lengthOf(await markers(), 3)
    assert.lengthOf(await planningAudit(), 3)
  })

  test('a group beyond the SQLite variable limit deletes exactly its listed rows in one group', async ({
    assert,
  }) => {
    // 32,766 ids plus the company filter exceed SQLite's 32,766 bound variables in one statement.
    const listedCount = 32_766
    const seeded = await readState(companyId, true)
    const now = new Date().toISOString()
    const rows = Array.from({ length: listedCount + 1 }, () => ({
      ...newAllocation(seeded),
      companyId,
      note,
      createdAt: now,
      updatedAt: now,
    }))
    // Stored directly in column form: 32,767 single-row model inserts would dominate the suite.
    const columnOf = (key: string) => Allocation.$keys.attributesToColumns.resolve(key)
    const columnRows = rows.map((row) =>
      Object.fromEntries(Object.entries(row).map(([key, value]) => [columnOf(key), value]))
    )
    for (let start = 0; start < columnRows.length; start += 500)
      await db.table('allocations').multiInsert(columnRows.slice(start, start + 500))
    const [kept, ...listed] = rows.map((row) => String(row.id))
    const otherCompanies = () =>
      db.from('allocations').whereNot('company_id', companyId).count('* as n')
    const othersBefore = await otherCompanies()
    assert.isAbove(Number(othersBefore[0].n), 0)
    const data = await readState(companyId, true)
    // The delete removes its rows from `data` too, so count them first.
    const storedCount = data.allocations.length
    const sessionId = await fixtureSession('u-bruce')
    const groupId = await db.transaction((trx) =>
      restoration.deleteAllocations(trx, data, companyId, listed, {
        actorId: 'u-bruce',
        sessionId,
        mutationId: randomUUID(),
      })
    )
    assert.lengthOf(await db.from('deleted_groups'), 1)
    const saved = await db.from('deleted_rows').where('group_id', groupId).select('row_id')
    assert.lengthOf(saved, listedCount)
    const listedIds = new Set(listed)
    assert.isTrue(saved.every((row) => listedIds.has(String(row.row_id))))
    const remaining = await readState(companyId, true)
    assert.lengthOf(remaining.allocations, storedCount - listedCount)
    assert.isFalse(remaining.allocations.some((row) => listedIds.has(row.id)))
    assert.deepEqual(
      remaining.allocations.find((row) => row.id === kept),
      data.allocations.find((row) => row.id === kept)
    )
    assert.deepEqual(await otherCompanies(), othersBefore)
    // Each listed row is deleted through its model in its own statement.
  }).timeout(120_000)

  test('a listed row deleted since the snapshot refuses the whole deletion', async ({ assert }) => {
    const data = await readState(companyId, true)
    const [first, second] = data.allocations.map((row) => row.id)
    assert.isDefined(second)
    await db
      .from('allocations')
      .where('id', second!)
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' })
    const listed = [first!, second!]
    const before = await db.from('allocations').whereIn('id', listed).orderBy('id')
    const sessionId = await fixtureSession('u-bruce')
    await assert.rejects(
      () =>
        db.transaction((trx) =>
          restoration.deleteAllocations(trx, data, companyId, listed, {
            actorId: 'u-bruce',
            sessionId,
            mutationId: randomUUID(),
          })
        ),
      /can no longer be restored/
    )
    assert.deepEqual(await db.from('allocations').whereIn('id', listed).orderBy('id'), before)
    assert.lengthOf(await db.from('deleted_groups'), 0)
  })

  test('a child moved off its parent since the snapshot refuses the parent deletion', async ({
    assert,
  }) => {
    const data = await readState(companyId, true)
    const resource = data.resources.find((row) => row.disciplineId !== null)
    assert.isDefined(resource)
    const disciplineId = resource!.disciplineId!
    await db.from('resources').where('id', resource!.id).update({ discipline_id: null })
    const resourcesBefore = await db.from('resources').orderBy('id')
    const sessionId = await fixtureSession('u-bruce')
    await assert.rejects(
      () =>
        db.transaction((trx) =>
          restoration.deleteRows(trx, data, companyId, 'disciplines', [disciplineId], {
            actorId: 'u-bruce',
            sessionId,
            mutationId: randomUUID(),
          })
        ),
      /can no longer be restored/
    )
    assert.deepEqual(await db.from('resources').orderBy('id'), resourcesBefore)
    const discipline = await db.from('disciplines').where('id', disciplineId).first()
    assert.isNull(discipline.deleted_at)
    assert.lengthOf(await db.from('deleted_groups'), 0)
  })

  test('stale delete and restore revisions return 409 without effects', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [id, other] = await createAllocations(client, cookie, 2)
    const staleDelete = await deleteOne(client, cookie, id!, 0)
    staleDelete.assertStatus(409)
    assert.equal(staleDelete.body().code, 'E_STALE_REVISION')
    assert.isDefined(await stored(id!))
    assert.lengthOf(await db.from('deleted_groups'), 0)
    const deleted = await deleteOne(client, cookie, other!, 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().data.restoration.replacementGroupId
    const before = await readState(companyId, true)
    const staleRestore = await restore(client, cookie, groupId, 1)
    staleRestore.assertStatus(409)
    assert.equal(staleRestore.body().code, 'E_STALE_REVISION')
    assert.deepEqual(await readState(companyId, true), before)
    assert.isNull(await consumedAt(groupId))
    assert.lengthOf(await markers(), 2)
  })

  test('a failed reinsertion consumes nothing and leaves the group restorable', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [first, second] = await createAllocations(client, cookie, 2)
    const deleted = await deleteAllocationBatch(client, cookie, [first!, second!], 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().data.restoration.replacementGroupId
    const before = await readState(companyId, true)
    const retainedBefore = await db.from('allocations').where('id', second!).first()
    assert.isNotNull(retainedBefore.deleted_at)
    assert.equal(retainedBefore.deletion_group_id, groupId)
    await db.rawQuery(`CREATE TEMP TRIGGER restore_constraint_failure
      BEFORE UPDATE OF deleted_at ON allocations
      WHEN NEW.id = '${second}' AND NEW.deleted_at IS NULL
      BEGIN SELECT RAISE(ABORT, 'test constraint failure'); END`)
    try {
      const failed = await restore(client, cookie, groupId, 2)
      assert.isAtLeast(failed.status(), 400)
      assert.notEqual(failed.status(), 404)
    } finally {
      await db.rawQuery('DROP TRIGGER restore_constraint_failure')
    }
    assert.deepEqual(await readState(companyId, true), before)
    assert.isNull(await consumedAt(groupId))
    const retainedAfterFailure = await db.from('allocations').where('id', second!).first()
    assert.isNotNull(retainedAfterFailure.deleted_at)
    assert.equal(retainedAfterFailure.deletion_group_id, groupId)
    assert.equal(await currentRevision(client, cookie), 2)
    const restored = await restore(client, cookie, groupId, 2)
    restored.assertStatus(200)
    assert.isDefined(await stored(first!))
    assert.isDefined(await stored(second!))
    const restoredSecond = await db.from('allocations').where('id', second!).first()
    assert.isNull(restoredSecond.deleted_at)
    assert.isNull(restoredSecond.deletion_group_id)
  })
})
