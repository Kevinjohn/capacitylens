import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import { addDaysISO } from '@capacitylens/shared/lib/dateMath'
import { NEUTRAL_COLOR } from '@capacitylens/shared/lib/color'
import { MAX_SPAN_DAYS } from '@capacitylens/shared/lib/schedulingDays'
import { seed } from '@capacitylens/shared/data/seed'
import { externalCapacityDefaults, type AppData } from '@capacitylens/shared/types/entities'

async function reset(client: ApiClient) {
  const response = await client.post('/api/test/reset').json({ seed: true }).send()
  response.assertStatus(200)
}

async function state(client: ApiClient) {
  const response = await client.get('/api/state?accountId=a-studio').send()
  response.assertStatus(200)
  return response.body() as AppData
}

async function put(client: ApiClient, table: keyof AppData, row: Record<string, unknown>) {
  return client
    .post('/api/batch')
    .json({
      ops: [{ method: 'PUT', table, id: String(row.id), row }],
    })
    .send()
}

function newAllocation(id: string, changes: Record<string, unknown> = {}) {
  const row = seed().allocations.find((item) => item.id === 'a-tyler-1')!
  return {
    ...row,
    id,
    startDate: '2026-06-15',
    endDate: '2026-06-15',
    hoursPerDay: 4,
    ...changes,
  }
}

test.group('M2a batch entity validation', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('requires complete ordinary rows and rejects references outside the account', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const before = await state(client)
    const timeOff = { ...seed().timeOff[0]! } as Record<string, unknown>
    delete timeOff.resourceId
    const nullTimeOffResource = { ...seed().timeOff[0]!, resourceId: null }
    const missingClient = { ...seed().projects[0]!, id: 'missing-project-client' } as Record<
      string,
      unknown
    >
    delete missingClient.clientId
    const missingPhaseProject = { ...seed().phases[0]!, id: 'missing-phase-project' } as Record<
      string,
      unknown
    >
    delete missingPhaseProject.projectId
    const missingResourceKind = { ...seed().resources[0]!, id: 'missing-resource-kind' } as Record<
      string,
      unknown
    >
    delete missingResourceKind.kind
    const invalidRows: Array<{ table: keyof AppData; row: Record<string, unknown> }> = [
      { table: 'timeOff', row: timeOff },
      { table: 'timeOff', row: nullTimeOffResource },
      { table: 'resources', row: missingResourceKind },
      { table: 'projects', row: missingClient },
      { table: 'phases', row: missingPhaseProject },
      {
        table: 'projects',
        row: { ...seed().projects[0]!, id: 'invalid-project-parent', clientId: 'missing' },
      },
      {
        table: 'phases',
        row: { ...seed().phases[0]!, id: 'invalid-phase-parent', projectId: 'missing' },
      },
      {
        table: 'projects',
        row: {
          ...seed().projects[0]!,
          id: 'invalid-cross-account-project',
          clientId: 'c-loft-northwind',
        },
      },
      {
        table: 'phases',
        row: { ...seed().phases[0]!, id: 'invalid-cross-account-phase', projectId: 'p-loft-app' },
      },
      {
        table: 'allocations',
        row: newAllocation('missing-allocation-resource', { resourceId: 'missing' }),
      },
      {
        table: 'allocations',
        row: newAllocation('missing-allocation-activity', { activityId: 'missing' }),
      },
      {
        table: 'activities',
        row: {
          ...seed().activities[0]!,
          id: 'project-activity-without-project',
          projectId: undefined,
        },
      },
      {
        table: 'activities',
        row: {
          ...seed().activities[0]!,
          id: 'phase-from-other-project',
          phaseId: 'ph-build',
          projectId: 'p-brand',
        },
      },
      {
        table: 'allocations',
        row: newAllocation('internal-activity-with-project', {
          activityId: 't-admin',
          projectId: 'p-acme',
        }),
      },
      {
        table: 'allocations',
        row: newAllocation('allocation-with-missing-project', { projectId: 'missing-project' }),
      },
      {
        table: 'closures',
        row: {
          id: 'closure-with-resource',
          accountId: 'a-studio',
          name: 'Closed',
          startDate: '2026-06-15',
          endDate: '2026-06-15',
          resourceId: 'r-tyler',
        },
      },
      {
        table: 'closures',
        row: {
          id: 'closure-with-blank-name',
          accountId: 'a-studio',
          name: '   ',
          startDate: '2026-06-15',
          endDate: '2026-06-15',
        },
      },
    ]

    for (const { table, row } of invalidRows) {
      const response = await put(client, table, row)
      assert.equal(response.status(), 400, `${String(table)} ${String(row.id)} must be rejected`)
      assert.deepEqual(
        await state(client),
        before,
        `${String(table)} failure leaves all seeded state unchanged`
      )
    }
  })

  test('rejects malformed and reversed entity dates and the first span beyond the supported limit', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const before = await state(client)
    const startDate = '2026-01-01'
    const overLimit = addDaysISO(startDate, MAX_SPAN_DAYS)
    const invalidRows = [
      {
        table: 'allocations' as const,
        row: newAllocation('reversed-allocation', {
          startDate: '2026-06-16',
          endDate: '2026-06-15',
        }),
      },
      {
        table: 'allocations' as const,
        row: newAllocation('invalid-date-allocation', {
          startDate: '2026-02-30',
          endDate: '2026-03-01',
        }),
      },
      {
        table: 'allocations' as const,
        row: newAllocation('long-allocation', { startDate, endDate: overLimit }),
      },
      {
        table: 'timeOff' as const,
        row: {
          ...seed().timeOff[0]!,
          id: 'reversed-time-off',
          startDate: '2026-06-16',
          endDate: '2026-06-15',
        },
      },
      {
        table: 'timeOff' as const,
        row: { ...seed().timeOff[0]!, id: 'long-time-off', startDate, endDate: overLimit },
      },
      {
        table: 'closures' as const,
        row: {
          id: 'reversed-closure',
          accountId: 'a-studio',
          name: 'Closed',
          startDate: '2026-06-16',
          endDate: '2026-06-15',
        },
      },
    ]

    for (const { table, row } of invalidRows) {
      const response = await put(client, table, row)
      assert.equal(response.status(), 400, `${String(row.id)} must be rejected`)
      assert.deepEqual(await state(client), before, `${String(row.id)} must not persist`)
    }

    const atLimit = newAllocation('maximum-span-allocation', {
      startDate,
      endDate: addDaysISO(startDate, MAX_SPAN_DAYS - 1),
      hoursPerDay: 0,
    })
    const accepted = await put(client, 'allocations', atLimit)
    assert.equal(accepted.status(), 200)
    const stateAtLimit = await state(client)
    assert.equal(
      stateAtLimit.allocations.find((row) => row.id === atLimit.id)?.endDate,
      atLimit.endDate
    )
  })

  test('rejects reversed availability and normalizes a valid person avatar URL', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const person = seed().resources.find((row) => row.id === 'r-tyler')!
    const bounded = {
      ...person,
      firstAvailableDate: '2026-02-01',
      lastAvailableDate: '2026-02-28',
    }
    const initial = await put(client, 'resources', bounded)
    assert.equal(initial.status(), 200)
    const before = await state(client)
    const storedBounded = before.resources.find((row) => row.id === person.id)!

    for (const changes of [
      { firstAvailableDate: 'not-a-date' },
      { firstAvailableDate: '2026-02-30' },
      { lastAvailableDate: '2026-01-01' },
    ]) {
      const response = await put(client, 'resources', { ...storedBounded, ...changes })
      assert.equal(response.status(), 400)
      assert.deepEqual(await state(client), before)
    }

    const avatar = await put(client, 'resources', {
      ...storedBounded,
      avatarUrl: ' https://images.example/b.png ',
    })
    assert.equal(avatar.status(), 200)
    const saved = await state(client)
    assert.equal(
      saved.resources.find((row) => row.id === person.id)?.avatarUrl,
      'https://images.example/b.png'
    )
  })

  test('accepts a closure without any resource reference', async ({ client, assert }) => {
    await reset(client)
    const closure = {
      id: 'resource-free-closure',
      accountId: 'a-studio',
      name: 'Studio shutdown',
      startDate: '2026-12-24',
      endDate: '2026-12-25',
      createdAt: '2026-10-12T00:00:00.000Z',
      updatedAt: '2026-10-12T00:00:00.000Z',
    }
    const response = await put(client, 'closures', closure)
    assert.equal(response.status(), 200)
    const saved = await state(client)
    const savedClosure = saved.closures.find((row) => row.id === closure.id)
    if (!savedClosure) throw new Error('Expected the closure to be persisted')
    assert.isFalse('resourceId' in savedClosure)
  })

  test('rejects entity rebinds that would invalidate existing placeholder allocations', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const before = await state(client)
    const placeholder = before.resources.find((row) => row.id === 'r-ph-designer')!
    const invalidPlaceholder = await put(client, 'resources', {
      ...placeholder,
      projectId: 'p-brand',
    })
    assert.equal(invalidPlaceholder.status(), 400)
    assert.deepEqual(await state(client), before)

    const newPlaceholder = { ...placeholder, id: 'rebind-placeholder' }
    const newActivity = {
      ...seed().activities.find((row) => row.id === 't-wires')!,
      id: 'rebind-activity',
      phaseId: undefined,
    }
    const allocation = newAllocation('rebind-allocation', {
      resourceId: newPlaceholder.id,
      activityId: newActivity.id,
    })
    const established = await client
      .post('/api/batch')
      .json({
        ops: [
          { method: 'PUT', table: 'resources', id: newPlaceholder.id, row: newPlaceholder },
          { method: 'PUT', table: 'activities', id: newActivity.id, row: newActivity },
          { method: 'PUT', table: 'allocations', id: allocation.id, row: allocation },
        ],
      })
      .send()
    assert.equal(established.status(), 200)
    const beforeActivityRebind = await state(client)
    const storedActivity = beforeActivityRebind.activities.find((row) => row.id === newActivity.id)!
    const invalidActivity = await put(client, 'activities', {
      ...storedActivity,
      projectId: 'p-brand',
    })
    assert.equal(invalidActivity.status(), 400)
    assert.deepEqual(await state(client), beforeActivityRebind)
  })

  test('enforces placeholder binding and the company/resource availability intersection', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const before = await state(client)
    const wrongProject = newAllocation('wrong-placeholder-project', {
      resourceId: 'r-ph-designer',
      activityId: 't-brand',
    })
    const invalid = await put(client, 'allocations', wrongProject)
    assert.equal(invalid.status(), 400)
    assert.deepEqual(await state(client), before)

    const validAvailability = {
      ...seed().resources.find((row) => row.id === 'r-tyler')!,
      id: 'bounded-person',
      firstAvailableDate: '2026-06-15',
      lastAvailableDate: '2026-06-15',
    }
    const outside = newAllocation('outside-first-available', {
      resourceId: validAvailability.id,
      startDate: '2026-06-12',
      endDate: '2026-06-12',
    })
    const rejected = await client
      .post('/api/batch')
      .json({
        ops: [
          { method: 'PUT', table: 'resources', id: validAvailability.id, row: validAvailability },
          { method: 'PUT', table: 'allocations', id: outside.id, row: outside },
        ],
      })
      .send()
    assert.equal(rejected.status(), 400)
    assert.deepEqual(
      await state(client),
      before,
      'a later invalid allocation rolls the preceding resource write back'
    )

    const within = newAllocation('inside-availability', {
      resourceId: validAvailability.id,
      startDate: '2026-06-15',
      endDate: '2026-06-15',
    })
    const accepted = await client
      .post('/api/batch')
      .json({
        ops: [
          { method: 'PUT', table: 'resources', id: validAvailability.id, row: validAvailability },
          { method: 'PUT', table: 'allocations', id: within.id, row: within },
        ],
      })
      .send()
    assert.equal(accepted.status(), 200)
    const savedWithin = await state(client)
    assert.isDefined(savedWithin.allocations.find((row) => row.id === within.id))
  })

  test('keeps external resources at zero capacity, rejects their time off, and forbids changing resource kind', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const before = await state(client)
    const person = seed().resources.find((row) => row.id === 'r-tyler')!
    const external = {
      ...seed().resources.find((row) => row.id === 'r-ext-northstar')!,
      id: 'external-validation-resource',
      name: 'Queen Consolidated',
    }
    const nonZero = {
      ...seed().allocations.find((row) => row.id === 'a-ext-1')!,
      id: 'external-nonzero',
      resourceId: external.id,
      hoursPerDay: 1,
    }
    const rejected = await client
      .post('/api/batch')
      .json({
        ops: [
          { method: 'PUT', table: 'resources', id: external.id, row: external },
          { method: 'PUT', table: 'allocations', id: nonZero.id, row: nonZero },
        ],
      })
      .send()
    assert.equal(rejected.status(), 400)
    assert.deepEqual(await state(client), before)

    const zeroLoad = { ...nonZero, id: 'external-zero-load', hoursPerDay: 0 }
    const accepted = await client
      .post('/api/batch')
      .json({
        ops: [
          { method: 'PUT', table: 'resources', id: external.id, row: external },
          { method: 'PUT', table: 'allocations', id: zeroLoad.id, row: zeroLoad },
        ],
      })
      .send()
    assert.equal(accepted.status(), 200)

    const timeOff = {
      id: 'external-time-off',
      accountId: 'a-studio',
      resourceId: external.id,
      startDate: '2026-06-15',
      endDate: '2026-06-15',
      type: 'holiday',
      createdAt: '2026-10-12T00:00:00.000Z',
      updatedAt: '2026-10-12T00:00:00.000Z',
    }
    const externalTimeOff = await put(client, 'timeOff', timeOff)
    assert.equal(externalTimeOff.status(), 400)

    const savedAfterTimeOff = await state(client)
    const savedPerson = savedAfterTimeOff.resources.find((row) => row.id === person.id)!
    const changedKind = { ...savedPerson, kind: 'external' }
    const kindResponse = await put(client, 'resources', changedKind)
    assert.equal(kindResponse.status(), 400)
    const savedAfterKind = await state(client)
    assert.equal(savedAfterKind.resources.find((row) => row.id === person.id)?.kind, 'person')

    const unallocatedPerson = { ...person, id: 'unallocated-kind-change-person' }
    const createdPerson = await put(client, 'resources', unallocatedPerson)
    assert.equal(createdPerson.status(), 200)
    const stateWithPerson = await state(client)
    const storedUnallocatedPerson = stateWithPerson.resources.find(
      (row) => row.id === unallocatedPerson.id
    )!
    const converted = {
      ...storedUnallocatedPerson,
      kind: 'external',
      ...externalCapacityDefaults(),
      color: NEUTRAL_COLOR,
    }
    const rejectedConversion = await put(client, 'resources', converted)
    assert.equal(rejectedConversion.status(), 400)
    const finalState = await state(client)
    assert.equal(
      finalState.resources.find((row) => row.id === unallocatedPerson.id)?.kind,
      'person'
    )
  })
})
