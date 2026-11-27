import { test } from '@japa/runner'
import { randomUUID } from 'node:crypto'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { readState, resetState } from '#tests/helpers/state_fixture'
import ValidationRefusalException from '#exceptions/validation_refusal_exception'
import {
  executeInStudio,
  makeAllocation,
  refusedInStudio,
} from '#tests/helpers/unit/planning_operations'

test.group('typed allocation group and lifecycle operations', (group) => {
  group.setup(() => freshDatabase())

  test('creates one allocation series and allows only later occurrences to start on a nonworking day', async ({
    assert,
  }) => {
    await resetState('single')
    const before = await readState('a-studio', true)
    const source = before.allocations.find((allocation) => {
      const resource = before.resources.find((row) => row.id === allocation.resourceId)
      return (
        resource?.kind === 'person' &&
        resource.workingDays.includes(4) &&
        !resource.workingDays.includes(0)
      )
    })!
    const firstId = randomUUID()

    // Thursday 1 October repeats on the first of each month; 1 November is a Sunday.
    await executeInStudio({
      operation: 'allocation.createGroup',
      allocation: makeAllocation(source, firstId, '2026-10-01'),
      repeat: { pattern: { kind: 'monthly-date' }, until: '2026-11-01' },
    })

    const after = await readState('a-studio', true)
    const first = after.allocations.find((row) => row.id === firstId)!
    // The server minted the later occurrence's id.
    const second = after.allocations.find(
      (row) => row.seriesId === first.seriesId && row.id !== firstId
    )!
    assert.isString(first.seriesId)
    assert.equal(first.seriesId, second.seriesId)
    assert.notEqual(first.seriesId, source.seriesId)
    assert.equal(second.startDate, '2026-11-01')

    const refusedFirstId = randomUUID()
    await assert.rejects(
      () =>
        executeInStudio({
          operation: 'allocation.createGroup',
          allocation: makeAllocation(source, refusedFirstId, '2026-10-25'),
          repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-11-01' },
        }),
      ValidationRefusalException
    )
    const unchanged = await readState('a-studio', true)
    assert.isFalse(unchanged.allocations.some((row) => row.id === refusedFirstId))
    assert.lengthOf(unchanged.allocations, after.allocations.length)
  })

  test('archives and restores catalogue and resource rows through shared lifecycle rules', async ({
    assert,
  }) => {
    await resetState('single')
    const before = await readState('a-studio', true)
    const client = before.clients.find((row) => row.builtin !== true)!
    const resource = before.resources.find((row) => row.kind === 'person')!
    const oldClientRevision = client.updatedAt

    await executeInStudio({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: client.id },
    })
    let after = await readState('a-studio', true)
    const archivedClient = after.clients.find((row) => row.id === client.id)!
    assert.isString(archivedClient.archivedAt)
    assert.notEqual(archivedClient.updatedAt, oldClientRevision)

    await executeInStudio({ operation: 'resource.archive', id: resource.id })
    await executeInStudio({
      operation: 'catalogue.restore',
      entity: { entity: 'clients', id: client.id },
    })
    await executeInStudio({ operation: 'resource.restore', id: resource.id })
    after = await readState('a-studio', true)
    assert.isNull(after.clients.find((row) => row.id === client.id)?.archivedAt)
    assert.isNull(after.resources.find((row) => row.id === resource.id)?.archivedAt)
  })

  test('refuses repeated archive, active restore and built-in archive', async ({ assert }) => {
    await resetState('single')
    const before = await readState('a-studio', true)
    const client = before.clients.find((row) => row.builtin !== true)!
    const internal = before.clients.find((row) => row.builtin === true)!

    const activeRestore = await refusedInStudio({
      operation: 'catalogue.restore',
      entity: { entity: 'clients', id: client.id },
    })
    assert.equal(activeRestore.status, 400)
    assert.equal(activeRestore.code, 'E_NO_CHANGE')

    const protectedArchive = await refusedInStudio({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: internal.id },
    })
    assert.equal(protectedArchive.status, 409)
    assert.isUndefined(protectedArchive.code)

    await executeInStudio({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: client.id },
    })
    const archivedState = await readState('a-studio', true)
    const archived = archivedState.clients.find((row) => row.id === client.id)!
    const repeatedArchive = await refusedInStudio({
      operation: 'catalogue.archive',
      entity: { entity: 'clients', id: client.id },
    })
    assert.equal(repeatedArchive.status, 400)
    assert.equal(repeatedArchive.code, 'E_NO_CHANGE')
    const afterRepeatedArchiveState = await readState('a-studio', true)
    const afterRepeatedArchive = afterRepeatedArchiveState.clients.find(
      (row) => row.id === client.id
    )!
    assert.equal(afterRepeatedArchive.archivedAt, archived.archivedAt)
    assert.equal(afterRepeatedArchive.updatedAt, archived.updatedAt)
  })
})
