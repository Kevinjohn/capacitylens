import { test } from '@japa/runner'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { freshDatabase } from '../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { readState, readStateWithClient, resetState } from '#services/state_repository'
import {
  executePlanningIntent as applyPlanningIntent,
  PlanningOperationError,
} from '#services/planning_operations/execute'
import type { PlanningIntent } from '#validators/planning_operations'
import type { BatchCapabilities } from '#services/batch/data_policy'

const owner: BatchCapabilities = {
  role: 'owner',
  canWrite: true,
  canPurge: true,
  canSeePrivateNames: true,
  canSeeTimeOffNote: true,
}

async function executePlanningIntent(
  trx: TransactionClientContract,
  accountId: string,
  intent: PlanningIntent,
  capabilities: BatchCapabilities
) {
  const data = await readStateWithClient(trx, accountId, true)
  return applyPlanningIntent(trx, accountId, intent, capabilities, data)
}

test.group('typed planning writers', (group) => {
  group.setup(() => freshDatabase())

  test('creates and patches a closure while preserving its other fields', async ({ assert }) => {
    await resetState('single')
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
    assert.equal(row?.accountId, 'a-studio')
  })

  test('rejects an invalid reference without persisting the row', async ({ assert }) => {
    await resetState('single')
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
      PlanningOperationError
    )
    const state = await readState('a-studio', true)
    assert.isUndefined(state.timeOff.find((row) => row.id === id))
  })

  test('rolls back every repeat entry when a later one fails', async ({ assert }) => {
    await resetState('single')
    const initialState = await readState('a-studio', true)
    const resourceId = initialState.resources[0]!.id
    const firstId = randomUUID()
    const secondId = randomUUID()
    const intent: PlanningIntent = {
      operation: 'timeOff.repeat',
      entries: [
        {
          id: firstId,
          resourceId,
          startDate: '2026-10-20',
          endDate: '2026-10-20',
          type: 'holiday',
        },
        {
          id: secondId,
          resourceId: randomUUID(),
          startDate: '2026-10-27',
          endDate: '2026-10-27',
          type: 'holiday',
        },
      ],
    }
    await assert.rejects(() =>
      db.transaction((trx) => executePlanningIntent(trx, 'a-studio', intent, owner))
    )
    const state = await readState('a-studio', true)
    const rows = state.timeOff
    assert.isFalse(rows.some((row) => row.id === firstId || row.id === secondId))
  })

  test('permits Editor settings but reserves capacity access for Admin', async ({ assert }) => {
    await resetState('single')
    const editor: BatchCapabilities = {
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
    const account = state.accounts[0]
    assert.equal(account?.weekStartsOn, 0)
    assert.equal(account?.timezone, 'Europe/London')
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
      PlanningOperationError
    )
  })

  test('keeps an owner-only private name when an Editor changes its colour', async ({ assert }) => {
    await resetState('single')
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
    const editor: BatchCapabilities = { ...owner, role: 'editor', canSeePrivateNames: false }
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
    await resetState('single')
    const before = await readState('a-studio', true)
    const id = randomUUID()
    const editor: BatchCapabilities = { ...owner, role: 'editor', canSeePrivateNames: false }
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

  test('allows a later repeat on a nonworking Sunday and mints a shared series ID', async ({
    assert,
  }) => {
    await resetState('single')
    const before = await readState('a-studio', true)
    const source = before.allocations.find((allocation) => {
      const resource = before.resources.find((row) => row.id === allocation.resourceId)
      return (
        resource?.kind === 'person' &&
        resource.workingDays.includes(1) &&
        resource.firstAvailableDate === null &&
        resource.lastAvailableDate === null
      )
    })!
    const firstId = randomUUID()
    const laterId = randomUUID()
    await assert.rejects(
      () =>
        db.transaction((trx) =>
          executePlanningIntent(
            trx,
            'a-studio',
            {
              operation: 'allocation.repeat',
              sourceAllocationId: source.id,
              occurrences: [{ id: randomUUID(), startDate: '2026-10-25', endDate: '2026-10-25' }],
            },
            owner
          )
        ),
      PlanningOperationError
    )
    await db.transaction((trx) =>
      executePlanningIntent(
        trx,
        'a-studio',
        {
          operation: 'allocation.repeat',
          sourceAllocationId: source.id,
          occurrences: [
            { id: firstId, startDate: '2026-10-19', endDate: '2026-10-19' },
            { id: laterId, startDate: '2026-10-25', endDate: '2026-10-25' },
          ],
        },
        owner
      )
    )
    const after = await readState('a-studio', true)
    const first = after.allocations.find((row) => row.id === firstId)
    const later = after.allocations.find((row) => row.id === laterId)
    assert.equal(first?.seriesId, later?.seriesId)
    assert.isString(first?.seriesId)
    assert.equal(later?.note, source.note)
  })
})
