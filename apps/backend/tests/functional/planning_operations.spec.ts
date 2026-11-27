import { test } from '@japa/runner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { readState, resetState } from '#tests/helpers/state_fixture'
import type { PlanningIntent } from '#validators/planning/contracts'
import type { PlanningAccessGrant } from '#services/planning/access_grant'
import PlanningOperationException from '#exceptions/planning_operation_exception'
import ValidationRefusalException from '#exceptions/validation_refusal_exception'
import { AllocationFactory } from '#database/factories/allocation_factory'
import type Allocation from '#models/allocation'
import { DateTime } from 'luxon'

import { executePlanningIntent, owner } from '#tests/helpers/data/planning_execution'

test.group('typed planning writers', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(() => resetState('single'))

  test('creates and patches a closure while preserving its other fields', async ({ assert }) => {
    const id = randomUUID()
    await db.transaction((trx) =>
      executePlanningIntent(
        trx,
        'a-studio',
        {
          operation: 'closure.create',
          id,
          fields: { name: '  Founders Day  ', startDate: '2026-10-20', endDate: '2026-10-20' },
        },
        owner
      )
    )
    await db.transaction((trx) =>
      executePlanningIntent(
        trx,
        'a-studio',
        {
          operation: 'closure.update',
          id,
          changes: { endDate: '2026-10-21' },
        },
        owner
      )
    )
    const state = await readState('a-studio', true)
    const row = state.closures.find((item) => item.id === id)
    assert.equal(row?.name, 'Founders Day')
    assert.equal(row?.startDate, '2026-10-20')
    assert.equal(row?.endDate, '2026-10-21')
    assert.equal(row?.companyId, 'a-studio')
  })

  test('rejects an invalid reference without persisting the row', async ({ assert }) => {
    const id = randomUUID()
    await assert.rejects(
      () =>
        db.transaction((trx) =>
          executePlanningIntent(
            trx,
            'a-studio',
            {
              operation: 'timeOff.create',
              timeOff: {
                id,
                resourceId: randomUUID(),
                startDate: '2026-10-20',
                endDate: '2026-10-20',
                type: 'holiday',
              },
            },
            owner
          )
        ),
      ValidationRefusalException
    )
    const state = await readState('a-studio', true)
    assert.isUndefined(state.timeOff.find((row) => row.id === id))
  })

  test('rolls back every repeat entry when a later one fails', async ({ assert }) => {
    const initialState = await readState('a-studio', true)
    const resourceId = initialState.resources[0]!.id
    const firstId = randomUUID()
    // The later occurrence reuses an existing entry's id, so its write fails after the first.
    const takenId = initialState.timeOff[0]!.id
    const intent: PlanningIntent = {
      operation: 'timeOff.repeat',
      timeOff: {
        id: firstId,
        resourceId,
        startDate: '2026-10-20',
        endDate: '2026-10-20',
        type: 'holiday',
      },
      repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-10-27' },
      occurrenceIds: [takenId],
    }
    await assert.rejects(
      () => db.transaction((trx) => executePlanningIntent(trx, 'a-studio', intent, owner)),
      'The record already exists.'
    )
    const state = await readState('a-studio', true)
    assert.isFalse(state.timeOff.some((row) => row.id === firstId))
    assert.deepEqual(state.timeOff, initialState.timeOff)
  })

  test('permits Editor settings but reserves capacity access for Admin', async ({ assert }) => {
    const editor: PlanningAccessGrant = {
      ...owner,
      role: 'editor',
      canSeePrivateNames: false,
      canSeeTimeOffNote: false,
    }
    await db.transaction((trx) =>
      executePlanningIntent(
        trx,
        'a-studio',
        {
          operation: 'settings.update',
          changes: { weekStartsOn: 0, timezone: 'Europe/London' },
        },
        editor
      )
    )
    const state = await readState('a-studio', true)
    const company = state.companies[0]
    assert.equal(company?.weekStartsOn, 0)
    assert.equal(company?.timezone, 'Europe/London')
    await assert.rejects(
      () =>
        db.transaction((trx) =>
          executePlanningIntent(
            trx,
            'a-studio',
            {
              operation: 'settings.update',
              changes: { capacityOverviewAccess: 'everyone' },
            },
            editor
          )
        ),
      PlanningOperationException
    )
  })

  test('keeps an owner-only private name when an Editor changes its colour', async ({ assert }) => {
    const before = await readState('a-studio', true)
    const id = randomUUID()
    await db.transaction((trx) =>
      executePlanningIntent(
        trx,
        'a-studio',
        {
          operation: 'catalogue.create',
          entity: {
            entity: 'clients',
            id,
            fields: {
              name: 'Bruce Wayne',
              color: before.clients[0]!.color,
              isPrivate: true,
              codeName: 'Boardroom',
            },
          },
        },
        owner
      )
    )
    const editor: PlanningAccessGrant = { ...owner, role: 'editor', canSeePrivateNames: false }
    await db.transaction((trx) =>
      executePlanningIntent(
        trx,
        'a-studio',
        {
          operation: 'catalogue.update',
          entity: { entity: 'clients', id, changes: { color: before.clients[1]!.color } },
        },
        editor
      )
    )
    const after = await readState('a-studio', true)
    const row = after.clients.find((client) => client.id === id)
    assert.equal(row?.name, 'Bruce Wayne')
    assert.equal(row?.codeName, 'Boardroom')
    assert.equal(row?.isPrivate, true)
  })

  test('lets an Editor create a public catalogue row without privacy controls', async ({
    assert,
  }) => {
    const before = await readState('a-studio', true)
    const id = randomUUID()
    const editor: PlanningAccessGrant = { ...owner, role: 'editor', canSeePrivateNames: false }
    await db.transaction((trx) =>
      executePlanningIntent(
        trx,
        'a-studio',
        {
          operation: 'catalogue.create',
          entity: {
            entity: 'clients',
            id,
            fields: { name: 'Wayne Foundation', color: before.clients[0]!.color },
          },
        },
        editor
      )
    )
    const after = await readState('a-studio', true)
    const created = after.clients.find((row) => row.id === id)
    assert.equal(created?.name, 'Wayne Foundation')
    assert.isNotTrue(created?.isPrivate)
  })

  test('an activity kind change clears attribution only on the live allocations it names', async ({
    assert,
  }) => {
    const activityId = randomUUID()
    await db.transaction((trx) =>
      executePlanningIntent(
        trx,
        'a-studio',
        {
          operation: 'catalogue.create',
          entity: {
            entity: 'activities',
            id: activityId,
            fields: { name: 'Gotham patrol', kind: 'allProjects', projectId: null, phaseId: null },
          },
        },
        owner
      )
    )
    const template = await db.from('allocations').where('company_id', 'a-studio').firstOrFail()
    const project = await db.from('projects').where('company_id', 'a-studio').firstOrFail()
    const stamp = DateTime.fromISO(template.updated_at)
    const copy = (overrides: Partial<Pick<Allocation, 'projectId' | 'deletedAt'>>) =>
      AllocationFactory.merge({
        companyId: 'a-studio',
        resourceId: template.resource_id,
        activityId,
        projectId: project.id,
        createdAt: stamp,
        updatedAt: stamp,
        ...overrides,
      }).create()
    // Two attributed rows, one already unattributed and one soft-deleted attributed row.
    const live = [await copy({}), await copy({})]
    await copy({ projectId: null })
    await copy({ deletedAt: DateTime.fromISO('2026-01-02T03:04:05.006Z') })
    const before = await db.from('allocations').orderBy('id')

    const execution = await db.transaction((trx) =>
      executePlanningIntent(
        trx,
        'a-studio',
        {
          operation: 'catalogue.update',
          entity: { entity: 'activities', id: activityId, changes: { kind: 'internal' } },
        },
        owner
      )
    )

    const liveIds = new Set(live.map((row) => row.id))
    const revisions = new Map(
      execution.written
        .filter((entry) => entry.entity === 'allocations')
        .map((entry) => [entry.id, entry.after?.updatedAt])
    )
    assert.deepEqual([...revisions.keys()].sort(), [...liveIds].sort())
    const expected = before.map((row) =>
      liveIds.has(row.id) ? { ...row, project_id: null, updated_at: revisions.get(row.id) } : row
    )
    assert.deepEqual(await db.from('allocations').orderBy('id'), expected)
    for (const id of liveIds) {
      assert.isAbove(
        Date.parse(String(revisions.get(id))),
        Date.parse(String(before.find((row) => row.id === id)?.updated_at))
      )
    }
  })
})
