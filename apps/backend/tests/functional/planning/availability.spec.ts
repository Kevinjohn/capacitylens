import { randomUUID } from 'node:crypto'
import { test } from '@japa/runner'
import { freshDatabase } from '../../helpers/fresh_database.js'
import { readState } from '#services/state_repository'
import {
  accountId,
  configureAuth,
  newAllocation,
  resetPlanningFixture,
  session,
  signIn,
} from './helpers.js'

const route = (path: string) => `/api/accounts/${accountId}/${path}`
const input = (baseRevision: number, intent: Record<string, unknown>) => ({
  mutationId: randomUUID(),
  baseRevision,
  intent,
})

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
    const { cookie } = await signIn(client)
    const before = await readState(accountId, true)
    const allocation = before.allocations[0]!
    const boundary = await session(
      client.patch(route(`resources/${allocation.resourceId}`)),
      cookie
    )
      .json(
        input(0, {
          operation: 'resource.update',
          id: allocation.resourceId,
          changes: { firstAvailableDate: '2027-01-01' },
        })
      )
      .send()
    boundary.assertStatus(200)
    assert.isTrue(allocation.endDate < '2027-01-01')

    const edit = await session(client.patch(route(`allocations/${allocation.id}`)), cookie)
      .json(
        input(1, {
          operation: 'allocation.update',
          id: allocation.id,
          changes: { note: 'Keep context' },
        })
      )
      .send()
    edit.assertStatus(200)
    const afterEdit = await readState(accountId, true)
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
    const { cookie } = await signIn(client)
    const data = await readState(accountId, true)
    const resourceId = newAllocation(data).resourceId
    const calendar = await session(client.patch(route('settings')), cookie)
      .json(input(0, { operation: 'settings.update', changes: { workingDays: [1, 2, 3, 4] } }))
      .send()
    calendar.assertStatus(200)
    const bounded = await session(client.patch(route(`resources/${resourceId}`)), cookie)
      .json(
        input(1, {
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
    const ordinary = await session(client.post(route('allocations')), cookie)
      .json(input(2, { operation: 'allocation.create', allocation: candidate }))
      .send()
    ordinary.assertStatus(200)
    const inclusive = await session(client.post(route('allocations')), cookie)
      .json(
        input(3, {
          operation: 'allocation.create',
          allocation: { ...candidate, id: randomUUID(), ignoreWeekends: true },
        })
      )
      .send()
    inclusive.assertStatus(400)
    assert.equal((inclusive.body() as { code: string }).code, 'validation_error')
    const after = await readState(accountId, true)
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
    const { cookie } = await signIn(client)
    const data = await readState(accountId, true)
    const resourceId = newAllocation(data).resourceId
    const bounded = await session(client.patch(route(`resources/${resourceId}`)), cookie)
      .json(
        input(0, {
          operation: 'resource.update',
          id: resourceId,
          changes: { lastAvailableDate: '2026-06-01' },
        })
      )
      .send()
    bounded.assertStatus(200)
    const before = await readState(accountId, true)
    const inside = {
      ...newAllocation(data),
      resourceId,
      startDate: '2026-06-01',
      endDate: '2026-06-01',
    }
    const after = { ...inside, id: randomUUID(), startDate: '2026-06-08', endDate: '2026-06-08' }
    const refused = await session(client.post(route('allocations/create-group')), cookie)
      .json(input(1, { operation: 'allocation.createGroup', allocations: [inside, after] }))
      .send()
    refused.assertStatus(400)
    assert.equal((refused.body() as { code: string }).code, 'validation_error')
    assert.deepEqual(await readState(accountId, true), before)
  })
})
