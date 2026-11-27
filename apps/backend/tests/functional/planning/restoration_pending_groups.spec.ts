import { fixtureSession } from '#tests/helpers/identities'
import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import { readState } from '#tests/helpers/state_fixture'
import {
  companyId,
  configureAuth,
  resetPlanningFixture,
  session,
  signIn,
} from '#tests/functional/planning/helpers'
import {
  send,
  deleteOne,
  createAllocations,
  currentRevision,
  restorationGroup,
} from '#tests/functional/planning/restoration_helpers'

test.group('typed catalogue and time-off restoration', (suite) => {
  suite.setup(() => freshDatabase())
  suite.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('only an actual private-name change clears this company’s pending groups', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [allocationId] = await createAllocations(client, cookie, 1)
    const deleted = await deleteOne(client, cookie, allocationId!, 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().data.restoration.replacementGroupId
    const before = await readState(companyId, true)
    const target = before.projects.find((row) => !row.isPrivate)!
    const foreignGroup = randomUUID()
    await db.table('deleted_batches').insert({
      id: foreignGroup,
      company_id: 'a-loft',
      actor_id: 'other-actor',
      account_session_id: await fixtureSession('other-actor'),
      mutation_id: randomUUID(),
      created_at: new Date().toISOString(),
      consumed_at: null,
    })
    const settings = await send(
      client,
      cookie,
      companyId,
      2,
      {
        operation: 'settings.update',
        changes: { dateStyle: 'month-day' },
      },
      randomUUID()
    )
    settings.assertStatus(200)
    assert.isNotNull(await restorationGroup(groupId))
    const ordinary = await send(
      client,
      cookie,
      companyId,
      3,
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'projects',
          id: target.id,
          changes: { name: 'Gotham review', codeName: target.codeName },
        },
      },
      randomUUID()
    )
    ordinary.assertStatus(200)
    assert.isNotNull(await restorationGroup(groupId))
    const changed = await send(
      client,
      cookie,
      companyId,
      4,
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'projects',
          id: target.id,
          changes: { isPrivate: true, codeName: 'Gotham confidential' },
        },
      },
      randomUUID()
    )
    changed.assertStatus(409)
    assert.equal(changed.body().code, 'E_RESTORATION_CONFIRMATION_REQUIRED')
    assert.equal(changed.body().restorableItemCount, 1)
    assert.isNotNull(await restorationGroup(groupId))
    const confirmed = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 4,
        confirmedRestorationCount: 1,
        intent: {
          operation: 'catalogue.update',
          entity: {
            entity: 'projects',
            id: target.id,
            changes: { isPrivate: true, codeName: 'Gotham confidential' },
          },
        },
      })
      .send()
    confirmed.assertStatus(200)
    assert.isNull(await restorationGroup(groupId))
    assert.isNotNull(await restorationGroup(foreignGroup))
    assert.isNull(await db.from('allocations').where('id', allocationId!).first())
  })

  test('only an actual activity-kind change clears pending groups', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [allocationId] = await createAllocations(client, cookie, 1)
    const deleted = await deleteOne(client, cookie, allocationId!, 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().data.restoration.replacementGroupId
    const before = await readState(companyId, true)
    const activity = before.activities.find((row) => row.kind === 'internal')!
    const renamed = await send(
      client,
      cookie,
      companyId,
      2,
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'activities',
          id: activity.id,
          changes: { kind: activity.kind, name: 'Gotham planning' },
        },
      },
      randomUUID()
    )
    renamed.assertStatus(200)
    assert.isNotNull(await restorationGroup(groupId))
    const changed = await send(
      client,
      cookie,
      companyId,
      3,
      {
        operation: 'catalogue.update',
        entity: { entity: 'activities', id: activity.id, changes: { kind: 'allProjects' } },
      },
      randomUUID()
    )
    changed.assertStatus(409)
    assert.equal(changed.body().code, 'E_RESTORATION_CONFIRMATION_REQUIRED')
    assert.equal(changed.body().restorableItemCount, 1)
    assert.isNotNull(await restorationGroup(groupId))
    const confirmed = await session(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json({
        mutationId: randomUUID(),
        baseRevision: 3,
        confirmedRestorationCount: 1,
        intent: {
          operation: 'catalogue.update',
          entity: { entity: 'activities', id: activity.id, changes: { kind: 'allProjects' } },
        },
      })
      .send()
    confirmed.assertStatus(200)
    assert.isNull(await restorationGroup(groupId))
    assert.isNull(await db.from('allocations').where('id', allocationId!).first())
  })

  test('cleanup counts pending deleted rows of live sign-ins, excludes links and consumed groups, and rejects stale consent', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie, userId } = await signIn(client)
    const [allocationId] = await createAllocations(client, cookie, 1)
    const deletion = await deleteOne(client, cookie, allocationId!, 1)
    deletion.assertStatus(200)
    const before = await readState(companyId, true)
    const target = before.projects.find((row) => !row.isPrivate)!
    const retainedAllocation = await db.from('allocations').where('id', allocationId!).first()
    assert.isNotNull(retainedAllocation?.deleted_at)
    const other = randomUUID()
    const consumed = randomUUID()
    const otherRowIds = [randomUUID(), randomUUID()]
    const consumedRowId = randomUUID()
    for (const [id, consumedInstant] of [
      [other, null],
      [consumed, new Date().toISOString()],
    ] as const) {
      await db.table('deleted_batches').insert({
        id,
        company_id: companyId,
        actor_id: 'another-actor',
        account_session_id: await fixtureSession('another-actor'),
        mutation_id: randomUUID(),
        created_at: new Date().toISOString(),
        consumed_at: consumedInstant,
      })
      await db.table('deleted_rows').multiInsert([
        {
          deleted_batch_id: id,
          entity: 'allocations',
          row_id: id === other ? otherRowIds[0]! : consumedRowId,
          payload_json: JSON.stringify({ kind: 'row' }),
        },
        {
          deleted_batch_id: id,
          entity: 'allocations',
          row_id: id === other ? otherRowIds[1]! : randomUUID(),
          payload_json: JSON.stringify({ kind: 'row' }),
        },
        {
          deleted_batch_id: id,
          entity: 'activities',
          row_id: randomUUID(),
          payload_json: JSON.stringify({ kind: 'link', parentId: 'gotham' }),
        },
      ])
    }
    const retainedFixtureRow = (id: string, groupId: string) => ({
      ...retainedAllocation,
      id,
      deleted_batch_id: groupId,
    })
    await db
      .table('allocations')
      .insert([
        ...otherRowIds.map((id) => retainedFixtureRow(id, other)),
        retainedFixtureRow(consumedRowId, consumed),
      ])
    const mutationId = randomUUID()
    const intent = {
      operation: 'catalogue.update',
      entity: {
        entity: 'projects',
        id: target.id,
        changes: { isPrivate: true, codeName: 'Gotham confidential' },
      },
    }
    const request = (confirmedRestorationCount?: number, baseRevision = 2) =>
      session(client.visit('api.planning_mutations.store', { companyId }), cookie)
        .json({
          mutationId,
          baseRevision,
          intent,
          ...(confirmedRestorationCount === undefined ? {} : { confirmedRestorationCount }),
        } as never)
        .send()
    const refused = await request()
    refused.assertStatus(409)
    assert.equal(
      (refused.body() as unknown as { restorableItemCount?: number }).restorableItemCount,
      3
    )
    assert.deepEqual(await readState(companyId, true), before)
    assert.equal(await currentRevision(client, cookie), 2)
    assert.isNull(await db.from('planning_mutations').where('mutation_id', mutationId).first())
    // An expired sign-in's groups stop counting before pruning removes them, and neither changes
    // the planning revision.
    const otherGroup = await db.from('deleted_batches').where('id', other).first()
    await db
      .from('account_sessions')
      .where('id', otherGroup.account_session_id)
      .update({ expires_at: '2000-01-01T00:00:00.000Z' })
    const stale = await request(3)
    stale.assertStatus(409)
    assert.equal(
      (stale.body() as unknown as { code: string }).code,
      'E_RESTORATION_CONFIRMATION_STALE'
    )
    assert.equal(
      (stale.body() as unknown as { restorableItemCount?: number }).restorableItemCount,
      1
    )
    assert.deepEqual(await readState(companyId, true), before)
    const staleRevision = await request(1, 1)
    staleRevision.assertStatus(409)
    assert.equal((staleRevision.body() as unknown as { code: string }).code, 'E_STALE_REVISION')
    assert.isUndefined(
      (staleRevision.body() as unknown as { restorableItemCount?: number }).restorableItemCount
    )
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: userId })
      .update({ role: 'viewer' })
    const forbidden = await request(1)
    forbidden.assertStatus(403)
    assert.isUndefined(
      (forbidden.body() as unknown as { restorableItemCount?: number }).restorableItemCount
    )
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: userId })
      .update({ role: 'owner' })
    const confirmed = await request(1)
    confirmed.assertStatus(200)
    assert.isNull(await restorationGroup(deletion.body().data.restoration.replacementGroupId))
  })

  test('a failed privacy transaction retains its data and restoration group', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [allocationId] = await createAllocations(client, cookie, 1)
    const deleted = await deleteOne(client, cookie, allocationId!, 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().data.restoration.replacementGroupId
    const before = await readState(companyId, true)
    const target = before.projects.find((row) => !row.isPrivate)!
    await db.rawQuery(
      "CREATE TRIGGER reject_privacy_commit BEFORE INSERT ON planning_mutations BEGIN SELECT RAISE(ABORT, 'test rejection'); END"
    )
    try {
      const refused = await send(
        client,
        cookie,
        companyId,
        2,
        {
          operation: 'catalogue.update',
          entity: {
            entity: 'projects',
            id: target.id,
            changes: { isPrivate: true, codeName: 'Gotham confidential' },
          },
        },
        randomUUID(),
        1
      )
      refused.assertStatus(500)
      assert.isNotNull(await restorationGroup(groupId))
      const afterRefusal = await readState(companyId, true)
      assert.equal(
        afterRefusal.projects.find((row) => row.id === target.id)?.codeName,
        target.codeName
      )
      assert.equal(await currentRevision(client, cookie), 2)
    } finally {
      await db.rawQuery('DROP TRIGGER reject_privacy_commit')
    }
  })
})
