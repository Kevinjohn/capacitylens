import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import env from '#start/env'
import { Env } from '@adonisjs/core/env'
import { seed } from '@capacitylens/shared/data/seed'
import { SINGLE_COMPANY_CAP_MESSAGE } from '@capacitylens/shared/account/policy'
import { readState } from '#services/state_repository'
import { FALLBACK_PRESET_COLOR } from '@capacitylens/shared/lib/color'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')
const originalMultiAccountProcessValue = process.env.CAPACITYLENS_MULTI_ACCOUNT
const hadMultiAccountProcessValue = Object.hasOwn(process.env, 'CAPACITYLENS_MULTI_ACCOUNT')

function restoreMultiAccount(prior: boolean | undefined, priorProcess: string | undefined) {
  env.set('CAPACITYLENS_MULTI_ACCOUNT', prior)
  if (priorProcess === undefined) delete process.env.CAPACITYLENS_MULTI_ACCOUNT
  else process.env.CAPACITYLENS_MULTI_ACCOUNT = priorProcess
}

test.group('M2b company route compatibility', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('both company POST routes default only omitted color', async ({ client, assert }) => {
    for (const path of ['/api/accounts', '/api/orgs']) {
      await client.post('/api/test/reset').json({ seed: false }).send()
      const created = await trusted(client.post(path))
        .json({ id: 'a-color-default', name: 'Wayne Enterprises' })
        .send()
      created.assertStatus(201)
      assert.equal((created.body() as { color: string }).color, FALLBACK_PRESET_COLOR)
      const persisted = await readState('a-color-default', true)
      assert.equal(persisted.accounts[0]?.color, FALLBACK_PRESET_COLOR)
      for (const color of [null, 'not-a-color']) {
        await client.post('/api/test/reset').json({ seed: false }).send()
        const rejected = await trusted(client.post(path))
          .json({ id: 'a-color-default', name: 'Wayne Enterprises', color })
          .send()
        rejected.assertStatus(400)
        const rejectedState = await readState()
        assert.lengthOf(rejectedState.accounts, 0)
      }
    }
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const patched = await trusted(client.patch('/api/accounts/a-studio'))
      .json({ name: 'Wayne Updated' })
      .send()
    patched.assertStatus(200)
    const after = await readState('a-studio', true)
    assert.equal(after.accounts[0]?.color, before.accounts[0]?.color)
  })

  test('both company POST routes reject malformed supplied timestamps before stamping', async ({
    client,
    assert,
  }) => {
    const template = seed().accounts[0]!
    for (const path of ['/api/accounts', '/api/orgs']) {
      for (const field of ['createdAt', 'updatedAt'] as const) {
        for (const value of [null, 7, 'white space', 'x'.repeat(257)]) {
          await client.post('/api/test/reset').json({ seed: false }).send()
          const rejected = await trusted(client.post(path))
            .json({ ...template, id: 'a-company-metadata', [field]: value })
            .send()
          rejected.assertStatus(400)
          assert.deepEqual(rejected.body(), { error: `${field} must be a bounded identifier.` })
          const state = await readState()
          assert.lengthOf(state.accounts, 0)
          assert.lengthOf(await db.from('audit_entries'), 0)
        }
      }
      await client.post('/api/test/reset').json({ seed: false }).send()
      const valid = await trusted(client.post(path))
        .json({
          id: 'a-company-metadata',
          name: template.name,
          color: template.color,
          createdAt: 'opaque_revision',
          updatedAt: 'opaque_revision',
        })
        .send()
      valid.assertStatus(201)
    }
  })

  test('company PATCH rejects malformed supplied timestamps and accepts stored echoes', async ({
    client,
    assert,
  }) => {
    for (const field of ['createdAt', 'updatedAt'] as const) {
      for (const value of [null, 7, 'white space', 'x'.repeat(257)]) {
        await client.post('/api/test/reset').json({ seed: true }).send()
        const before = await readState('a-studio', true)
        const rejected = await trusted(client.patch('/api/accounts/a-studio'))
          .json({ name: 'Rejected company', [field]: value })
          .send()
        rejected.assertStatus(400)
        assert.deepEqual(rejected.body(), { error: `${field} must be a bounded identifier.` })
        assert.deepEqual(await readState('a-studio', true), before)
        assert.lengthOf(await db.from('audit_entries').where('account_id', 'a-studio'), 0)
      }
    }
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const account = before.accounts[0]!
    const accepted = await trusted(client.patch('/api/accounts/a-studio'))
      .json({ name: 'Wayne Echo', createdAt: account.createdAt, updatedAt: account.updatedAt })
      .send()
    accepted.assertStatus(200)
  })

  test('accounts creation keeps omitted and null settings, while orgs applies its defaults', async ({
    client,
    assert,
  }) => {
    const template = seed().accounts[0]!
    for (const settings of [{}, { schedulingMode: null, inlineActivityCreateEnabled: null }]) {
      await client.post('/api/test/reset').json({ seed: false }).send()
      const created = await trusted(client.post('/api/accounts'))
        .json({ id: 'a-account-defaults', name: template.name, color: template.color, ...settings })
        .send()
      created.assertStatus(201)
      const account = created.body() as {
        schedulingMode: unknown
        inlineActivityCreateEnabled: unknown
      }
      assert.isNull(account.schedulingMode)
      assert.isNull(account.inlineActivityCreateEnabled)
      const persisted = await readState('a-account-defaults', true)
      assert.isNull(persisted.accounts[0]?.schedulingMode)
      assert.isNull(persisted.accounts[0]?.inlineActivityCreateEnabled)
    }
    await client.post('/api/test/reset').json({ seed: false }).send()
    const org = await trusted(client.post('/api/orgs'))
      .json({ name: template.name, color: template.color })
      .send()
    org.assertStatus(201)
    const orgId = (org.body() as { id: string }).id
    const persistedOrg = await readState(orgId, true)
    assert.equal(persistedOrg.accounts[0]?.schedulingMode, 'days')
    assert.isFalse(persistedOrg.accounts[0]?.inlineActivityCreateEnabled)
    await client.post('/api/test/reset').json({ seed: false }).send()
    const explicit = await trusted(client.post('/api/orgs'))
      .json({
        name: template.name,
        color: template.color,
        schedulingMode: 'hourly',
        inlineActivityCreateEnabled: true,
      })
      .send()
    explicit.assertStatus(201)
    assert.equal((explicit.body() as { schedulingMode: string }).schedulingMode, 'hourly')
    assert.isTrue(
      (explicit.body() as { inlineActivityCreateEnabled: boolean }).inlineActivityCreateEnabled
    )
  })

  test('company PATCH rejects a stale supplied revision but allows matching and omitted revisions', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const originalState = await readState('a-studio', true)
    const original = originalState.accounts[0]!
    const first = await trusted(client.patch('/api/accounts/a-studio'))
      .json({ name: 'Wayne First' })
      .send()
    first.assertStatus(200)
    const latestState = await readState('a-studio', true)
    const latest = latestState.accounts[0]!
    assert.notEqual(latest.updatedAt, original.updatedAt)
    const auditsBefore = await db
      .from('audit_entries')
      .where({ account_id: 'a-studio', entity: 'accounts' })
    const stale = await trusted(client.patch('/api/accounts/a-studio'))
      .json({ name: 'Rejected stale company', updatedAt: original.updatedAt })
      .send()
    stale.assertStatus(409)
    assert.deepEqual(stale.body(), {
      error: 'The record was modified more recently on the server.',
      current: latest,
    })
    const unchanged = await readState('a-studio', true)
    assert.deepEqual(unchanged.accounts[0], latest)
    assert.deepEqual(
      await db.from('audit_entries').where({ account_id: 'a-studio', entity: 'accounts' }),
      auditsBefore
    )
    const matching = await trusted(client.patch('/api/accounts/a-studio'))
      .json({ name: 'Wayne Matching', updatedAt: latest.updatedAt })
      .send()
    matching.assertStatus(200)
    const omitted = await trusted(client.patch('/api/accounts/a-studio'))
      .json({ name: 'Wayne Omitted' })
      .send()
    omitted.assertStatus(200)
    const finalState = await readState('a-studio', true)
    assert.equal(finalState.accounts[0]?.name, 'Wayne Omitted')
  })

  test('company PATCH rejects malformed fields before a stale revision', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const originalState = await readState('a-studio', true)
    const original = originalState.accounts[0]!
    const first = await trusted(client.patch('/api/accounts/a-studio'))
      .json({ name: 'Wayne First' })
      .send()
    first.assertStatus(200)
    for (const bad of [{ name: null }, { unknownSetting: true }, { schedulingMode: 'nonsense' }]) {
      const rejected = await trusted(client.patch('/api/accounts/a-studio'))
        .json({ ...bad, updatedAt: original.updatedAt })
        .send()
      rejected.assertStatus(400)
    }
    const latestState = await readState('a-studio', true)
    assert.equal(latestState.accounts[0]?.name, 'Wayne First')
  })

  test('missing company PATCH remains not found before metadata validation', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const rejected = await trusted(client.patch('/api/accounts/a-missing'))
      .json({ name: 'Missing', updatedAt: null })
      .send()
    rejected.assertStatus(404)
    assert.deepEqual(rejected.body(), { error: 'Company not found.' })
    assert.lengthOf(await db.from('audit_entries'), 0)
  })

  test('frozen company fields refuse before a stale revision', async ({ client, assert }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const original = before.accounts[0]!
    const first = await trusted(client.patch('/api/accounts/a-studio'))
      .json({ name: 'Wayne First', timezone: 'Europe/London' })
      .send()
    first.assertStatus(200)
    const current = await readState('a-studio', true)
    const auditsBefore = await db.from('audit_entries').where('account_id', 'a-studio')
    const rejected = await trusted(client.patch('/api/accounts/a-studio'))
      .json({ timezone: 'Europe/Paris', updatedAt: original.updatedAt })
      .send()
    rejected.assertStatus(409)
    assert.deepEqual(rejected.body(), {
      error:
        'Language, week start and time zone are set when the company is created and cannot be changed.',
    })
    assert.deepEqual(await readState('a-studio', true), current)
    assert.deepEqual(await db.from('audit_entries').where('account_id', 'a-studio'), auditsBefore)
  })

  test('off-mode fresh duplicate POST obeys the company cap before conflict', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const existingState = await readState('a-studio', true)
    const existing = existingState.accounts[0]!
    for (const path of ['/api/accounts', '/api/orgs']) {
      const rejected = await trusted(client.post(path))
        .json({ ...existing, name: 'Rejected replacement' })
        .send()
      rejected.assertStatus(403)
      assert.deepEqual(rejected.body(), {
        error: SINGLE_COMPANY_CAP_MESSAGE,
        code: 'FORBIDDEN',
        retryable: false,
      })
      const unchanged = await readState('a-studio', true)
      assert.deepEqual(unchanged.accounts[0], existing)
      assert.lengthOf(await db.from('audit_entries').where('account_id', 'a-studio'), 0)
    }
  })

  test('company POST rejects malformed fields before the off-mode cap', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    for (const path of ['/api/accounts', '/api/orgs']) {
      for (const bad of [{ name: null }, { unknownSetting: true }]) {
        const rejected = await trusted(client.post(path))
          .json({ id: 'a-second-company', name: 'Stark Industries', color: '#2d75da', ...bad })
          .send()
        rejected.assertStatus(400)
        assert.deepEqual(await readState('a-studio', true), before)
      }
    }
  })

  test('duplicate POST still requires a supplied company name in both modes', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = env.get('CAPACITYLENS_MULTI_ACCOUNT')
    const priorProcess = process.env.CAPACITYLENS_MULTI_ACCOUNT
    cleanup(() => restoreMultiAccount(prior, priorProcess))
    for (const multiAccount of [false, true]) {
      env.set('CAPACITYLENS_MULTI_ACCOUNT', multiAccount)
      await client.post('/api/test/reset').json({ seed: true }).send()
      const before = await readState('a-studio', true)
      for (const path of ['/api/accounts', '/api/orgs']) {
        const rejected = await trusted(client.post(path))
          .json({ id: 'a-studio', color: before.accounts[0]!.color })
          .send()
        rejected.assertStatus(400)
        assert.deepEqual(rejected.body(), { error: 'Company name is required.' })
        assert.deepEqual(await readState('a-studio', true), before)
        assert.lengthOf(await db.from('audit_entries').where('account_id', 'a-studio'), 0)
      }
    }
  })

  test('multi-company mode keeps duplicate-id creation as a conflict', async ({
    client,
    assert,
    cleanup,
  }) => {
    const prior = env.get('CAPACITYLENS_MULTI_ACCOUNT')
    const priorProcess = process.env.CAPACITYLENS_MULTI_ACCOUNT
    env.set('CAPACITYLENS_MULTI_ACCOUNT', true)
    cleanup(() => restoreMultiAccount(prior, priorProcess))
    await client.post('/api/test/reset').json({ seed: true }).send()
    const existingState = await readState('a-studio', true)
    const existing = existingState.accounts[0]!
    for (const path of ['/api/accounts', '/api/orgs']) {
      const rejected = await trusted(client.post(path))
        .json({ ...existing, name: 'Rejected replacement' })
        .send()
      rejected.assertStatus(409)
      assert.deepEqual(rejected.body(), { error: 'Company already exists.' })
      const unchanged = await readState('a-studio', true)
      assert.deepEqual(unchanged.accounts[0], existing)
    }
  })

  test('multi-company test cleanup leaves child environment valid', ({ assert }) => {
    assert.doesNotThrow(() =>
      Env.rules({ CAPACITYLENS_MULTI_ACCOUNT: Env.schema.boolean.optional() }).validate({})
    )
    assert.equal(
      Object.hasOwn(process.env, 'CAPACITYLENS_MULTI_ACCOUNT'),
      hadMultiAccountProcessValue
    )
    assert.equal(process.env.CAPACITYLENS_MULTI_ACCOUNT, originalMultiAccountProcessValue)
  })

  test('multi-company cleanup preserves an originally configured value', ({ assert }) => {
    const prior = env.get('CAPACITYLENS_MULTI_ACCOUNT')
    const priorProcess = process.env.CAPACITYLENS_MULTI_ACCOUNT
    try {
      env.set('CAPACITYLENS_MULTI_ACCOUNT', false)
      const configured = env.get('CAPACITYLENS_MULTI_ACCOUNT')
      const configuredProcess = process.env.CAPACITYLENS_MULTI_ACCOUNT
      env.set('CAPACITYLENS_MULTI_ACCOUNT', true)
      restoreMultiAccount(configured, configuredProcess)
      assert.isFalse(env.get('CAPACITYLENS_MULTI_ACCOUNT'))
      assert.equal(process.env.CAPACITYLENS_MULTI_ACCOUNT, 'false')
    } finally {
      restoreMultiAccount(prior, priorProcess)
    }
  })
})
