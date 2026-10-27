import { test } from '@japa/runner'
import { rejects } from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { beforeFetch, beforeFind } from '@adonisjs/lucid/orm'
import type { ModelQueryBuilderContract } from '@adonisjs/lucid/types/model'
import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import { freshDatabase } from '../helpers/fresh_database.js'
import { resetAuthenticatedData } from '../helpers/authenticated_data_fixture.js'
import { readState } from '#services/state_repository'
import { writeAudit } from '#services/audit'
import { deleteAllocations } from '#services/planning_operations/restoration'
import {
  restoreArchivedEntity,
  softDeleteArchivedEntity,
  SoftDeletePolicyError,
} from '#services/soft_deletes'
import Client from '#models/client'
import { advancePlanningRevision, getPlanningRevision } from '#services/planning_revision'

class ClientWithLaterOrHooks extends Client {
  static table = 'clients'

  @beforeFind()
  static addFindOrCondition(query: ModelQueryBuilderContract<typeof ClientWithLaterOrHooks>) {
    void query.orWhere('name', 'Wayne Foundation')
  }

  @beforeFetch()
  static addFetchOrCondition(query: ModelQueryBuilderContract<typeof ClientWithLaterOrHooks>) {
    void query.orWhere('name', 'Wayne Foundation')
  }
}

test.group('soft delete adoption', (group) => {
  group.setup(() => freshDatabase())

  test('deletes and restores an archived row through its model while preserving archive and updatedAt', async ({
    assert,
    client,
  }) => {
    const { userId } = await resetAuthenticatedData(client, 'single')
    const before = await readState('a-studio', true)
    const clientRow = before.clients.find((row) => row.builtin !== true)!
    const allocation = before.allocations[0]!
    await db.from('clients').where({ id: clientRow.id, account_id: 'a-studio' }).update({
      archived_at: '2026-10-01T00:00:00.000Z',
    })
    const originalUpdatedAt = clientRow.updatedAt
    const initialRevision = await db.transaction((trx) => getPlanningRevision(trx, 'a-studio'))
    const restorationIdentity = {
      actorId: userId,
      sessionId: 1,
      mutationId: randomUUID(),
    }
    const groupId = await db.transaction((trx) =>
      deleteAllocations(trx, before, 'a-studio', [allocation.id], restorationIdentity)
    )

    await db.transaction(async (trx) => {
      await softDeleteArchivedEntity(trx, userId, 'a-studio', 'clients', clientRow.id)
      await advancePlanningRevision(trx, 'a-studio')
      await writeAudit(trx, {
        accountId: 'a-studio',
        actorId: userId,
        action: 'lifecycle.soft_deleted',
        entity: 'clients',
        entityId: clientRow.id,
        fields: ['deletedAt'],
      })
    })

    const deleted = await db.from('clients').where('id', clientRow.id).first()
    assert.isNotNull(deleted.deleted_at)
    assert.equal(deleted.archived_at, '2026-10-01T00:00:00.000Z')
    assert.equal(deleted.updated_at, originalUpdatedAt)
    assert.equal(
      await db.transaction((trx) => getPlanningRevision(trx, 'a-studio')),
      initialRevision + 1
    )
    assert.isObject(
      await db
        .from('audit_entries')
        .where({ account_id: 'a-studio', actor_id: userId, entity_id: clientRow.id })
        .first()
    )
    assert.isNull(
      await Client.query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', clientRow.id)
        .first()
    )
    const trashed = await Client.query()
      .withTrashed()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .where('id', clientRow.id)
      .firstOrFail()
    assert.isTrue(DateTime.isDateTime(trashed.deletedAt))
    assert.match(trashed.serialize().deletedAt, /^\d{4}-\d\d-\d\dT.*\.\d{3}Z$/)
    const invalid = new Client()
    invalid.deletedAt = DateTime.invalid('test-invalid')
    assert.throws(() => invalid.serialize(), /Invalid soft-delete timestamp in model serialization/)

    const complete = await readState('a-studio', true)
    assert.equal(
      complete.clients.find((row) => row.id === clientRow.id)?.deletedAt,
      deleted.deleted_at
    )
    const activeProjection = await readState('a-studio')
    assert.notInclude(
      activeProjection.clients.map((row) => row.id),
      clientRow.id
    )

    await db.transaction((trx) =>
      restoreArchivedEntity(trx, userId, 'a-studio', 'clients', clientRow.id)
    )
    const restored = await db.from('clients').where('id', clientRow.id).first()
    assert.isNull(restored.deleted_at)
    assert.equal(restored.archived_at, '2026-10-01T00:00:00.000Z')
    assert.equal(restored.updated_at, originalUpdatedAt)

    const pendingGroup = await db.from('deleted_groups').where('group_id', groupId).first()
    assert.isNull(pendingGroup.consumed_at)
    const pendingRows = await db.from('deleted_rows').where('group_id', groupId).select('row_id')
    assert.lengthOf(pendingRows, 1)
  })

  test('requires an authorized company administrator and an archived row', async ({
    assert,
    client,
  }) => {
    const { userId } = await resetAuthenticatedData(client, 'single')
    const state = await readState('a-studio', true)
    const clientRow = state.clients.find((row) => row.builtin !== true)!
    await db.from('memberships').where({ user_id: userId, account_id: 'a-studio' }).update({
      role: 'viewer',
    })

    await rejects(
      () =>
        db.transaction((trx) =>
          softDeleteArchivedEntity(trx, userId, 'a-studio', 'clients', clientRow.id)
        ),
      (error: unknown) =>
        error instanceof SoftDeletePolicyError && error.code === 'forbidden' && error.status === 403
    )
    await db.from('memberships').where({ user_id: userId, account_id: 'a-studio' }).update({
      role: 'owner',
    })
    await assert.rejects(
      () =>
        db.transaction((trx) =>
          softDeleteArchivedEntity(trx, userId, 'a-studio', 'clients', clientRow.id)
        ),
      /Archive this record before deleting it/
    )
    const unchanged = await db.from('clients').where('id', clientRow.id).first()
    assert.isNull(unchanged.deleted_at)
  })

  test('keeps later subclass beforeFind and beforeFetch OR hooks inside the delete filter', async ({
    assert,
    client,
  }) => {
    await resetAuthenticatedData(client, 'single')
    const state = await readState('a-studio', true)
    const clientRow = state.clients.find((row) => row.builtin !== true)!
    await db.from('clients').where('id', clientRow.id).update({
      name: 'Wayne Foundation',
      deleted_at: '2026-10-02T00:00:00.000Z',
    })

    assert.isNull(
      await ClientWithLaterOrHooks.query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', clientRow.id)
        .first()
    )
    assert.isEmpty(
      await ClientWithLaterOrHooks.query()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', clientRow.id)
        .exec()
    )
    assert.isObject(
      await ClientWithLaterOrHooks.query()
        .withTrashed()
        .withScopes((scopes) => scopes.forCompany('a-studio'))
        .where('id', clientRow.id)
        .first()
    )
  })

  test('keeps a complete company read across model hooks while active projection hides descendants', async ({
    assert,
    client,
  }) => {
    await resetAuthenticatedData(client, true)
    const state = await readState('a-studio', true)
    const clientRow = state.clients.find((row) => row.builtin !== true)!
    const project = state.projects.find((row) => row.clientId === clientRow.id)!
    const activity = state.activities.find((row) => row.projectId === project.id)!
    const deletedActivity = state.activities.find((row) => row.id !== activity.id)!
    const deletedResource = state.resources[0]!
    await db
      .from('clients')
      .where({ id: clientRow.id, account_id: 'a-studio' })
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' })
    await db
      .from('projects')
      .where({ id: project.id, account_id: 'a-studio' })
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' })
    await db
      .from('activities')
      .where({ id: deletedActivity.id, account_id: 'a-studio' })
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' })
    await db
      .from('resources')
      .where({ id: deletedResource.id, account_id: 'a-studio' })
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' })

    const complete = await readState('a-studio', true)
    assert.isString(complete.clients.find((row) => row.id === clientRow.id)?.deletedAt)
    assert.isString(complete.projects.find((row) => row.id === project.id)?.deletedAt)
    assert.isString(complete.activities.find((row) => row.id === deletedActivity.id)?.deletedAt)
    assert.isString(complete.resources.find((row) => row.id === deletedResource.id)?.deletedAt)
    assert.isTrue(complete.projects.some((row) => row.id === project.id))
    assert.isTrue(complete.activities.some((row) => row.id === activity.id))
    const projected = await readState('a-studio')
    assert.notInclude(
      projected.clients.map((row) => row.id),
      clientRow.id
    )
    assert.notInclude(
      projected.projects.map((row) => row.id),
      project.id
    )
    assert.notInclude(
      projected.activities.map((row) => row.id),
      activity.id
    )
    assert.notInclude(
      projected.activities.map((row) => row.id),
      deletedActivity.id
    )
    assert.notInclude(
      projected.resources.map((row) => row.id),
      deletedResource.id
    )

    const parentWithDefaultChildren = await Client.query()
      .withTrashed()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .where('id', clientRow.id)
      .preload('projects', (query) => {
        void query.where('id', project.id).withScopes((scopes) => scopes.forCompany('a-studio'))
      })
      .firstOrFail()
    assert.isEmpty(parentWithDefaultChildren.projects)

    const parentWithDeletedProject = await Client.query()
      .withTrashed()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .where('id', clientRow.id)
      .preload('projects', (query) => {
        void query
          .withTrashed()
          .where('id', project.id)
          .withScopes((scopes) => scopes.forCompany('a-studio'))
          .preload('activities', (activityQuery) => {
            void activityQuery.withScopes((scopes) => scopes.forCompany('a-studio'))
          })
      })
      .firstOrFail()
    assert.equal(parentWithDeletedProject.projects.length, 1)
    assert.include(
      parentWithDeletedProject.projects[0]!.activities.map((row) => row.id),
      activity.id
    )
  })

  test('rolls back model mutation, revision and audit writes with the caller transaction', async ({
    assert,
    client,
  }) => {
    const { userId } = await resetAuthenticatedData(client, 'single')
    const state = await readState('a-studio', true)
    const clientRow = state.clients.find((row) => row.builtin !== true)!
    await db.from('clients').where('id', clientRow.id).update({
      archived_at: '2026-10-01T00:00:00.000Z',
    })
    const initialRevision = await db.transaction((trx) => getPlanningRevision(trx, 'a-studio'))
    await assert.rejects(() =>
      db.transaction(async (trx) => {
        await softDeleteArchivedEntity(trx, userId, 'a-studio', 'clients', clientRow.id)
        await advancePlanningRevision(trx, 'a-studio')
        await writeAudit(trx, {
          accountId: 'a-studio',
          actorId: userId,
          action: 'lifecycle.soft_deleted',
          entity: 'clients',
          entityId: clientRow.id,
          fields: ['deletedAt'],
        })
        throw new Error('later transaction work failed')
      })
    )

    const rolledBack = await db.from('clients').where('id', clientRow.id).first()
    assert.isNull(rolledBack.deleted_at)
    const finalRevision = await db.transaction((trx) => getPlanningRevision(trx, 'a-studio'))
    assert.equal(finalRevision, initialRevision)
    assert.isNull(
      await db
        .from('audit_entries')
        .where({ account_id: 'a-studio', actor_id: userId, entity_id: clientRow.id })
        .first()
    )
  })

  test('builder force deletion is limited to selected trashed rows and retains other tenants', async ({
    assert,
    client,
  }) => {
    const { userId } = await resetAuthenticatedData(client, true)
    const state = await readState(undefined, true)
    const local = state.clients.find((row) => row.accountId === 'a-studio' && row.builtin !== true)!
    const otherTenant = state.clients.find(
      (row) => row.accountId === 'a-loft' && row.builtin !== true
    )!
    await assert.rejects(
      () =>
        db.transaction((trx) =>
          softDeleteArchivedEntity(trx, userId, 'a-studio', 'clients', otherTenant.id)
        ),
      /The record was not found/
    )
    const activeLocal = state.clients.find(
      (row) => row.accountId === 'a-studio' && row.builtin === true
    )!
    await db
      .from('clients')
      .where('id', local.id)
      .update({ deleted_at: '2026-10-02T00:00:00.000Z' })

    const builderDeleted = await Client.query()
      .withScopes((scopes) => scopes.forCompany('a-loft'))
      .where({ accountId: 'a-loft', id: otherTenant.id })
      .softDelete()
    assert.equal(builderDeleted, 1)
    const softDeletedByBuilder = await Client.query()
      .onlyTrashed()
      .withScopes((scopes) => scopes.forCompany('a-loft'))
      .where('id', otherTenant.id)
      .firstOrFail()
    assert.isTrue(DateTime.isDateTime(softDeletedByBuilder.deletedAt))
    assert.match(softDeletedByBuilder.serialize().deletedAt, /^\d{4}-\d\d-\d\dT.*\.\d{3}Z$/)

    const purged = await Client.query()
      .onlyTrashed()
      .withScopes((scopes) => scopes.forCompany('a-studio'))
      .where('accountId', 'a-studio')
      .whereIn('id', [local.id, activeLocal.id, otherTenant.id])
      .forceDelete()

    assert.equal(purged, 1)
    assert.isNull(await db.from('clients').where('id', local.id).first())
    assert.isObject(await db.from('clients').where('id', otherTenant.id).first())
    assert.isObject(await db.from('clients').where('id', activeLocal.id).first())
  })
})
