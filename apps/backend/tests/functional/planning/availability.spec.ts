import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { readState } from '#tests/helpers/state_fixture'
import {
  companyId,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  intentSession,
  loginAsMember,
  validationSentence,
} from '#tests/helpers/planning/functional_helpers'
import { mutationInput } from '#tests/helpers/planning/mutations'

test.group('typed resource availability', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetPlanningFixture()
  })

  test('keeps a retained allocation editable after a later resource boundary', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const before = await readState(companyId, true)
    const allocation = before.allocations[0]!
    const boundary = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'resource.update',
          id: allocation.resourceId,
          changes: { firstAvailableDate: '2027-01-01' },
        })
      )
      .send()
    boundary.assertStatus(200)
    assert.isTrue(allocation.endDate < '2027-01-01')

    const edit = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'allocation.update',
          id: allocation.id,
          changes: { note: 'Keep context' },
        })
      )
      .send()
    edit.assertStatus(200)
    const afterEdit = await readState(companyId, true)
    const saved = afterEdit.allocations.find((row) => row.id === allocation.id)!
    assert.equal(saved.note, 'Keep context')
    assert.equal(saved.startDate, allocation.startDate)
    assert.equal(saved.endDate, allocation.endDate)
  })

  test('uses company working days unless an allocation includes non-working days', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const data = await readState(companyId, true)
    const resourceId = newAllocation(data).resourceId
    const calendar = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, { operation: 'settings.update', changes: { workingDays: [1, 2, 3, 4] } })
      )
      .send()
    calendar.assertStatus(200)
    const bounded = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'resource.update',
          id: resourceId,
          changes: { lastAvailableDate: '2026-06-04' },
        })
      )
      .send()
    bounded.assertStatus(200)
    const candidate = {
      ...newAllocation(data),
      resourceId,
      startDate: '2026-06-04',
      endDate: '2026-06-05',
    }
    const ordinary = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(mutationInput(2, { operation: 'allocation.create', allocation: candidate }))
      .send()
    ordinary.assertStatus(200)
    const inclusive = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(3, {
          operation: 'allocation.create',
          allocation: { ...candidate, id: randomUUID(), ignoreWorkingDays: true },
        })
      )
      .send()
    inclusive.assertStatus(422)
    assert.isString(validationSentence(inclusive))
    const after = await readState(companyId, true)
    assert.isDefined(after.allocations.find((row) => row.id === candidate.id))
    assert.isUndefined(
      after.allocations.find(
        (row) =>
          row.id !== candidate.id &&
          row.startDate === candidate.startDate &&
          row.resourceId === resourceId
      )
    )
  })

  test('rolls back an allocation group when an occurrence exceeds availability', async ({
    client,
    assert,
    cleanup,
  }) => {
    configureAuth(cleanup)
    const { cookie } = await loginAsMember()
    const data = await readState(companyId, true)
    const resourceId = newAllocation(data).resourceId
    const bounded = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(0, {
          operation: 'resource.update',
          id: resourceId,
          changes: { lastAvailableDate: '2026-06-01' },
        })
      )
      .send()
    bounded.assertStatus(200)
    const before = await readState(companyId, true)
    const inside = {
      ...newAllocation(data),
      resourceId,
      startDate: '2026-06-01',
      endDate: '2026-06-01',
    }
    const refused = await intentSession(
      client.visit('api.planning_mutations.store', { companyId }),
      cookie
    )
      .json(
        mutationInput(1, {
          operation: 'allocation.createGroup',
          allocation: inside,
          repeat: { pattern: { kind: 'weeks', interval: 1 }, until: '2026-06-08' },
        })
      )
      .send()
    refused.assertStatus(422)
    assert.isString(validationSentence(refused))
    assert.deepEqual(await readState(companyId, true), before)
  })
})
