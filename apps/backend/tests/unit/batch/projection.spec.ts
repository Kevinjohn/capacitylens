import { test } from '@japa/runner'
import { seed } from '@capacitylens/shared/data/seed'
import { emptyAppData } from '@capacitylens/shared/types/entities'
import { BatchStateProjection } from '#services/batch/projection'

test.group('BatchStateProjection', () => {
  test('projects cascade and SET NULL foreign-key effects into later lookups', ({ assert }) => {
    const data = seed()
    const repeatableAllocation = {
      ...data.allocations.find((row) => row.id === 'a-alex-design')!,
      projectId: 'p-acme',
    }
    data.allocations.push(repeatableAllocation)
    const projection = new BatchStateProjection(data)

    projection.delete('projects', 'p-acme')

    assert.isUndefined(projection.row('projects', 'p-acme'))
    assert.isUndefined(projection.row('activities', 't-wires'))
    assert.isUndefined(projection.row('allocations', 'a-tyler-1'))
    assert.isUndefined(projection.row('resources', 'r-tyler')?.projectId)
    assert.isUndefined(projection.row('allocations', repeatableAllocation.id)?.projectId)
  })

  test('keeps indexed relationship lookups correct after child updates and removals', ({
    assert,
  }) => {
    const projection = new BatchStateProjection(seed())
    const before = projection.allocationsForResource('a-studio', 'r-tyler')
    assert.equal(before.length, 2)

    const allocation = projection.row('allocations', 'a-tyler-1')!
    projection.upsert('allocations', { ...allocation, resourceId: 'r-nike' })
    assert.equal(projection.allocationsForResource('a-studio', 'r-tyler').length, 1)
    assert.equal(projection.allocationsForResource('a-studio', 'r-nike').length, 2)

    projection.delete('allocations', 'a-tyler-2')
    assert.equal(projection.allocationsForResource('a-studio', 'r-tyler').length, 0)
  })

  test('mirrors the account, client, project, phase, resource, and activity cascades', ({
    assert,
  }) => {
    const accountProjection = new BatchStateProjection(seed())
    accountProjection.delete('accounts', 'a-studio')
    assert.isUndefined(accountProjection.row('clients', 'c-acme'))
    assert.isDefined(accountProjection.row('accounts', 'a-loft'))

    const clientProjection = new BatchStateProjection(seed())
    clientProjection.delete('clients', 'c-acme')
    assert.isUndefined(clientProjection.row('projects', 'p-acme'))
    assert.isUndefined(clientProjection.row('activities', 't-wires'))

    const projectProjection = new BatchStateProjection(seed())
    projectProjection.delete('projects', 'p-acme')
    assert.isUndefined(projectProjection.row('activities', 't-wires'))
    assert.isUndefined(projectProjection.row('allocations', 'a-tyler-1'))
    assert.isUndefined(projectProjection.row('resources', 'r-ph-designer')?.projectId)

    const phaseProjection = new BatchStateProjection(seed())
    phaseProjection.delete('phases', 'ph-disc')
    assert.isUndefined(phaseProjection.row('activities', 't-wires')?.phaseId)
    assert.isDefined(phaseProjection.row('activities', 't-wires'))

    const resourceProjection = new BatchStateProjection(seed())
    resourceProjection.delete('resources', 'r-tyler')
    assert.isUndefined(resourceProjection.row('allocations', 'a-tyler-1'))

    const activityProjection = new BatchStateProjection(seed())
    activityProjection.delete('activities', 't-wires')
    assert.isUndefined(activityProjection.row('allocations', 'a-tyler-1'))
  })

  test('updates and deletes the supported 5,000-row boundary without rebuilding arrays', ({
    assert,
  }) => {
    const data = emptyAppData()
    data.allocations = Array.from({ length: 5_000 }, (_, index) => ({
      id: `allocation-${index}`,
      accountId: 'a-studio',
      resourceId: 'r-tyler',
      activityId: 't-wires',
      startDate: '2026-06-01',
      endDate: '2026-06-02',
      hoursPerDay: 8,
      status: 'confirmed' as const,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    }))
    const projection = new BatchStateProjection(data)
    const rows = projection.data.allocations
    const originalMethods = {
      findIndex: rows.findIndex,
      map: rows.map,
      filter: rows.filter,
    }
    rows.findIndex = () => {
      throw new Error('Projection performed a linear findIndex.')
    }
    rows.map = () => {
      throw new Error('Projection rebuilt the array with map.')
    }
    rows.filter = () => {
      throw new Error('Projection rebuilt the array with filter.')
    }
    try {
      for (let index = 0; index < 5_000; index += 1) {
        projection.upsert('allocations', { ...rows[index], hoursPerDay: 7 })
      }
      for (let index = 0; index < 5_000; index += 1) {
        projection.delete('allocations', `allocation-${index}`)
      }
    } finally {
      rows.findIndex = originalMethods.findIndex
      rows.map = originalMethods.map
      rows.filter = originalMethods.filter
    }
    assert.lengthOf(rows, 0)
  })

  test('reparents projects when replacing the generated Internal client', ({ assert }) => {
    const data = seed()
    const generated = data.clients.find((row) => row.id === 'c-internal-studio')!
    const project = data.projects[0]!
    data.projects = data.projects.map((row) =>
      row.id === project.id ? { ...row, clientId: generated.id } : row
    )
    const projection = new BatchStateProjection(data)
    projection.replaceGeneratedBuiltin(generated.id, {
      ...generated,
      id: 'internal:a-studio-imported',
    })
    assert.isUndefined(projection.row('clients', generated.id))
    assert.equal(projection.row('projects', project.id)?.clientId, 'internal:a-studio-imported')
  })

  test('surfaces a corrupted row index instead of silently ignoring an indexed row', ({
    assert,
  }) => {
    const projection = new BatchStateProjection(seed())
    projection.data.clients.length = 0
    assert.throws(
      () => projection.delete('clients', 'c-acme'),
      'Missing indexed clients row c-acme.'
    )
  })

  test('keeps reverse resource and activity allocation lookups current after edits', ({
    assert,
  }) => {
    const projection = new BatchStateProjection(seed())
    assert.deepEqual(
      projection.allocationsForResource('a-studio', 'r-tyler').map((row) => row.id),
      ['a-tyler-1', 'a-tyler-2']
    )
    projection.upsert('allocations', {
      ...projection.row('allocations', 'a-tyler-1')!,
      resourceId: 'r-alex',
      activityId: 't-design',
    })
    assert.deepEqual(
      projection.allocationsForResource('a-studio', 'r-tyler').map((row) => row.id),
      ['a-tyler-2']
    )
    assert.deepEqual(
      projection.allocationsForActivity('a-studio', 't-design').map((row) => row.id),
      ['a-alex-design', 'a-tyler-1']
    )
  })

  test('mirrors allocation attribution revisions produced by the database sweep', ({ assert }) => {
    const data = seed()
    const allocation = data.allocations.find((row) => row.id === 'a-alex-design')!
    data.allocations = data.allocations.map((row) =>
      row.id === allocation.id ? { ...row, projectId: 'p-acme' } : row
    )
    const projection = new BatchStateProjection(data)
    projection.clearAllocationAttribution([
      {
        id: allocation.id,
        createdAt: allocation.createdAt,
        updatedAt: '2026-06-01T00:00:00.001Z',
      },
    ])
    assert.isUndefined(projection.row('allocations', allocation.id)?.projectId)
    assert.equal(
      projection.row('allocations', allocation.id)?.updatedAt,
      '2026-06-01T00:00:00.001Z'
    )
  })
})
