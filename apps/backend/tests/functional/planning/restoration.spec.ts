import { randomUUID } from 'node:crypto'
import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { encodeRow, readState } from '#services/state_repository'
import { withTransaction } from '#services/with_transaction'
import { deleteAllocations } from '#services/planning_operations/restoration'
import {
  accountId,
  planningUrl,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
  signInAgain,
} from './helpers.js'

const allocationsUrl = `/api/accounts/${accountId}/allocations`
const note = 'Gotham night shift briefing'

interface Reply {
  revision: number
  code?: string
  restoration: { consumedGroupId: string | null; replacementGroupId: string }
  projection: { changed: { removed: Array<{ entity: string; id: string }> } }
}

async function send(
  client: ApiClient,
  cookie: string,
  url: string,
  baseRevision: number,
  intent: Record<string, unknown>,
  mutationId: string = randomUUID(),
  method: 'post' | 'patch' = 'post'
) {
  const response = await session(method === 'post' ? client.post(url) : client.patch(url), cookie)
    .json({ mutationId, baseRevision, intent })
    .send()
  // Only the receipt fields exercised by these restoration tests are read.
  return response as unknown as Omit<typeof response, 'body'> & { body(): Reply }
}

const deleteOne = (
  client: ApiClient,
  cookie: string,
  id: string,
  baseRevision: number,
  mutationId?: string
) =>
  send(
    client,
    cookie,
    `${allocationsUrl}/${id}/delete`,
    baseRevision,
    { operation: 'allocation.delete', id },
    mutationId
  )

const deleteGroup = (client: ApiClient, cookie: string, ids: string[], baseRevision: number) =>
  send(client, cookie, `${allocationsUrl}/delete-group`, baseRevision, {
    operation: 'allocation.deleteGroup',
    ids,
  })

const restore = (
  client: ApiClient,
  cookie: string,
  restorationGroupId: string,
  baseRevision: number,
  mutationId?: string,
  account = accountId
) =>
  send(
    client,
    cookie,
    `/api/accounts/${account}/planning/restore-group`,
    baseRevision,
    { operation: 'planning.restoreGroup', restorationGroupId },
    mutationId
  )

async function createAllocations(client: ApiClient, cookie: string, count: number) {
  const data = await readState(accountId, true)
  const allocations = Array.from({ length: count }, () => ({
    ...newAllocation(data),
    note,
    task: 'Watchtower rota',
  }))
  const created = await send(client, cookie, `${allocationsUrl}/create-group`, 0, {
    operation: 'allocation.createGroup',
    allocations,
  })
  created.assertStatus(200)
  return allocations.map((row) => row.id)
}

async function stored(id: string) {
  const state = await readState(accountId, true)
  return state.allocations.find((row) => row.id === id)
}

async function currentRevision(client: ApiClient, cookie: string, account = accountId) {
  const snapshot = await session(client.get(`/api/accounts/${account}/planning`), cookie).send()
  snapshot.assertStatus(200)
  return Number((snapshot.body() as { revision: number }).revision)
}

const markers = () => db.from('planning_mutations').where('account_id', accountId)
const planningAudit = () =>
  db
    .from('audit_entries')
    .where({ account_id: accountId, entity: 'planning' })
    .select('entity_id', 'action')
const group = (groupId: string) => db.from('deleted_groups').where('group_id', groupId).first()
async function consumedAt(groupId: string) {
  const row = await group(groupId)
  return row?.consumed_at
}

test.group('session-bound allocation restoration', (suite) => {
  suite.setup(() => freshDatabase())
  suite.each.setup(async () => {
    await resetPlanningFixture()
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
      assert.equal(deleted.body().revision, revision)
      assert.isNull(deleted.body().restoration.consumedGroupId)
      const groupId = deleted.body().restoration.replacementGroupId
      assert.isString(groupId)
      assert.notInclude(groups, groupId, `round ${round} must mint a new group`)
      groups.push(groupId)
      assert.deepEqual(deleted.body().projection.changed.removed, [{ entity: 'allocations', id }])
      assert.notInclude(deleted.text(), note)
      assert.isUndefined(await stored(id!))
      mutations.push({ mutationId: deleteId, action: 'allocation.delete' })

      const restoreId = randomUUID()
      const restored = await restore(client, cookie, groupId, revision, restoreId)
      restored.assertStatus(200)
      revision += 1
      assert.equal(restored.body().revision, revision)
      assert.deepEqual(restored.body().restoration, {
        consumedGroupId: groupId,
        replacementGroupId: null,
      })
      assert.deepEqual(await stored(id!), original)
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
    const groupId = deleted.body().restoration.replacementGroupId
    const restored = await restore(client, cookie, groupId, 2)
    restored.assertStatus(200)
    const before = await readState(accountId, true)
    const again = await restore(client, cookie, groupId, 3)
    again.assertStatus(409)
    assert.isUndefined(again.body().code)
    assert.deepEqual(await readState(accountId, true), before)
    assert.equal(await currentRevision(client, cookie), 3)
    assert.lengthOf(await markers(), 3)
    assert.lengthOf(await planningAudit(), 3)
  })

  test('another session, actor or company cannot restore and the group stays usable', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const owner = await signIn(client)
    const [id] = await createAllocations(client, owner.cookie, 1)
    const deleted = await deleteOne(client, owner.cookie, id!, 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().restoration.replacementGroupId
    const editor = await signIn(client, 'editor')
    const otherSession = await signInAgain(client, owner.email)
    const now = new Date().toISOString()
    await db.table('memberships').insert({
      id: randomUUID(),
      account_id: 'a-loft',
      user_id: owner.userId,
      role: 'owner',
      status: 'active',
      created_at: now,
      updated_at: now,
    })
    const loftRevision = await currentRevision(client, owner.cookie, 'a-loft')
    const loftBefore = await readState('a-loft', true)
    const studioBefore = await readState(accountId, true)
    const attempts = [
      await restore(client, editor.cookie, groupId, 2),
      await restore(client, otherSession, groupId, 2),
      await restore(client, owner.cookie, groupId, loftRevision, undefined, 'a-loft'),
    ]
    for (const refused of attempts) {
      refused.assertStatus(403)
      assert.equal(refused.body().code, 'authorization_denied')
    }
    assert.deepEqual(await readState(accountId, true), studioBefore)
    assert.deepEqual(await readState('a-loft', true), loftBefore)
    assert.isNull(await consumedAt(groupId))
    assert.equal(await currentRevision(client, owner.cookie), 2)
    assert.equal(await currentRevision(client, owner.cookie, 'a-loft'), loftRevision)
    assert.lengthOf(
      await db.from('planning_mutations').whereIn('account_id', [accountId, 'a-loft']),
      2
    )
    const restored = await restore(client, owner.cookie, groupId, 2)
    restored.assertStatus(200)
    assert.isDefined(await stored(id!))
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
    const deleted = await deleteGroup(client, cookie, [first!, second!], 1)
    deleted.assertStatus(200)
    assert.sameDeepMembers(deleted.body().projection.changed.removed, [
      { entity: 'allocations', id: first },
      { entity: 'allocations', id: second },
    ])
    assert.isUndefined(await stored(first!))
    assert.isUndefined(await stored(second!))
    assert.deepEqual(await stored(kept!), keptRow)
    const before = await readState(accountId, true)
    const partial = await deleteGroup(client, cookie, [kept!, randomUUID()], 2)
    partial.assertStatus(400)
    assert.equal(partial.body().code, 'validation_error')
    assert.deepEqual(await readState(accountId, true), before)
    assert.lengthOf(await db.from('deleted_groups'), 1)
    const restored = await restore(client, cookie, deleted.body().restoration.replacementGroupId, 2)
    restored.assertStatus(200)
    const after = await readState(accountId, true)
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
    const [kept, ...listed] = await createAllocations(client, cookie, 502)
    const before = await readState(accountId, true)
    const deleted = await deleteGroup(client, cookie, listed, 1)
    deleted.assertStatus(200)
    assert.equal(deleted.body().revision, 2)
    assert.lengthOf(deleted.body().projection.changed.removed, 501)
    assert.notInclude(deleted.text(), note)
    const groupId = deleted.body().restoration.replacementGroupId
    assert.isString(groupId)
    assert.lengthOf(await db.from('deleted_groups'), 1)
    assert.lengthOf(await db.from('deleted_rows').where('group_id', groupId), 501)
    const afterDelete = await readState(accountId, true)
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
    assert.equal(restored.body().revision, 3)
    const afterRestore = await readState(accountId, true)
    assert.sameDeepMembers(afterRestore.allocations, before.allocations)
    assert.lengthOf(await markers(), 3)
    assert.lengthOf(await planningAudit(), 3)
  })

  test('a group beyond the SQLite variable limit deletes exactly its listed rows in one group', async ({
    assert,
  }) => {
    // 32,766 ids plus the account filter exceed SQLite's 32,766 bound variables in one statement.
    const listedCount = 32_766
    const seeded = await readState(accountId, true)
    const now = new Date().toISOString()
    const rows = Array.from({ length: listedCount + 1 }, () =>
      encodeRow('allocations', {
        ...newAllocation(seeded),
        accountId,
        note,
        createdAt: now,
        updatedAt: now,
      })
    )
    for (let start = 0; start < rows.length; start += 500)
      await db.table('allocations').multiInsert(rows.slice(start, start + 500))
    const [kept, ...listed] = rows.map((row) => String(row.id))
    const otherAccounts = () =>
      db.from('allocations').whereNot('account_id', accountId).count('* as n')
    const othersBefore = await otherAccounts()
    assert.isAbove(Number(othersBefore[0].n), 0)
    const data = await readState(accountId, true)
    const groupId = await withTransaction((trx) =>
      deleteAllocations(trx, data, accountId, listed, {
        actorId: 'u-bruce',
        sessionId: 's-batcave',
        mutationId: randomUUID(),
      })
    )
    assert.lengthOf(await db.from('deleted_groups'), 1)
    const saved = await db.from('deleted_rows').where('group_id', groupId).select('row_id')
    assert.lengthOf(saved, listedCount)
    const listedIds = new Set(listed)
    assert.isTrue(saved.every((row) => listedIds.has(String(row.row_id))))
    const remaining = await readState(accountId, true)
    assert.lengthOf(remaining.allocations, data.allocations.length - listedCount)
    assert.isFalse(remaining.allocations.some((row) => listedIds.has(row.id)))
    assert.deepEqual(
      remaining.allocations.find((row) => row.id === kept),
      data.allocations.find((row) => row.id === kept)
    )
    assert.deepEqual(await otherAccounts(), othersBefore)
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
    assert.equal(staleDelete.body().code, 'stale_revision')
    assert.isDefined(await stored(id!))
    assert.lengthOf(await db.from('deleted_groups'), 0)
    const deleted = await deleteOne(client, cookie, other!, 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().restoration.replacementGroupId
    const before = await readState(accountId, true)
    const staleRestore = await restore(client, cookie, groupId, 1)
    staleRestore.assertStatus(409)
    assert.equal(staleRestore.body().code, 'stale_revision')
    assert.deepEqual(await readState(accountId, true), before)
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
    const deleted = await deleteGroup(client, cookie, [first!, second!], 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().restoration.replacementGroupId
    const before = await readState(accountId, true)
    await db.rawQuery(
      `CREATE TEMP TRIGGER restore_constraint_failure BEFORE INSERT ON allocations WHEN NEW.id = '${second}' BEGIN SELECT RAISE(ABORT, 'test constraint failure'); END`
    )
    try {
      const failed = await restore(client, cookie, groupId, 2)
      assert.isAtLeast(failed.status(), 400)
      assert.notEqual(failed.status(), 404)
    } finally {
      await db.rawQuery('DROP TRIGGER restore_constraint_failure')
    }
    assert.deepEqual(await readState(accountId, true), before)
    assert.isNull(await consumedAt(groupId))
    assert.equal(await currentRevision(client, cookie), 2)
    const restored = await restore(client, cookie, groupId, 2)
    restored.assertStatus(200)
    assert.isDefined(await stored(first!))
    assert.isDefined(await stored(second!))
  })

  test('session invalidation removes its groups; a later session is refused the old handle', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const owner = await signIn(client)
    const [id] = await createAllocations(client, owner.cookie, 1)
    const deleted = await deleteOne(client, owner.cookie, id!, 1)
    deleted.assertStatus(200)
    const groupId = deleted.body().restoration.replacementGroupId
    assert.exists(await group(groupId))
    const revoked = await session(
      client.post(`/api/accounts/${accountId}/members/${owner.userId}/revoke-sessions`),
      owner.cookie
    ).send()
    revoked.assertStatus(204)
    assert.notExists(await group(groupId))
    assert.lengthOf(await db.from('deleted_rows').where('group_id', groupId), 0)
    const invalidated = await restore(client, owner.cookie, groupId, 2)
    invalidated.assertStatus(401)
    const later = await signInAgain(client, owner.email)
    const revision = await currentRevision(client, later)
    const before = await readState(accountId, true)
    const refused = await restore(client, later, groupId, revision)
    refused.assertStatus(403)
    assert.equal(refused.body().code, 'authorization_denied')
    assert.deepEqual(await readState(accountId, true), before)
    assert.isUndefined(await stored(id!))
  })

  test('lost-response lookup returns the handle only to its session and late duplicates never re-apply', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const owner = await signIn(client)
    const [id] = await createAllocations(client, owner.cookie, 1)
    const deleteId = randomUUID()
    const deleted = await deleteOne(client, owner.cookie, id!, 1, deleteId)
    deleted.assertStatus(200)
    const groupId = deleted.body().restoration.replacementGroupId
    const lookup = () =>
      session(client.get(`${planningUrl}/mutations/${deleteId}`), owner.cookie).send()
    const committed = { status: 'committed', mutationId: deleteId, revision: 2 }
    for (const attempt of [await lookup(), await lookup()]) {
      attempt.assertStatus(200)
      assert.deepEqual(attempt.body(), { ...committed, restorationGroupId: groupId })
      assert.notInclude(attempt.text(), note)
    }
    const otherSession = await signInAgain(client, owner.email)
    const sameActor = await session(
      client.get(`${planningUrl}/mutations/${deleteId}`),
      otherSession
    ).send()
    assert.deepEqual(sameActor.body(), committed)
    const editor = await signIn(client, 'editor')
    const otherActor = await session(
      client.get(`${planningUrl}/mutations/${deleteId}`),
      editor.cookie
    ).send()
    assert.deepEqual(otherActor.body(), { status: 'unknown', mutationId: deleteId })

    const lateDelete = await deleteOne(client, owner.cookie, id!, 1, deleteId)
    lateDelete.assertStatus(409)
    assert.equal(lateDelete.body().code, 'mutation_id_reused')
    assert.lengthOf(await db.from('deleted_groups'), 1)

    const restoreId = randomUUID()
    const restored = await restore(client, owner.cookie, groupId, 2, restoreId)
    restored.assertStatus(200)
    const consumed = await lookup()
    assert.deepEqual(consumed.body(), committed)
    const lateRestore = await restore(client, owner.cookie, groupId, 2, restoreId)
    lateRestore.assertStatus(409)
    assert.equal(lateRestore.body().code, 'mutation_id_reused')
    assert.lengthOf(await db.from('allocations').where('id', id!), 1)
    assert.equal(await currentRevision(client, owner.cookie), 3)
    assert.lengthOf(await markers(), 3)
    assert.lengthOf(await planningAudit(), 3)
  })

  test('delete and restore routes accept only their named operation and target', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const [id, other] = await createAllocations(client, cookie, 2)
    const before = await readState(accountId, true)
    const mismatched = await send(client, cookie, `${allocationsUrl}/${id}/delete`, 1, {
      operation: 'allocation.delete',
      id: other,
    })
    mismatched.assertStatus(400)
    assert.equal(mismatched.body().code, 'validation_error')
    const wrongOperation = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/planning/restore-group`,
      1,
      { operation: 'allocation.delete', id }
    )
    wrongOperation.assertStatus(400)
    assert.equal(wrongOperation.body().code, 'validation_error')
    assert.deepEqual(await readState(accountId, true), before)
    assert.lengthOf(await markers(), 1)
  })
})

test.group('typed catalogue and time-off restoration', (suite) => {
  suite.setup(() => freshDatabase())
  suite.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('discipline deletion nulls resource links and restores only those links', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const before = await readState(accountId, true)
    const resource = before.resources.find((row) => row.disciplineId !== null)!
    const disciplineId = resource.disciplineId!
    const deleted = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/disciplines/${disciplineId}/delete`,
      0,
      {
        operation: 'catalogue.delete',
        entity: { entity: 'disciplines', id: disciplineId },
      }
    )
    deleted.assertStatus(200)
    const afterDelete = await readState(accountId, true)
    assert.isNull(afterDelete.resources.find((row) => row.id === resource.id)?.disciplineId)
    await db.from('resources').where('id', resource.id).update({ role: 'Updated Gotham role' })
    const restored = await restore(client, cookie, deleted.body().restoration.replacementGroupId, 1)
    restored.assertStatus(200)
    const after = await readState(accountId, true)
    assert.equal(after.resources.find((row) => row.id === resource.id)?.disciplineId, disciplineId)
    assert.equal(after.resources.find((row) => row.id === resource.id)?.role, 'Updated Gotham role')
  })

  test('a reassigned child prevents partial discipline relinking and leaves the group usable', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const before = await readState(accountId, true)
    const discipline = before.disciplines.find(
      (row) => before.resources.filter((resource) => resource.disciplineId === row.id).length >= 2
    )!
    const children = before.resources.filter((row) => row.disciplineId === discipline.id)
    const other = before.disciplines.find((row) => row.id !== discipline.id)!
    const deleted = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/disciplines/${discipline.id}/delete`,
      0,
      { operation: 'catalogue.delete', entity: { entity: 'disciplines', id: discipline.id } }
    )
    deleted.assertStatus(200)
    const groupId = deleted.body().restoration.replacementGroupId
    await db.from('resources').where('id', children[1]!.id).update({ discipline_id: other.id })
    const auditBefore = await planningAudit()
    const mutationsBefore = await markers()
    const refused = await restore(client, cookie, groupId, 1)
    refused.assertStatus(409)
    const after = await readState(accountId, true)
    assert.isUndefined(after.disciplines.find((row) => row.id === discipline.id))
    assert.isNull(after.resources.find((row) => row.id === children[0]!.id)?.disciplineId)
    assert.equal(after.resources.find((row) => row.id === children[1]!.id)?.disciplineId, other.id)
    assert.isNull(await consumedAt(groupId))
    assert.equal(await currentRevision(client, cookie), 1)
    assert.deepEqual(await markers(), mutationsBefore)
    assert.deepEqual(await planningAudit(), auditBefore)
  })

  test('phase deletion nulls activity links and refuses a changed project without consuming the group', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const before = await readState(accountId, true)
    const activity = before.activities.find((row) => row.phaseId !== null)!
    const phaseId = activity.phaseId!
    const deleted = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/phases/${phaseId}/delete`,
      0,
      {
        operation: 'catalogue.delete',
        entity: { entity: 'phases', id: phaseId },
      }
    )
    deleted.assertStatus(200)
    const groupId = deleted.body().restoration.replacementGroupId
    const afterDelete = await readState(accountId, true)
    assert.isNull(afterDelete.activities.find((row) => row.id === activity.id)?.phaseId)
    const otherProject = before.projects.find((row) => row.id !== activity.projectId)!
    await db.from('activities').where('id', activity.id).update({ project_id: otherProject.id })
    const refused = await restore(client, cookie, groupId, 1)
    refused.assertStatus(409)
    assert.isNull(await consumedAt(groupId))
    const afterRefusal = await readState(accountId, true)
    assert.isUndefined(afterRefusal.phases.find((row) => row.id === phaseId))
    await db
      .from('activities')
      .where('id', activity.id)
      .update({ project_id: activity.projectId, name: 'Gotham review' })
    const restored = await restore(client, cookie, groupId, 1)
    restored.assertStatus(200)
    const after = await readState(accountId, true)
    assert.equal(after.activities.find((row) => row.id === activity.id)?.phaseId, phaseId)
    assert.equal(after.activities.find((row) => row.id === activity.id)?.name, 'Gotham review')
  })

  test('a missing phase project returns a restoration conflict without consuming its group', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const before = await readState(accountId, true)
    const clientId = before.clients.find((row) => !row.builtin)!.id
    const projectId = randomUUID()
    const phaseId = randomUUID()
    const project = await send(client, cookie, `/api/accounts/${accountId}/projects`, 0, {
      operation: 'catalogue.create',
      entity: {
        entity: 'projects',
        id: projectId,
        fields: {
          name: 'Gotham restoration project',
          color: before.clients.find((row) => row.id === clientId)!.color,
          clientId,
        },
      },
    })
    project.assertStatus(200)
    const phase = await send(client, cookie, `/api/accounts/${accountId}/phases`, 1, {
      operation: 'catalogue.create',
      entity: { entity: 'phases', id: phaseId, fields: { name: 'Survey', projectId } },
    })
    phase.assertStatus(200)
    const deleted = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/phases/${phaseId}/delete`,
      2,
      { operation: 'catalogue.delete', entity: { entity: 'phases', id: phaseId } }
    )
    deleted.assertStatus(200)
    const groupId = deleted.body().restoration.replacementGroupId
    await db.from('projects').where('id', projectId).delete()
    const auditBefore = await planningAudit()
    const mutationsBefore = await markers()
    const refused = await restore(client, cookie, groupId, 3)
    refused.assertStatus(409)
    const after = await readState(accountId, true)
    assert.isUndefined(after.phases.find((row) => row.id === phaseId))
    assert.isNull(await consumedAt(groupId))
    assert.equal(await currentRevision(client, cookie), 3)
    assert.deepEqual(await markers(), mutationsBefore)
    assert.deepEqual(await planningAudit(), auditBefore)
  })

  test('time-off subset deletion keeps other rows and restores a hidden note without exposing it', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client, 'editor')
    const before = await readState(accountId, true)
    const resourceId = before.resources.find((row) => row.kind === 'person')!.id
    const ids: string[] = [randomUUID(), randomUUID(), randomUUID()]
    for (const id of ids)
      await db.table('time_off').insert(
        encodeRow('time_off', {
          id,
          accountId,
          resourceId,
          startDate: '2026-11-02',
          endDate: '2026-11-02',
          type: 'holiday',
          note: 'Gotham private note',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      )
    const deleted = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/time-off/delete-group`,
      0,
      { operation: 'timeOff.deleteGroup', ids: ids.slice(0, 2) }
    )
    deleted.assertStatus(200)
    assert.notInclude(deleted.text(), 'Gotham private note')
    const afterDelete = await readState(accountId, true)
    assert.deepEqual(
      afterDelete.timeOff.filter((row) => ids.includes(row.id)).map((row) => row.id),
      [ids[2]]
    )
    const restored = await restore(client, cookie, deleted.body().restoration.replacementGroupId, 1)
    restored.assertStatus(200)
    assert.notInclude(restored.text(), 'Gotham private note')
    const afterRestore = await readState(accountId, true)
    assert.sameMembers(
      afterRestore.timeOff.filter((row) => ids.includes(row.id)).map((row) => row.id),
      ids
    )
    assert.equal(afterRestore.timeOff.find((row) => row.id === ids[0])?.note, 'Gotham private note')
  })

  test('closure deletion restores the same stored row and consumes its handle once', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const id = randomUUID()
    const created = await send(client, cookie, `/api/accounts/${accountId}/closures`, 0, {
      operation: 'closure.create',
      id,
      fields: { name: 'Gotham holiday', startDate: '2026-11-02', endDate: '2026-11-02' },
    })
    created.assertStatus(200)
    const afterCreate = await readState(accountId, true)
    const closure = afterCreate.closures.find((row) => row.id === id)!
    const deleted = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/closures/${id}/delete`,
      1,
      {
        operation: 'closure.delete',
        id,
      }
    )
    deleted.assertStatus(200)
    const afterDelete = await readState(accountId, true)
    assert.isUndefined(afterDelete.closures.find((row) => row.id === id))
    const groupId = deleted.body().restoration.replacementGroupId
    const restored = await restore(client, cookie, groupId, 2)
    restored.assertStatus(200)
    const afterRestore = await readState(accountId, true)
    assert.deepEqual(
      afterRestore.closures.find((row) => row.id === id),
      closure
    )
    const again = await restore(client, cookie, groupId, 3)
    again.assertStatus(409)
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
    const groupId = deleted.body().restoration.replacementGroupId
    const before = await readState(accountId, true)
    const target = before.projects.find((row) => !row.isPrivate)!
    const foreignGroup = randomUUID()
    await db.table('deleted_groups').insert({
      group_id: foreignGroup,
      account_id: 'a-loft',
      actor_id: 'other-actor',
      session_id: 'other-session',
      mutation_id: randomUUID(),
      created_at: new Date().toISOString(),
      consumed_at: null,
    })
    const settings = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/settings`,
      2,
      {
        operation: 'settings.update',
        changes: { dateStyle: 'month-day' },
      },
      randomUUID(),
      'patch'
    )
    settings.assertStatus(200)
    assert.isDefined(await group(groupId))
    const ordinary = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/projects/${target.id}`,
      3,
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'projects',
          id: target.id,
          changes: { name: 'Gotham review', codeName: target.codeName },
        },
      },
      randomUUID(),
      'patch'
    )
    ordinary.assertStatus(200)
    assert.isDefined(await group(groupId))
    const changed = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/projects/${target.id}`,
      4,
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'projects',
          id: target.id,
          changes: { isPrivate: true, codeName: 'Gotham confidential' },
        },
      },
      randomUUID(),
      'patch'
    )
    changed.assertStatus(200)
    assert.isNull(await group(groupId))
    assert.isDefined(await group(foreignGroup))
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
    const groupId = deleted.body().restoration.replacementGroupId
    const before = await readState(accountId, true)
    const activity = before.activities.find((row) => row.kind === 'internal')!
    const renamed = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/activities/${activity.id}`,
      2,
      {
        operation: 'catalogue.update',
        entity: {
          entity: 'activities',
          id: activity.id,
          changes: { kind: activity.kind, name: 'Gotham planning' },
        },
      },
      randomUUID(),
      'patch'
    )
    renamed.assertStatus(200)
    assert.isDefined(await group(groupId))
    const changed = await send(
      client,
      cookie,
      `/api/accounts/${accountId}/activities/${activity.id}`,
      3,
      {
        operation: 'catalogue.update',
        entity: { entity: 'activities', id: activity.id, changes: { kind: 'repeatable' } },
      },
      randomUUID(),
      'patch'
    )
    changed.assertStatus(200)
    assert.isNull(await group(groupId))
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
    const groupId = deleted.body().restoration.replacementGroupId
    const before = await readState(accountId, true)
    const target = before.projects.find((row) => !row.isPrivate)!
    await db.rawQuery(
      "CREATE TRIGGER reject_privacy_commit BEFORE INSERT ON planning_mutations BEGIN SELECT RAISE(ABORT, 'test rejection'); END"
    )
    try {
      const refused = await send(
        client,
        cookie,
        `/api/accounts/${accountId}/projects/${target.id}`,
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
        'patch'
      )
      refused.assertStatus(500)
      assert.isDefined(await group(groupId))
      const afterRefusal = await readState(accountId, true)
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
