import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { freshDatabase } from '../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { readState, readStateWithClient, resetState } from '#services/state_repository'
import {
  executePlanningIntent,
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

async function execute(intent: PlanningIntent) {
  await db.transaction(async (trx) => {
    const data = await readStateWithClient(trx, 'a-studio', true)
    await executePlanningIntent(trx, 'a-studio', intent, owner, data)
  })
}

async function refused(intent: PlanningIntent) {
  try {
    await execute(intent)
  } catch (error) {
    if (error instanceof PlanningOperationError) return error
    throw error
  }
  throw new Error('Expected the planning intent to be refused.')
}

const makeAllocation = (
  source: Awaited<ReturnType<typeof readState>>['allocations'][number],
  id: string,
  startDate: string
) => ({
  id,
  resourceId: source.resourceId,
  activityId: source.activityId,
  projectId: source.projectId,
  startDate,
  endDate: startDate,
  hoursPerDay: source.hoursPerDay,
  status: source.status,
  note: source.note,
  task: source.task,
  ignoreWeekends: source.ignoreWeekends,
})

test.group('typed allocation group and lifecycle operations', (group) => {
  group.setup(() => freshDatabase())

  test('creates one allocation series and allows only later group entries to start on a nonworking day', async ({
    assert,
  }) => {
    await resetState('single')
    const before = await readState('a-studio', true)
    const source = before.allocations.find((allocation) => {
      const resource = before.resources.find((row) => row.id === allocation.resourceId)
      return (
        resource?.kind === 'person' &&
        resource.workingDays.includes(1) &&
        !resource.workingDays.includes(0)
      )
    })!
    const firstId = randomUUID()
    const secondId = randomUUID()

    await execute({
      operation: 'allocation.createGroup',
      allocations: [
        makeAllocation(source, firstId, '2026-10-19'),
        makeAllocation(source, secondId, '2026-10-25'),
      ],
    })

    const after = await readState('a-studio', true)
    const first = after.allocations.find((row) => row.id === firstId)!
    const second = after.allocations.find((row) => row.id === secondId)!
    assert.isString(first.seriesId)
    assert.equal(first.seriesId, second.seriesId)
    assert.notEqual(first.seriesId, source.seriesId)

    const refusedFirstId = randomUUID()
    const refusedLaterId = randomUUID()
    await assert.rejects(
      () =>
        execute({
          operation: 'allocation.createGroup',
          allocations: [
            makeAllocation(source, refusedFirstId, '2026-10-25'),
            makeAllocation(source, refusedLaterId, '2026-10-26'),
          ],
        }),
      PlanningOperationError
    )
    const unchanged = await readState('a-studio', true)
    assert.isFalse(
      unchanged.allocations.some((row) => row.id === refusedFirstId || row.id === refusedLaterId)
    )
  })

  test('rejects a Sunday allocation on another resource before writing a heterogeneous group', async ({
    assert,
  }) => {
    await resetState('single')
    const before = await readState('a-studio', true)
    const firstSource = before.allocations.find((allocation) => {
      const resource = before.resources.find((row) => row.id === allocation.resourceId)
      return resource?.kind === 'person' && resource.workingDays.includes(1)
    })!
    const secondSource = before.allocations.find((allocation) => {
      const resource = before.resources.find((row) => row.id === allocation.resourceId)
      return (
        allocation.resourceId !== firstSource.resourceId &&
        resource?.kind === 'person' &&
        resource.workingDays.includes(1)
      )
    })!
    const firstId = randomUUID()
    const secondId = randomUUID()

    const error = await refused({
      operation: 'allocation.createGroup',
      allocations: [
        makeAllocation(firstSource, firstId, '2026-10-19'),
        makeAllocation(secondSource, secondId, '2026-10-25'),
      ],
    })

    assert.equal(error.status, 400)
    assert.equal(error.code, 'validation_error')
    const after = await readState('a-studio', true)
    assert.isFalse(after.allocations.some((row) => row.id === firstId || row.id === secondId))
  })

  test('archives and unarchives catalogue and resource rows through shared lifecycle rules', async ({
    assert,
  }) => {
    await resetState('single')
    const before = await readState('a-studio', true)
    const client = before.clients.find((row) => row.builtin !== true)!
    const resource = before.resources.find((row) => row.kind === 'person')!
    const oldClientRevision = client.updatedAt

    await execute({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: client.id },
    })
    let after = await readState('a-studio', true)
    const archivedClient = after.clients.find((row) => row.id === client.id)!
    assert.isString(archivedClient.archivedAt)
    assert.notEqual(archivedClient.updatedAt, oldClientRevision)

    await execute({ operation: 'resource.archive', id: resource.id })
    await execute({
      operation: 'catalogue.unarchive',
      entity: { entity: 'clients', id: client.id },
    })
    await execute({ operation: 'resource.unarchive', id: resource.id })
    after = await readState('a-studio', true)
    assert.isNull(after.clients.find((row) => row.id === client.id)?.archivedAt)
    assert.isNull(after.resources.find((row) => row.id === resource.id)?.archivedAt)
  })

  test('refuses repeated archive, active unarchive, built-in archive, and tombstone unarchive', async ({
    assert,
  }) => {
    await resetState('single')
    const before = await readState('a-studio', true)
    const client = before.clients.find((row) => row.builtin !== true)!
    const internal = before.clients.find((row) => row.builtin === true)!

    const activeUnarchive = await refused({
      operation: 'catalogue.unarchive',
      entity: { entity: 'clients', id: client.id },
    })
    assert.equal(activeUnarchive.status, 400)
    assert.equal(activeUnarchive.code, 'no_change')

    const protectedArchive = await refused({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: internal.id },
    })
    assert.equal(protectedArchive.status, 400)
    assert.equal(protectedArchive.code, 'validation_error')

    await execute({ operation: 'catalogue.archive', entity: { entity: 'clients', id: client.id } })
    const archivedState = await readState('a-studio', true)
    const archived = archivedState.clients.find((row) => row.id === client.id)!
    const repeatedArchive = await refused({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: client.id },
    })
    assert.equal(repeatedArchive.status, 400)
    assert.equal(repeatedArchive.code, 'no_change')
    const afterRepeatedArchiveState = await readState('a-studio', true)
    const afterRepeatedArchive = afterRepeatedArchiveState.clients.find(
      (row) => row.id === client.id
    )!
    assert.equal(afterRepeatedArchive.archivedAt, archived.archivedAt)
    assert.equal(afterRepeatedArchive.updatedAt, archived.updatedAt)

    await db.from('clients').where({ id: client.id, account_id: 'a-studio' }).update({
      deleted_at: '2026-10-20T12:00:00.000Z',
    })
    const tombstoneUnarchive = await refused({
      operation: 'catalogue.unarchive',
      entity: { entity: 'clients', id: client.id },
    })
    assert.equal(tombstoneUnarchive.status, 400)
    assert.equal(tombstoneUnarchive.code, 'validation_error')
    const after = await readState('a-studio', true)
    assert.equal(
      after.clients.find((row) => row.id === client.id)?.deletedAt,
      '2026-10-20T12:00:00.000Z'
    )
  })
})
