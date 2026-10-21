import { test } from '@japa/runner'
import type { ApiClient } from '@japa/api-client'
import testUtils from '@adonisjs/core/services/test_utils'
import { seed } from '@capacitylens/shared/data/seed'
import type { AppData } from '@capacitylens/shared/types/entities'

const frozenMessage =
  'Language, week start and time zone are set when the company is created and cannot be changed.'
const frozenFields = { weekStartsOn: 1 as const, timezone: 'Etc/GMT', language: 'en' }

async function reset(client: ApiClient) {
  const response = await client.post('/api/test/reset').json({ seed: true }).send()
  response.assertStatus(200)
}

async function account(client: ApiClient) {
  const response = await client.get('/api/state?accountId=a-studio').send()
  response.assertStatus(200)
  return (response.body() as AppData).accounts[0]!
}

async function batchPutAccount(client: ApiClient, row: Record<string, unknown>) {
  return client
    .post('/api/batch')
    .json({
      ops: [{ method: 'PUT', table: 'accounts', id: 'a-studio', row }],
    })
    .send()
}

async function freezeSeededAccount(client: ApiClient) {
  const initial = { ...seed().accounts[0]!, ...frozenFields }
  const response = await batchPutAccount(client, initial)
  response.assertStatus(200)
}

test.group('M2a batch frozen account fields', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('sets missing frozen values once, permits unchanged full-row sync, and rejects changes with the canonical message', async ({
    client,
    assert,
  }) => {
    await reset(client)
    const initial = { ...seed().accounts[0]!, ...frozenFields }
    const initialized = await batchPutAccount(client, initial)
    assert.equal(initialized.status(), 200)
    const storedInitial = await account(client)
    assert.deepEqual(
      storedInitial as unknown as Record<string, unknown>,
      { ...initial, updatedAt: storedInitial.updatedAt },
      'the initial frozen values are persisted'
    )

    const unchanged = await batchPutAccount(client, {
      ...storedInitial,
      name: 'Renamed Wayne Enterprises',
    })
    assert.equal(unchanged.status(), 200)
    const renamed = await account(client)
    assert.equal(renamed.name, 'Renamed Wayne Enterprises')

    for (const [field, value] of Object.entries({
      weekStartsOn: 0,
      timezone: 'Europe/London',
    })) {
      const before = await account(client)
      const changed = await batchPutAccount(client, { ...before, [field]: value })
      assert.equal(changed.status(), 409, `${field} is frozen after its first stored value`)
      assert.deepEqual(changed.body(), { error: frozenMessage })
      assert.deepEqual(
        await account(client),
        before,
        `${field} refusal leaves the account unchanged`
      )
    }
  })

  test('rejects malformed frozen values and strips unknown retired preferences', async ({
    client,
    assert,
  }) => {
    await reset(client)
    await freezeSeededAccount(client)
    const before = await account(client)
    const malformed = [
      { ...before, language: 'fr' },
      { ...before, language: 'en-gb' },
      { ...before, timezone: 'Mars/Olympus' },
      { ...before, weekStartsOn: 7 },
    ]

    for (const row of malformed) {
      const response = await batchPutAccount(client, row as unknown as Record<string, unknown>)
      assert.equal(response.status(), 400)
      assert.deepEqual(
        await account(client),
        before,
        'invalid frozen input is rejected before persistence'
      )
    }

    const retiredPreference = await batchPutAccount(client, {
      ...before,
      groupResourcesByEngagement: false,
    })
    assert.equal(retiredPreference.status(), 200)
    const after = await account(client)
    assert.deepEqual(
      after,
      { ...before, updatedAt: after.updatedAt },
      'an unknown retired preference is stripped without changing the account'
    )
  })

  test('allows mutable preferences and distinguishes validation errors from frozen-field conflicts', async ({
    client,
    assert,
  }) => {
    await reset(client)
    await freezeSeededAccount(client)
    const before = await account(client)
    const invalid = await batchPutAccount(client, { ...before, timezone: null })
    assert.equal(invalid.status(), 409)
    assert.deepEqual(await account(client), before)

    const mutable = await batchPutAccount(client, {
      ...before,
      name: 'New Company Name',
      schedulingMode: 'blocks',
      disciplinesEnabled: false,
    })
    assert.equal(mutable.status(), 200)
    const saved = await account(client)
    assert.deepEqual(await account(client), {
      ...before,
      name: 'New Company Name',
      schedulingMode: 'blocks',
      disciplinesEnabled: false,
      updatedAt: saved.updatedAt,
    })
  })
})
