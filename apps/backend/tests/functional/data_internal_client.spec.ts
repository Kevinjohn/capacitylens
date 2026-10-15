import type { ApiClient } from '@japa/api-client'
import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import {
  FIXTURE_ACCOUNT,
  FIXTURE_ACTIVITY,
  FIXTURE_ALLOCATION,
  FIXTURE_CLIENT,
  FIXTURE_DISCIPLINE,
  FIXTURE_PHASE,
  FIXTURE_PROJECT,
  FIXTURE_RESOURCE,
} from '@capacitylens/shared/data/fixtures'
import { buildInternalClient } from '@capacitylens/shared/data/internalClient'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppData, AppDataKey } from '@capacitylens/shared/types/entities'
import { applyBatch } from '#services/batch/service'
import { trustedLocalDataContext } from '#services/batch/data_policy'
import { withTransaction } from '#services/with_transaction'
import { stripLifecycle } from './state/database_contract_cases.js'
import { trusted } from './batch/ordering_helpers.js'

async function resetEmpty(client: ApiClient) {
  const response = await client.post('/api/test/reset').json({ seed: false }).send()
  response.assertStatus(200)
}

function put<T extends { id: string }>(table: AppDataKey, row: T) {
  return { method: 'PUT', table, id: row.id, row } as const
}

async function batch(client: ApiClient, ops: unknown[]) {
  return trusted(client.post('/api/batch'))
    .json({ ops } as never)
    .send()
}

async function state(client: ApiClient, accountId?: string) {
  const path = accountId ? `/api/state?accountId=${accountId}&includeInactive=1` : '/api/state'
  const response = await client.get(path).send()
  response.assertStatus(200)
  return response.body() as AppData
}

function bodyError(response: { body(): unknown }) {
  return (response.body() as { error?: unknown }).error
}

test.group('M2b protected Internal client batch contract', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('rejects replacing the generated Internal client while preserving project references', async ({
    client,
    assert,
  }) => {
    await resetEmpty(client)
    const project = {
      ...stripLifecycle(FIXTURE_PROJECT),
      clientId: `internal:${FIXTURE_ACCOUNT.id}`,
    }
    const dependencies = [
      put('accounts', FIXTURE_ACCOUNT),
      put('disciplines', FIXTURE_DISCIPLINE),
      put('projects', project),
      put('phases', FIXTURE_PHASE),
      put('activities', FIXTURE_ACTIVITY),
      put('resources', stripLifecycle(FIXTURE_RESOURCE)),
      put('allocations', FIXTURE_ALLOCATION),
    ]
    const setup = await batch(client, dependencies)
    assert.equal(setup.status(), 200, JSON.stringify(setup.body()))
    const before = await state(client, FIXTURE_ACCOUNT.id)
    const replacement = {
      ...stripLifecycle(FIXTURE_CLIENT),
      id: 'legacy-internal',
      builtin: true,
    }

    const response = await batch(client, [put('clients', replacement)])
    assert.equal(response.status(), 400)
    assert.deepEqual(await state(client, FIXTURE_ACCOUNT.id), before)
    const persistedProject = await db.from('projects').where('id', project.id).first()
    assert.equal(persistedProject?.client_id, `internal:${FIXTURE_ACCOUNT.id}`)
    const persistedAllocation = await db
      .from('allocations')
      .where('id', FIXTURE_ALLOCATION.id)
      .first()
    assert.exists(persistedAllocation)
  })

  test('rejects generic builtin client creation and a second builtin attempt', async ({
    client,
    assert,
  }) => {
    await resetEmpty(client)
    const createdAccount = await batch(client, [put('accounts', FIXTURE_ACCOUNT)])
    createdAccount.assertStatus(200)
    const before = await state(client, FIXTURE_ACCOUNT.id)
    const first = await batch(client, [
      put('clients', {
        ...stripLifecycle(FIXTURE_CLIENT),
        id: 'generic-internal-one',
        builtin: true,
      }),
    ])
    const duplicate = await batch(client, [
      put('clients', {
        ...stripLifecycle(FIXTURE_CLIENT),
        id: 'generic-internal-two',
        builtin: true,
      }),
    ])

    assert.equal(first.status(), 400, 'a generic client create must not replace Internal')
    assert.equal(duplicate.status(), 400, 'a second generic builtin must be rejected')
    assert.match(String(bodyError(duplicate)), /built-in|Internal/i)
    assert.deepEqual(await state(client, FIXTURE_ACCOUNT.id), before)
  })

  test('rejects generic updates to the generated builtin client', async ({ client, assert }) => {
    await resetEmpty(client)
    const generatedId = `internal:${FIXTURE_ACCOUNT.id}`
    const createdAccount = await batch(client, [put('accounts', FIXTURE_ACCOUNT)])
    createdAccount.assertStatus(200)
    const before = await state(client, FIXTURE_ACCOUNT.id)
    const generated = before.clients.find((candidate) => candidate.id === generatedId)!
    const response = await batch(client, [
      put('clients', {
        ...generated,
        name: 'Renamed Internal',
        builtin: true,
      }),
    ])

    assert.equal(response.status(), 400)
    assert.deepEqual(await state(client, FIXTURE_ACCOUNT.id), before)
  })

  test('rejects a counterfeit same-batch Internal echo and rolls back company creation', async ({
    client,
    assert,
  }) => {
    await resetEmpty(client)
    const counterfeit = {
      ...buildInternalClient(FIXTURE_ACCOUNT.id, FIXTURE_ACCOUNT.createdAt),
      name: 'Counterfeit built-in',
      color: '#ffffff',
      builtin: false,
    }
    const response = await batch(client, [
      put('accounts', FIXTURE_ACCOUNT),
      put('clients', counterfeit),
    ])

    assert.equal(response.status(), 400)
    assert.match(String(bodyError(response)), /generated|built-in|Internal/i)
    const stored = await state(client)
    assert.deepEqual(stored.accounts, [])
    assert.deepEqual(stored.clients, [])
  })

  test('accepts the canonical same-batch echo of the generated Internal client', async ({
    client,
    assert,
  }) => {
    await resetEmpty(client)
    const canonical = buildInternalClient(FIXTURE_ACCOUNT.id, FIXTURE_ACCOUNT.createdAt)
    const response = await batch(client, [
      put('accounts', FIXTURE_ACCOUNT),
      put('clients', canonical),
    ])
    response.assertStatus(200)
    assert.deepInclude(response.body(), { ok: true, applied: 2, changed: 1 })
    const accountCreates = await db
      .from('audit_entries')
      .where({ entity: 'accounts', entity_id: FIXTURE_ACCOUNT.id, action: 'create' })
    assert.lengthOf(accountCreates, 1)
    const stored = await state(client, FIXTURE_ACCOUNT.id)
    assert.deepEqual(
      stored.clients.map(({ id, accountId, name, builtin }) => ({ id, accountId, name, builtin })),
      [
        {
          id: `internal:${FIXTURE_ACCOUNT.id}`,
          accountId: FIXTURE_ACCOUNT.id,
          name: 'Internal',
          builtin: true,
        },
      ]
    )
  })

  test('protects one builtin client per company', async ({ client, assert }) => {
    await resetEmpty(client)
    const firstAccount = seed().accounts[0]!
    const secondAccount = seed().accounts[1]!
    await withTransaction((trx) =>
      applyBatch(
        trx,
        [
          { method: 'PUT', table: 'accounts', id: firstAccount.id, row: { ...firstAccount } },
          { method: 'PUT', table: 'accounts', id: secondAccount.id, row: { ...secondAccount } },
        ],
        null,
        trustedLocalDataContext('m2b-builtin-singleton-test', true)
      )
    )

    const firstOrdinary = {
      ...stripLifecycle(FIXTURE_CLIENT),
      id: 'ordinary-first',
      accountId: firstAccount.id,
    }
    const secondOrdinary = {
      ...stripLifecycle(FIXTURE_CLIENT),
      id: 'ordinary-second',
      accountId: secondAccount.id,
    }
    const created = await batch(client, [
      put('clients', firstOrdinary),
      put('clients', secondOrdinary),
    ])
    created.assertStatus(200)
    const afterCreate = await state(client)
    const currentFirst = afterCreate.clients.find((candidate) => candidate.id === firstOrdinary.id)!
    const currentSecond = afterCreate.clients.find(
      (candidate) => candidate.id === secondOrdinary.id
    )!

    const firstDuplicate = await batch(client, [put('clients', { ...currentFirst, builtin: true })])
    const secondDuplicate = await batch(client, [
      put('clients', { ...currentSecond, builtin: true }),
    ])
    assert.equal(firstDuplicate.status(), 400, `${firstAccount.id} keeps one builtin`)
    assert.equal(secondDuplicate.status(), 400, `${secondAccount.id} keeps one builtin`)

    const stored = await state(client)
    for (const account of [firstAccount, secondAccount]) {
      const builtins = stored.clients.filter(
        (candidate) => candidate.accountId === account.id && candidate.builtin === true
      )
      assert.lengthOf(builtins, 1, `${account.id} has exactly one protected builtin`)
      assert.equal(builtins[0]!.id, `internal:${account.id}`)
    }
  })
})
