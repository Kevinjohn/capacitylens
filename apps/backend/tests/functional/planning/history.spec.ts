import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { HISTORY_LIMIT } from '#services/planning/planning_history_service'
import { readState } from '#tests/helpers/state_fixture'
import { freshDatabase } from '#tests/helpers/fresh_database'
import {
  companyId,
  configureAuth,
  loginAsMember,
  newAllocation,
  resetPlanningFixture,
  signIn,
  signInAgain,
} from '#tests/helpers/planning/functional_helpers'
import {
  listCreatedAllocationIds,
  planningAudit,
  stored,
} from '#tests/helpers/planning/restoration_helpers'
import {
  Page,
  histories,
  cookieFor,
  statusOf,
  historyOf,
  noteOf,
  createAllocation,
  setNote,
} from '#tests/helpers/planning/history'

test.group('server-held undo and redo', (suite) => {
  suite.setup(() => freshDatabase())
  suite.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('undo and redo step through a create and an update, one audit row each', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const page = new Page(client, await cookieFor(client))
    const { id, reply: created } = await createAllocation(page)
    assert.deepEqual(created.history, { canUndo: true, canRedo: false })
    // Keep both HTTP writes behind the row clock to exercise the monotonic timestamp rule.
    const seededAt = '2098-01-01T00:00:00.000Z'
    await db.from('allocations').where('id', id).update({ updated_at: seededAt })
    assert.equal(await statusOf(setNote(page, id, 'Watchtower audit')), 200)
    const editedAt = (await stored(id))!.updatedAt
    assert.isAbove(Date.parse(editedAt), Date.parse(seededAt))

    const undoneUpdate = await page.undo()
    assert.equal(undoneUpdate.status, 200)
    assert.deepEqual(undoneUpdate.history, { canUndo: true, canRedo: true })
    const restored = (await stored(id))!
    assert.equal(restored.note, 'Batcave audit')
    assert.isAbove(Date.parse(restored.updatedAt), Date.parse(editedAt))
    const snapshot = await page.read()
    assert.equal(
      snapshot.data.allocations.find((row) => row.id === id)?.updatedAt,
      restored.updatedAt
    )

    const undoneCreate = await page.undo()
    assert.deepEqual(undoneCreate.history, { canUndo: false, canRedo: true })
    assert.isUndefined(await stored(id))
    assert.equal(await statusOf(page.undo()), 409)

    assert.deepEqual(await historyOf(page.redo()), { canUndo: true, canRedo: true })
    assert.isDefined(await stored(id))
    assert.deepEqual(await historyOf(page.redo()), { canUndo: true, canRedo: false })
    assert.equal(await noteOf(id), 'Watchtower audit')
    assert.equal(await statusOf(page.redo()), 409)

    const audit = await planningAudit()
    assert.deepEqual(
      audit.map((row) => row.operation),
      [
        'allocation.create',
        'allocation.update',
        'allocation.update',
        'allocation.delete',
        'planning.restoreGroup',
        'allocation.update',
      ]
    )
  })

  test('a delete is undone, redone and undone again with a fresh handle each time', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const page = new Page(client, await cookieFor(client))
    const { id } = await createAllocation(page)
    const deleted = await page.write({
      operation: 'allocation.delete',
      id,
    })
    assert.equal(deleted.status, 200)
    assert.equal(await statusOf(page.undo()), 200)
    assert.isDefined(await stored(id))
    assert.equal(await statusOf(page.redo()), 200)
    assert.isUndefined(await stored(id))
    assert.equal(await statusOf(page.undo()), 200)
    assert.isDefined(await stored(id))
    assert.equal(await noteOf(id), 'Batcave audit')
  })

  test('a new change after an undo ends redo', async ({ client, assert, cleanup }) => {
    configureAuth(cleanup)
    const page = new Page(client, await cookieFor(client))
    const { id } = await createAllocation(page)
    await setNote(page, id, 'Watchtower audit')
    await page.undo()
    const changed = await setNote(page, id, 'Fortress audit')
    assert.deepEqual(changed.history, { canUndo: true, canRedo: false })
    assert.equal(await statusOf(page.redo()), 409)
  })

  test("someone else's change ends the history", async ({ client, assert, cleanup }) => {
    configureAuth(cleanup)
    const owner = new Page(client, await cookieFor(client))
    const { id } = await createAllocation(owner)
    const editor = new Page(client, await cookieFor(client, 'editor'))
    await editor.read()
    assert.equal(await statusOf(setNote(editor, id, 'Oracle was here')), 200)

    assert.deepEqual(await historyOf(owner.read()), { canUndo: false, canRedo: false })
    const refused = await owner.undo()
    assert.equal(refused.status, 409)
    assert.equal(refused.code, 'E_EMPTY_HISTORY')
    assert.equal(await noteOf(id), 'Oracle was here')
    assert.deepEqual(await historyOf(editor.read()), { canUndo: true, canRedo: false })
  })

  test('a revision that advanced without a planning write ends the history', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const page = new Page(client, await cookieFor(client))
    const { id } = await createAllocation(page)
    // A membership change advances the revision and writes no history of its own.
    await db.from('company_planning_revisions').where('company_id', companyId).increment('revision')

    assert.deepEqual(await historyOf(page.read()), { canUndo: false, canRedo: false })
    assert.equal(await statusOf(page.undo()), 409)
    assert.isDefined(await stored(id))
  })

  test('a refused undo ends the history instead of blocking it', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const page = new Page(client, await cookieFor(client))
    const { id } = await createAllocation(page)
    await setNote(page, id, 'Watchtower audit')
    // The stored inverse edits a row that no longer exists, so the server refuses it.
    await db.from('allocations').where('id', id).delete()

    const refused = await page.undo()
    assert.isAtLeast(refused.status, 400)
    assert.isBelow(refused.status, 500)
    assert.lengthOf(await histories(), 0)
    assert.deepEqual(await historyOf(page.read()), { canUndo: false, canRedo: false })
  })

  test("a refused step leaves someone else's history alone", async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const owner = new Page(client, await cookieFor(client))
    await createAllocation(owner)
    const viewerSignIn = await loginAsMember('viewer')
    const viewer = new Page(client, viewerSignIn.cookie)
    await viewer.read()

    assert.equal(await statusOf(viewer.undo()), 403)
    assert.lengthOf(await histories(), 1)
    assert.deepEqual(await historyOf(owner.read()), { canUndo: true, canRedo: false })
  })

  test('a person who can no longer write is offered no undo', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const editor = await signIn(client, 'editor')
    const page = new Page(client, editor.cookie)
    await createAllocation(page)
    await db
      .from('memberships')
      .where({ scope_id: companyId, user_id: editor.userId })
      .update({ role: 'viewer' })

    assert.deepEqual(await historyOf(page.read()), { canUndo: false, canRedo: false })
  })

  test('a reload, another sign-in and a stale revision cannot use the history', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const owner = await signIn(client)
    const page = new Page(client, owner.cookie)
    const { id } = await createAllocation(page)

    const reloaded = new Page(client, owner.cookie)
    assert.deepEqual(await historyOf(reloaded.read()), { canUndo: false, canRedo: false })
    assert.equal(await statusOf(reloaded.undo()), 409)

    const otherSignIn = new Page(client, await signInAgain(client, owner.email), page.historyId)
    assert.deepEqual(await historyOf(otherSignIn.read()), { canUndo: false, canRedo: false })
    assert.equal(await statusOf(otherSignIn.undo()), 409)

    page.revision = 0
    const stale = await page.undo()
    assert.equal(stale.status, 409)
    assert.equal(stale.code, 'E_STALE_REVISION')

    assert.deepEqual(await historyOf(page.read()), { canUndo: true, canRedo: false })
    assert.equal(await statusOf(page.undo()), 200)
    assert.isUndefined(await stored(id))
  })

  test('a privacy change and a write that names no history both end the history', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const owner = await signIn(client)
    const page = new Page(client, owner.cookie)
    await createAllocation(page)
    assert.lengthOf(await histories(), 1)
    const state = await readState(companyId, true)
    const target = state.clients.find(
      (row) => row.companyId === companyId && !row.builtin && !row.isPrivate && !row.archivedAt
    )!
    const hidden = await page.write({
      operation: 'catalogue.update',
      entity: {
        entity: 'clients',
        id: target.id,
        changes: { isPrivate: true, codeName: 'Gotham confidential' },
      },
    })
    assert.equal(hidden.status, 200)
    assert.deepEqual(hidden.history, { canUndo: false, canRedo: false })
    assert.lengthOf(await histories(), 0)

    const { id } = await createAllocation(page)
    assert.lengthOf(await histories(), 1)
    const untracked = new Page(client, owner.cookie, null)
    await untracked.read()
    const changed = await setNote(untracked, id, 'No history named')
    assert.deepEqual(changed.history, { canUndo: false, canRedo: false })
    assert.lengthOf(await histories(), 0)
  })

  test('the table keeps one bounded row per company', async ({ client, assert, cleanup }) => {
    configureAuth(cleanup)
    const owner = new Page(client, await cookieFor(client))
    const { id } = await createAllocation(owner)
    for (let index = 0; index < HISTORY_LIMIT + 2; index++) {
      assert.equal(await statusOf(setNote(owner, id, `Patrol ${index}`)), 200)
    }
    const editor = new Page(client, await cookieFor(client, 'editor'))
    await editor.read()
    await setNote(editor, id, 'Oracle was here')

    const rows = await histories()
    assert.lengthOf(rows, 1)
    assert.equal(rows[0].history_id, editor.historyId)
    assert.lengthOf(JSON.parse(rows[0].entries_json).past, 1)

    await owner.read()
    const fresh = new Page(client, await cookieFor(client))
    await fresh.read()
    for (let index = 0; index < HISTORY_LIMIT + 2; index++) {
      await setNote(fresh, id, `Night patrol ${index}`)
    }
    const [row] = await histories()
    assert.lengthOf(JSON.parse(row.entries_json).past, HISTORY_LIMIT)
    assert.lengthOf(await db.from('planning_histories'), 1)
  })

  test('stored inverses never leave the server', async ({ client, assert, cleanup }) => {
    configureAuth(cleanup)
    const page = new Page(client, await cookieFor(client))
    const { id, reply } = await createAllocation(page)
    const updated = await setNote(page, id, 'Watchtower audit')
    const read = await page.read()
    for (const body of [reply, updated, read]) {
      assert.deepEqual(body.history, { canUndo: true, canRedo: false })
    }
    // After the update, the note before it exists only in the stored inverse. The create's own
    // receipt carried it as the row it wrote.
    for (const body of [updated, read]) {
      assert.notInclude(JSON.stringify(body), 'Batcave audit')
    }
    const [row] = await histories()
    assert.include(row.entries_json, 'Batcave audit')
  })

  test('undo and redo of a repeat address the occurrence ids the server minted', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const page = new Page(client, await cookieFor(client))
    const allocation = newAllocation(await readState(companyId, true))
    const reply = await page.write({
      operation: 'allocation.createGroup',
      allocation,
      repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-16' },
    })
    assert.equal(reply.status, 200)
    const ids = listCreatedAllocationIds(reply)
    assert.lengthOf(ids, 3)
    const present = async () => {
      const state = await readState(companyId, true)
      return ids.map((id) => state.allocations.some((row) => row.id === id))
    }

    assert.equal(await statusOf(page.undo()), 200)
    assert.deepEqual(await present(), [false, false, false])
    assert.equal(await statusOf(page.redo()), 200)
    assert.deepEqual(await present(), [true, true, true])
  })

  test('a reassign takes its hours from the target and undoes to the original row', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const page = new Page(client, await cookieFor(client))
    const data = await readState(companyId, true)
    const external = data.resources.find(
      (row) => row.companyId === companyId && row.kind === 'external' && !row.archivedAt
    )!
    const { id, reply } = await createAllocation(page)
    assert.equal(reply.status, 200)
    const original = await stored(id)
    assert.isAbove(original?.hoursPerDay ?? 0, 0)

    // An external carries no load: the server sets zero hours, which the intent cannot name.
    const moved = await page.write({
      operation: 'allocation.reassign',
      id,
      resourceId: external.id,
      startDate: '2026-11-09',
      endDate: '2026-11-10',
    })
    assert.equal(moved.status, 200)
    assert.deepInclude(await stored(id), {
      resourceId: external.id,
      startDate: '2026-11-09',
      endDate: '2026-11-10',
      hoursPerDay: 0,
    })

    // Back on a person in hourly mode, a zero-hour booking takes the person's working day.
    const person = data.resources.find((row) => row.id === original?.resourceId)!
    const back = await page.write({
      operation: 'allocation.reassign',
      id,
      resourceId: person.id,
      startDate: '2026-11-09',
      endDate: '2026-11-10',
    })
    assert.equal(back.status, 200)
    const promoted = await stored(id)
    assert.equal(promoted?.hoursPerDay, person.workingHoursPerDay)

    assert.equal(await statusOf(page.undo()), 200)
    assert.equal(await statusOf(page.undo()), 200)
    assert.deepInclude(await stored(id), {
      resourceId: original?.resourceId,
      startDate: original?.startDate,
      endDate: original?.endDate,
      hoursPerDay: original?.hoursPerDay,
    })
  })
})
