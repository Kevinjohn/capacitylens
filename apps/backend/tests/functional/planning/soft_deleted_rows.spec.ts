import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { resetAuthenticatedData } from '#tests/helpers/authenticated_data_fixture'
import { readState } from '#tests/helpers/state_fixture'
import { RetainedRowService } from '#services/planning/retained_row_service'
import { DisciplineWithLaterOrHooks } from '#tests/helpers/planning/soft_deleted_rows'

const retainedRows = new RetainedRowService()

test.group('soft-deleted rows', (group) => {
  group.setup(() => freshDatabase())

  test('keeps later subclass beforeFind and beforeFetch OR hooks inside the delete filter', async ({
    assert,
    client,
  }) => {
    await resetAuthenticatedData(client, 'single')
    const state = await readState('a-studio', true)
    const disciplineRow = state.disciplines[0]!
    await db.from('disciplines').where('id', disciplineRow.id).update({
      name: 'Wayne Foundation',
      deleted_at: '2026-10-02T00:00:00.000Z',
    })

    assert.isNull(
      await DisciplineWithLaterOrHooks.query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', disciplineRow.id)
        .first()
    )
    assert.isEmpty(
      await DisciplineWithLaterOrHooks.query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', disciplineRow.id)
        .exec()
    )
    assert.isObject(
      await DisciplineWithLaterOrHooks.query()
        .withTrashed()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', disciplineRow.id)
        .first()
    )
  })

  test('retained-row builders soft delete and purge only the selected company rows', async ({
    assert,
    client,
  }) => {
    await resetAuthenticatedData(client, true)
    const state = await readState(undefined, true)
    const [deletedLocal, activeLocal] = state.allocations.filter(
      (row) => row.companyId === 'a-studio'
    )
    const otherCompanyAllocation = state.allocations.find((row) => row.companyId === 'a-loft')!
    const before = await db.from('allocations').where('id', deletedLocal!.id).first()

    const softDeleted = await db.transaction((trx) =>
      retainedRows
        .buildRetainedQuery(trx, 'a-studio', 'allocations')
        .whereIn('id', [deletedLocal!.id, otherCompanyAllocation.id])
        .softDelete()
    )

    assert.equal(softDeleted, 1)
    const deleted = await db.from('allocations').where('id', deletedLocal!.id).first()
    assert.isNotNull(deleted.deleted_at)
    assert.equal(deleted.updated_at, before.updated_at)
    const untouched = await db.from('allocations').where('id', otherCompanyAllocation.id).first()
    assert.isNull(untouched.deleted_at)

    await db
      .from('allocations')
      .where('id', otherCompanyAllocation.id)
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' })
    const purged = await db.transaction((trx) =>
      retainedRows
        .buildRetainedQuery(trx, 'a-studio', 'allocations')
        .onlyTrashed()
        .whereIn('id', [deletedLocal!.id, activeLocal!.id, otherCompanyAllocation.id])
        .forceDelete()
    )

    assert.equal(purged, 1)
    assert.isNull(await db.from('allocations').where('id', deletedLocal!.id).first())
    assert.isObject(await db.from('allocations').where('id', activeLocal!.id).first())
    assert.isObject(await db.from('allocations').where('id', otherCompanyAllocation.id).first())
  })
})
