import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { seed } from '@capacitylens/shared/data/seed'
import type { BatchRevision } from '#services/batch/types'
import { encodeRow } from '#services/state_repository'
import { batch, readStudioState, resetSeed } from './ordering_helpers.js'

type ActivityKind = 'project' | 'internal' | 'repeatable'
const LATEST_TEST_REVISION = '2099-12-31T23:59:59.999Z'

type ModelOperation =
  | { type: 'kind'; kind: ActivityKind }
  | { type: 'allocation-upsert'; attributed: boolean }
  | { type: 'allocation-delete' }

const ALPHABET: readonly ModelOperation[] = [
  { type: 'kind', kind: 'project' },
  { type: 'kind', kind: 'internal' },
  { type: 'kind', kind: 'repeatable' },
  { type: 'allocation-upsert', attributed: true },
  { type: 'allocation-upsert', attributed: false },
  { type: 'allocation-delete' },
]

function enumerateSequences() {
  const sequences: ModelOperation[][] = []
  const append = (prefix: ModelOperation[]) => {
    if (prefix.length > 0) sequences.push(prefix)
    if (prefix.length === 4) return
    for (const operation of ALPHABET) append([...prefix, operation])
  }
  append([])
  return sequences.filter((sequence) => interpret(sequence).accepted)
}

function interpret(sequence: readonly ModelOperation[]) {
  let kind: ActivityKind = 'repeatable'
  let exists = true
  let attributed = true
  let rewrite = false
  for (const operation of sequence) {
    if (operation.type === 'kind') {
      kind = operation.kind
      if (kind !== 'repeatable' && exists && attributed) {
        attributed = false
        rewrite = true
      }
    } else if (operation.type === 'allocation-delete') {
      exists = false
      attributed = false
      rewrite = false
    } else {
      if (operation.attributed && kind !== 'repeatable') return { accepted: false }
      exists = true
      attributed = operation.attributed
      rewrite = false
    }
  }
  return { accepted: true, kind, exists, attributed, rewrite }
}

function requestOperation(
  operation: ModelOperation,
  activity: Record<string, unknown>,
  allocation: Record<string, unknown>
) {
  if (operation.type === 'kind') {
    return {
      method: 'PUT',
      table: 'activities',
      id: activity.id,
      row: {
        ...activity,
        kind: operation.kind,
        ...(operation.kind === 'project' ? { projectId: 'p-acme' } : { projectId: undefined }),
        updatedAt: LATEST_TEST_REVISION,
      },
    }
  }
  if (operation.type === 'allocation-delete') {
    return {
      method: 'DELETE',
      table: 'allocations',
      id: allocation.id,
      accountId: allocation.accountId,
      updatedAt: LATEST_TEST_REVISION,
    }
  }
  return {
    method: 'PUT',
    table: 'allocations',
    id: allocation.id,
    row: {
      ...allocation,
      ...(operation.attributed ? { projectId: 'p-acme' } : { projectId: undefined }),
      updatedAt: LATEST_TEST_REVISION,
    },
  }
}

function attributableFixture() {
  const data = seed()
  const activity = data.activities.find((row) => row.id === 't-design')!
  const allocation = {
    ...data.allocations.find((row) => row.id === 'a-alex-design')!,
    projectId: 'p-acme',
  }
  return { activity, allocation }
}

test.group('M2a batch projection attribution', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('clears project attribution at the activity flip and echoes the rewritten revision', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const { activity, allocation } = attributableFixture()
    const setup = await batch(client, [
      { method: 'PUT', table: 'allocations', id: allocation.id, row: allocation },
    ])
    setup.assertStatus(200)
    const flip = await batch(client, [
      {
        method: 'PUT',
        table: 'activities',
        id: activity.id,
        row: { ...activity, kind: 'internal' },
      },
    ])
    flip.assertStatus(200)
    const state = await readStudioState(client)
    const rewritten = state.allocations.find((row) => row.id === allocation.id)!
    assert.isNull(rewritten.projectId)
    const revisions = (flip.body() as { revisions: BatchRevision[] }).revisions
    assert.deepInclude(revisions, {
      table: 'allocations',
      id: allocation.id,
      createdAt: rewritten.createdAt,
      updatedAt: rewritten.updatedAt,
      rewrite: true,
    })
  })

  test('retains at-flip clearing when the activity flips back before a dependent resource write', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const data = seed()
    const activity = data.activities.find((row) => row.id === 't-design')!
    const allocation = {
      ...data.allocations.find((row) => row.id === 'a-ph-1')!,
      activityId: activity.id,
      projectId: 'p-acme',
    }
    const resource = data.resources.find((row) => row.id === allocation.resourceId)!
    const setup = await batch(client, [
      { method: 'PUT', table: 'allocations', id: allocation.id, row: allocation },
    ])
    setup.assertStatus(200)
    const response = await batch(client, [
      {
        method: 'PUT',
        table: 'activities',
        id: activity.id,
        row: { ...activity, kind: 'internal', updatedAt: LATEST_TEST_REVISION },
      },
      {
        method: 'PUT',
        table: 'activities',
        id: activity.id,
        row: { ...activity, updatedAt: LATEST_TEST_REVISION },
      },
      {
        method: 'PUT',
        table: 'resources',
        id: resource.id,
        row: { ...resource, projectId: 'p-brand' },
      },
    ])
    response.assertStatus(200)
    const state = await readStudioState(client)
    const rewritten = state.allocations.find((row) => row.id === allocation.id)!
    assert.isNull(rewritten.projectId)
    assert.deepInclude((response.body() as { revisions: BatchRevision[] }).revisions, {
      table: 'allocations',
      id: allocation.id,
      createdAt: rewritten.createdAt,
      updatedAt: rewritten.updatedAt,
      rewrite: true,
    })
  })

  test('clears and echoes attribution before a later project archive in the same batch', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const { activity, allocation } = attributableFixture()
    const setup = await batch(client, [
      { method: 'PUT', table: 'allocations', id: allocation.id, row: allocation },
    ])
    setup.assertStatus(200)
    const response = await batch(client, [
      {
        method: 'PUT',
        table: 'activities',
        id: activity.id,
        row: { ...activity, kind: 'internal' },
      },
      { method: 'ARCHIVE', table: 'projects', id: 'p-acme', accountId: activity.accountId },
    ])
    response.assertStatus(200)
    const state = await readStudioState(client)
    const rewritten = state.allocations.find((row) => row.id === allocation.id)!
    assert.isNull(rewritten.projectId)
    assert.deepInclude((response.body() as { revisions: BatchRevision[] }).revisions, {
      table: 'allocations',
      id: allocation.id,
      createdAt: rewritten.createdAt,
      updatedAt: rewritten.updatedAt,
      rewrite: true,
    })
  })

  test('repairs legacy attribution when an already ineligible activity is re-PUT', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const data = seed()
    const activity = data.activities.find((row) => row.id === 't-admin')!
    const allocation = data.allocations.find((row) => row.id === 'a-alex-design')!
    await db
      .from('allocations')
      .where('id', allocation.id)
      .update({ activity_id: activity.id, project_id: 'p-acme' })

    const response = await batch(client, [
      { method: 'PUT', table: 'activities', id: activity.id, row: activity },
    ])
    response.assertStatus(200)
    const state = await readStudioState(client)
    const repaired = state.allocations.find((row) => row.id === allocation.id)!
    assert.isNull(repaired.projectId)
    assert.deepInclude((response.body() as { revisions: BatchRevision[] }).revisions, {
      table: 'allocations',
      id: allocation.id,
      createdAt: repaired.createdAt,
      updatedAt: repaired.updatedAt,
      rewrite: true,
    })
  })

  test('reconciles attribution when an activity edit follows corrupt existing attribution', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const data = seed()
    const activity = data.activities.find((row) => row.id === 't-design')!
    const resource = data.resources.find((row) => row.id === 'r-ph-designer')!
    const allocation = data.allocations.find((row) => row.id === 'a-ph-1')!
    const setup = await batch(client, [
      {
        method: 'PUT',
        table: 'allocations',
        id: allocation.id,
        row: { ...allocation, activityId: activity.id, projectId: 'p-acme' },
      },
    ])
    setup.assertStatus(200)
    await db.from('resources').where('id', resource.id).update({ project_id: 'p-brand' })

    const response = await batch(client, [
      {
        method: 'PUT',
        table: 'activities',
        id: activity.id,
        row: { ...activity, kind: 'project', projectId: 'p-acme' },
      },
    ])
    response.assertStatus(200)
    const state = await readStudioState(client)
    assert.isNull(state.allocations.find((row) => row.id === allocation.id)?.projectId)
  })

  test('keeps projection validation consistent through a kind flip and placeholder rebind', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const data = seed()
    const activity = data.activities.find((row) => row.id === 't-design')!
    const resource = data.resources.find((row) => row.id === 'r-ph-designer')!
    const allocation = data.allocations.find((row) => row.id === 'a-ph-1')!
    const setup = await batch(client, [
      {
        method: 'PUT',
        table: 'allocations',
        id: allocation.id,
        row: { ...allocation, activityId: activity.id, projectId: 'p-acme' },
      },
    ])
    setup.assertStatus(200)

    const response = await batch(client, [
      {
        method: 'PUT',
        table: 'activities',
        id: activity.id,
        row: { ...activity, kind: 'internal' },
      },
      {
        method: 'PUT',
        table: 'resources',
        id: resource.id,
        row: { ...resource, projectId: 'p-brand' },
      },
    ])
    response.assertStatus(200)
    const state = await readStudioState(client)
    assert.equal(state.resources.find((row) => row.id === resource.id)?.projectId, 'p-brand')
    assert.isNull(state.allocations.find((row) => row.id === allocation.id)?.projectId)
  })

  test('a deleted discipline projects SET NULL before a later resource operation', async ({
    client,
    assert,
  }) => {
    await resetSeed(client)
    const before = seed()
    const discipline = before.disciplines.find((row) => row.id === 'd-design')!
    const resource = before.resources.find((row) => row.id === 'r-tyler')!
    const response = await batch(client, [
      {
        method: 'DELETE',
        table: 'disciplines',
        id: discipline.id,
        accountId: discipline.accountId,
        updatedAt: discipline.updatedAt,
      },
      {
        method: 'PUT',
        table: 'resources',
        id: resource.id,
        row: { ...resource, disciplineId: undefined },
      },
    ])
    response.assertStatus(200)
    const state = await readStudioState(client)
    assert.isNull(state.resources.find((row) => row.id === resource.id)?.disciplineId)
    assert.isFalse(state.disciplines.some((row) => row.id === discipline.id))
  })

  test('matches a sequential reference model for every accepted operation sequence through length four', async ({
    client,
    assert,
    test: testCase,
  }) => {
    testCase.timeout(120_000)
    await resetSeed(client)
    const initial = attributableFixture()
    const failures: string[] = []
    const sequences = enumerateSequences()
    for (const sequence of sequences) {
      const expected = interpret(sequence)
      await db
        .from('activities')
        .where('id', initial.activity.id)
        .update(encodeRow('activities', initial.activity as unknown as Record<string, unknown>))
      await db
        .table('allocations')
        .insert(encodeRow('allocations', initial.allocation as unknown as Record<string, unknown>))
        .onConflict('id')
        .merge()
      const response = await batch(
        client,
        sequence.map((operation) =>
          requestOperation(
            operation,
            initial.activity as unknown as Record<string, unknown>,
            initial.allocation as unknown as Record<string, unknown>
          )
        )
      )
      const actualActivity = await db
        .from('activities')
        .where('id', initial.activity.id)
        .select('kind')
        .first()
      const actualAllocation = await db
        .from('allocations')
        .where('id', initial.allocation.id)
        .select('project_id')
        .first()
      const receipt = response.body() as { revisions?: Array<{ rewrite?: boolean }> }
      const rewriteCount =
        receipt.revisions?.filter((revision) => revision.rewrite === true).length ?? 0
      const actualAttributed = typeof actualAllocation?.project_id === 'string'
      const matched =
        response.status() === 200 &&
        actualActivity?.kind === expected.kind &&
        (actualAllocation !== null) === expected.exists &&
        (!expected.exists || actualAttributed === expected.attributed) &&
        rewriteCount === (expected.rewrite ? 1 : 0)
      if (!matched && failures.length < 10) {
        failures.push(
          JSON.stringify({
            sequence,
            status: response.status(),
            actualKind: actualActivity?.kind,
            allocationPresent: actualAllocation !== null,
            actualAttributed,
            rewriteCount,
            expected,
          })
        )
      }
    }
    assert.equal(
      failures.length,
      0,
      `Reference model mismatches across accepted sequences (up to 10 shown): ${failures.join('; ')}`
    )
  })
})
