import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { readState } from '#services/state_repository'
import {
  accountId,
  configureAuth,
  newAllocation,
  planningUrl,
  resetPlanningFixture,
  session,
  signIn,
} from './helpers.js'

const body = (response: { body(): unknown }) =>
  response.body() as {
    code: string
    revision: number
    projection: { mode: string; history: string }
  }
const route = (path: string) => `/api/accounts/${accountId}/${path}`
const input = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
})

test.group('authenticated planning operations', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('Viewer writes, route mismatches and foreign references are refused', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie: viewerCookie } = await signIn(client, 'viewer')
    const allocation = newAllocation(data)
    const viewer = await session(client.post(route('allocations')), viewerCookie)
      .json(input(0, { operation: 'allocation.create', allocation }))
      .send()
    viewer.assertStatus(403)
    assert.equal(body(viewer).code, 'authorization_denied')

    const { cookie } = await signIn(client)
    const mismatch = await session(
      client.patch(route(`allocations/${data.allocations[0]!.id}`)),
      cookie
    )
      .json(
        input(0, {
          operation: 'allocation.update',
          id: data.allocations[1]!.id,
          changes: { hoursPerDay: 4 },
        })
      )
      .send()
    mismatch.assertStatus(400)
    assert.equal(body(mismatch).code, 'validation_error')

    const allAccounts = await readState()
    const foreignResource = allAccounts.resources.find((row) => row.accountId === 'a-loft')!
    const foreign = await session(client.post(route('allocations')), cookie)
      .json(
        input(0, {
          operation: 'allocation.create',
          allocation: {
            ...allocation,
            resourceId: foreignResource.id,
          },
        })
      )
      .send()
    foreign.assertStatus(400)
    assert.equal(body(foreign).code, 'validation_error')
    const current = await session(client.get(planningUrl), cookie).send()
    assert.equal(body(current).revision, 0)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0)
  })

  test('Editor creates public catalogue rows and updates their dependent family', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie } = await signIn(client, 'editor')
    const color = data.clients.find((row) => row.accountId === accountId && !row.builtin)!.color
    const clientId = randomUUID()
    const projectId = randomUUID()
    const phaseId = randomUUID()
    const activityId = randomUUID()
    const disciplineId = randomUUID()
    const operations = [
      {
        path: 'clients',
        entity: 'clients',
        id: clientId,
        fields: { name: 'Wayne Foundation', color },
      },
      {
        path: 'projects',
        entity: 'projects',
        id: projectId,
        fields: { name: 'Gotham Renewal', color, clientId },
      },
      { path: 'phases', entity: 'phases', id: phaseId, fields: { name: 'Discovery', projectId } },
      {
        path: 'activities',
        entity: 'activities',
        id: activityId,
        fields: { name: 'Research', kind: 'project', projectId, phaseId },
      },
      {
        path: 'disciplines',
        entity: 'disciplines',
        id: disciplineId,
        fields: { name: 'Strategy', color, sortOrder: 8 },
      },
    ]
    for (const [index, operation] of operations.entries()) {
      const response = await session(client.post(route(operation.path)), cookie)
        .json(
          input(index, {
            operation: 'catalogue.create',
            entity: {
              entity: operation.entity,
              id: operation.id,
              fields: operation.fields,
            },
          })
        )
        .send()
      response.assertStatus(200)
      assert.equal(body(response).revision, index + 1)
    }
    const updated = await session(client.patch(route(`phases/${phaseId}`)), cookie)
      .json(
        input(5, {
          operation: 'catalogue.update',
          entity: {
            entity: 'phases',
            id: phaseId,
            changes: { name: 'Planning' },
          },
        })
      )
      .send()
    updated.assertStatus(200)
    assert.equal(body(updated).revision, 6)
    const state = await readState(accountId, true)
    assert.equal(state.clients.find((row) => row.id === clientId)?.isPrivate, null)
    assert.equal(state.projects.find((row) => row.id === projectId)?.clientId, clientId)
    assert.equal(state.activities.find((row) => row.id === activityId)?.phaseId, phaseId)
    assert.equal(state.phases.find((row) => row.id === phaseId)?.name, 'Planning')
    assert.equal(state.disciplines.find((row) => row.id === disciplineId)?.sortOrder, 8)
  })

  test('Editor creates a resource and patches its role without changing its capacity', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const original = data.resources.find(
      (row) => row.accountId === accountId && row.kind === 'person'
    )!
    const { cookie } = await signIn(client, 'editor')
    const id = randomUUID()
    const fields = {
      kind: 'person',
      name: 'Dick Grayson',
      role: 'Designer',
      avatarUrl: null,
      disciplineId: original.disciplineId,
      employmentType: original.employmentType,
      engagement: original.engagement,
      workingHoursPerDay: original.workingHoursPerDay,
      workingDays: original.workingDays,
      halfDays: original.halfDays,
      projectId: null,
      color: original.color,
      isFavourite: null,
      firstAvailableDate: null,
      lastAvailableDate: null,
    }
    const created = await session(client.post(route('resources')), cookie)
      .json(input(0, { operation: 'resource.create', id, fields }))
      .send()
    created.assertStatus(200)
    const updated = await session(client.patch(route(`resources/${id}`)), cookie)
      .json(input(1, { operation: 'resource.update', id, changes: { role: 'Lead Designer' } }))
      .send()
    updated.assertStatus(200)
    const state = await readState(accountId, true)
    const resource = state.resources.find((row) => row.id === id)
    assert.equal(resource?.role, 'Lead Designer')
    assert.equal(resource?.workingHoursPerDay, original.workingHoursPerDay)
    assert.deepEqual(resource?.workingDays, original.workingDays)
  })

  test('Editor preserves confidential values and cannot change privacy controls or notes', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie: ownerCookie } = await signIn(client)
    const clientId = randomUUID()
    const color = data.clients.find((row) => row.accountId === accountId && !row.builtin)!.color
    const privateClient = await session(client.post(route('clients')), ownerCookie)
      .json(
        input(0, {
          operation: 'catalogue.create',
          entity: {
            entity: 'clients',
            id: clientId,
            fields: { name: 'Bruce Wayne', color, isPrivate: true, codeName: 'Boardroom' },
          },
        })
      )
      .send()
    privateClient.assertStatus(200)
    const timeOffId = randomUUID()
    const resourceId = data.resources.find(
      (row) => row.accountId === accountId && row.kind === 'person'
    )!.id
    const timeOff = await session(client.post(route('time-off')), ownerCookie)
      .json(
        input(1, {
          operation: 'timeOff.create',
          timeOff: {
            id: timeOffId,
            resourceId,
            startDate: '2026-11-02',
            endDate: '2026-11-02',
            type: 'holiday',
            note: 'Private note',
          },
        })
      )
      .send()
    timeOff.assertStatus(200)

    const { cookie } = await signIn(client, 'editor')
    const nameEdit = await session(client.patch(route(`clients/${clientId}`)), cookie)
      .json(
        input(2, {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id: clientId, changes: { name: 'Redacted echo', color } },
        })
      )
      .send()
    nameEdit.assertStatus(400)
    assert.equal(body(nameEdit).code, 'no_change')
    const colourEdit = await session(client.patch(route(`clients/${clientId}`)), cookie)
      .json(
        input(2, {
          operation: 'catalogue.update',
          entity: {
            entity: 'clients',
            id: clientId,
            changes: {
              color: data.clients.find((row) => row.accountId === accountId && row.color !== color)!
                .color,
            },
          },
        })
      )
      .send()
    colourEdit.assertStatus(200)
    const notePreserved = await session(client.patch(route(`time-off/${timeOffId}`)), cookie)
      .json(input(3, { operation: 'timeOff.update', id: timeOffId, changes: { type: 'sick' } }))
      .send()
    notePreserved.assertStatus(200)
    const privacyRefused = await session(client.patch(route(`clients/${clientId}`)), cookie)
      .json(
        input(4, {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id: clientId, changes: { isPrivate: false } },
        })
      )
      .send()
    privacyRefused.assertStatus(403)
    const noteRefused = await session(client.patch(route(`time-off/${timeOffId}`)), cookie)
      .json(input(4, { operation: 'timeOff.update', id: timeOffId, changes: { note: 'Read it' } }))
      .send()
    noteRefused.assertStatus(403)
    const state = await readState(accountId, true)
    assert.equal(state.clients.find((row) => row.id === clientId)?.name, 'Bruce Wayne')
    assert.equal(state.clients.find((row) => row.id === clientId)?.codeName, 'Boardroom')
    assert.equal(state.timeOff.find((row) => row.id === timeOffId)?.note, 'Private note')
  })

  test('time-off repeat rolls back a later invalid entry; closure and settings commit with correct projection', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const data = await readState(accountId, true)
    const { cookie } = await signIn(client, 'editor')
    const resourceId = data.resources.find(
      (row) => row.accountId === accountId && row.kind === 'person'
    )!.id
    const firstId = randomUUID()
    const badId = randomUUID()
    const repeat = await session(client.post(route('time-off/repeat')), cookie)
      .json(
        input(0, {
          operation: 'timeOff.repeat',
          entries: [
            {
              id: firstId,
              resourceId,
              startDate: '2026-11-02',
              endDate: '2026-11-02',
              type: 'holiday',
            },
            {
              id: badId,
              resourceId: randomUUID(),
              startDate: '2026-11-09',
              endDate: '2026-11-09',
              type: 'holiday',
            },
          ],
        })
      )
      .send()
    repeat.assertStatus(400)
    const afterRepeat = await readState(accountId, true)
    assert.isFalse(afterRepeat.timeOff.some((row) => row.id === firstId))

    const closureId = randomUUID()
    const closure = await session(client.post(route('closures')), cookie)
      .json(
        input(0, {
          operation: 'closure.create',
          id: closureId,
          fields: { name: 'Gotham Founders Day', startDate: '2026-11-03', endDate: '2026-11-03' },
        })
      )
      .send()
    closure.assertStatus(200)
    assert.equal(body(closure).revision, 1)
    const setting = await session(client.patch(route('settings')), cookie)
      .json(
        input(1, {
          operation: 'settings.update',
          changes: { timezone: 'Europe/London', weekStartsOn: 0 },
        })
      )
      .send()
    setting.assertStatus(200)
    assert.equal(body(setting).revision, 2)
    const projection = body(setting).projection as {
      mode: string
      history: string
      changed: {
        upserts: Array<{ entity: string; row: { id: string; weekStartsOn: number | null } }>
        removed: unknown[]
      }
    }
    assert.equal(projection.mode, 'patch')
    assert.equal(projection.history, 'retain')
    assert.deepEqual(
      projection.changed.upserts.map(({ entity, row }) => ({
        entity,
        id: row.id,
        weekStartsOn: row.weekStartsOn,
      })),
      [{ entity: 'accounts', id: accountId, weekStartsOn: 0 }]
    )
    assert.isEmpty(projection.changed.removed)
    const state = await readState(accountId, true)
    assert.equal(state.accounts[0]?.weekStartsOn, 0)
    assert.equal(state.closures.find((row) => row.id === closureId)?.name, 'Gotham Founders Day')
  })

  test('allocation repeat copies source fields, accepts a later Sunday and commits once', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const allocation = {
      ...newAllocation(await readState(accountId, true)),
      note: 'Planning notes',
      task: 'Discovery',
    }
    const created = await session(client.post(route('allocations')), cookie)
      .json(input(0, { operation: 'allocation.create', allocation }))
      .send()
    created.assertStatus(200)
    const firstId = randomUUID()
    const laterId = randomUUID()
    const repeated = await session(
      client.post(route(`allocations/${allocation.id}/repeat`)),
      cookie
    )
      .json(
        input(1, {
          operation: 'allocation.repeat',
          sourceAllocationId: allocation.id,
          occurrences: [
            { id: firstId, startDate: '2026-11-09', endDate: '2026-11-09' },
            { id: laterId, startDate: '2026-11-15', endDate: '2026-11-15' },
          ],
        })
      )
      .send()
    repeated.assertStatus(200)
    assert.equal(body(repeated).revision, 2)
    assert.equal(body(repeated).projection.mode, 'patch')
    const state = await readState(accountId, true)
    const first = state.allocations.find((row) => row.id === firstId)
    const later = state.allocations.find((row) => row.id === laterId)
    assert.equal(first?.note, allocation.note)
    assert.equal(later?.task, allocation.task)
    assert.isString(first?.seriesId)
    assert.equal(first?.seriesId, later?.seriesId)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 2)
  })
  test('refuses phase reassignment that would invalidate its activities without committing effects', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const before = await readState(accountId, true)
    const phase = before.phases.find((row) => row.id === 'ph-disc')!
    const target = before.projects.find((row) => row.id === 'p-brand')!
    const refused = await session(client.patch(route(`phases/${phase.id}`)), cookie)
      .json(
        input(0, {
          operation: 'catalogue.update',
          entity: { entity: 'phases', id: phase.id, changes: { projectId: target.id } },
        })
      )
      .send()
    refused.assertStatus(400)
    assert.equal(body(refused).code, 'validation_error')
    const retained = await session(client.post('/api/batch'), cookie)
      .json({
        ops: [
          { method: 'PUT', table: 'phases', id: phase.id, row: { ...phase, projectId: target.id } },
        ],
      })
      .send()
    retained.assertStatus(404)
    assert.deepEqual(await readState(accountId, true), before)
    assert.lengthOf(await db.from('planning_mutations').where('account_id', accountId), 0)
    assert.lengthOf(await db.from('audit_entries').where('account_id', accountId), 0)
    const current = await session(client.get(planningUrl), cookie).send()
    assert.equal(body(current).revision, 0)
  })

  test('allows moving a phase without dependent activities', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const id = randomUUID()
    const created = await session(client.post(route('phases')), cookie)
      .json(
        input(0, {
          operation: 'catalogue.create',
          entity: {
            entity: 'phases',
            id,
            fields: { name: 'Planning', projectId: 'p-acme' },
          },
        })
      )
      .send()
    created.assertStatus(200)
    const moved = await session(client.patch(route(`phases/${id}`)), cookie)
      .json(
        input(1, {
          operation: 'catalogue.update',
          entity: {
            entity: 'phases',
            id,
            changes: { projectId: 'p-brand' },
          },
        })
      )
      .send()
    moved.assertStatus(200)
    assert.equal(body(moved).revision, 2)
    const afterMove = await readState(accountId, true)
    assert.equal(afterMove.phases.find((row) => row.id === id)?.projectId, 'p-brand')
  })
  test('activity kind edits clear history after dependent attribution is removed', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await signIn(client)
    const data = await readState(accountId, true)
    const activityId = randomUUID()
    const created = await session(client.post(route('activities')), cookie)
      .json(
        input(0, {
          operation: 'catalogue.create',
          entity: {
            entity: 'activities',
            id: activityId,
            fields: {
              name: 'All projects planning',
              kind: 'repeatable',
              projectId: null,
              phaseId: null,
            },
          },
        })
      )
      .send()
    created.assertStatus(200)
    const allocation = { ...newAllocation(data), activityId, projectId: 'p-acme' }
    const allocated = await session(client.post(route('allocations')), cookie)
      .json(input(1, { operation: 'allocation.create', allocation }))
      .send()
    allocated.assertStatus(200)
    const changed = await session(client.patch(route(`activities/${activityId}`)), cookie)
      .json(
        input(2, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activityId,
            changes: { kind: 'internal' },
          },
        })
      )
      .send()
    changed.assertStatus(200)
    assert.equal(body(changed).revision, 3)
    assert.deepEqual(body(changed).projection, { mode: 'refetch', history: 'clear' })
    const afterKindChange = await readState(accountId, true)
    assert.isNull(afterKindChange.allocations.find((row) => row.id === allocation.id)?.projectId)

    const auditBeforeNoop = await db.from('audit_entries').where('account_id', accountId)
    const markersBeforeNoop = await db.from('planning_mutations').where('account_id', accountId)
    const sameKindOnly = await session(client.patch(route(`activities/${activityId}`)), cookie)
      .json(
        input(3, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activityId,
            changes: { kind: 'internal' },
          },
        })
      )
      .send()
    sameKindOnly.assertStatus(400)
    assert.equal(body(sameKindOnly).code, 'no_change')
    assert.deepEqual(await readState(accountId, true), afterKindChange)
    assert.deepEqual(await db.from('audit_entries').where('account_id', accountId), auditBeforeNoop)
    assert.deepEqual(
      await db.from('planning_mutations').where('account_id', accountId),
      markersBeforeNoop
    )
    const afterNoop = await session(client.get(planningUrl), cookie).send()
    afterNoop.assertStatus(200)
    assert.equal(body(afterNoop).revision, 3)

    const sameKind = await session(client.patch(route(`activities/${activityId}`)), cookie)
      .json(
        input(3, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activityId,
            changes: { kind: 'internal', name: 'Internal planning' },
          },
        })
      )
      .send()
    sameKind.assertStatus(200)
    assert.deepEqual(body(sameKind).projection, { mode: 'refetch', history: 'clear' })
    const renamed = await session(client.patch(route(`activities/${activityId}`)), cookie)
      .json(
        input(4, {
          operation: 'catalogue.update',
          entity: {
            entity: 'activities',
            id: activityId,
            changes: { name: 'Internal coordination' },
          },
        })
      )
      .send()
    renamed.assertStatus(200)
    assert.equal(body(renamed).projection.mode, 'patch')
    assert.equal(body(renamed).projection.history, 'retain')
  })
})
