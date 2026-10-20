import { test } from '@japa/runner'
import testUtils from '@adonisjs/core/services/test_utils'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import { serializeData } from '@capacitylens/shared/data/transfer'
import { readState } from '#services/state_repository'
import { interceptChildLoggers } from '../helpers/logger.js'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

test.group('M2b review regressions', (group) => {
  group.setup(() => testUtils.db().migrate())

  test('rejects null person and external names while allowing a placeholder null name', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    for (const kind of ['person', 'external'] as const) {
      const row = before.resources.find((resource) => resource.kind === kind)!
      const rejected = await trusted(client.post('/api/batch'))
        .json({
          ops: [{ method: 'PUT', table: 'resources', id: row.id, row: { ...row, name: null } }],
        })
        .send()
      rejected.assertStatus(400)
      const unchanged = await readState('a-studio', true)
      assert.equal(unchanged.resources.find((item) => item.id === row.id)?.name, row.name)
      assert.lengthOf(await db.from('audit_entries').where('entity_id', row.id), 0)
    }
    const placeholder = before.resources.find((resource) => resource.kind === 'placeholder')!
    const accepted = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'resources',
            id: placeholder.id,
            row: { ...placeholder, name: null },
          },
        ],
      })
      .send()
    accepted.assertStatus(200)
    const placeholderState = await readState('a-studio', true)
    assert.isNull(placeholderState.resources.find((item) => item.id === placeholder.id)?.name)
  })

  test('rejecting a null person name rolls back an earlier sibling write', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const discipline = before.disciplines[0]!
    const person = before.resources.find((resource) => resource.kind === 'person')!
    const rejected = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'disciplines',
            id: discipline.id,
            row: { ...discipline, name: 'Temporary' },
          },
          { method: 'PUT', table: 'resources', id: person.id, row: { ...person, name: null } },
        ],
      })
      .send()
    rejected.assertStatus(400)
    assert.deepEqual(await readState('a-studio', true), before)
    assert.lengthOf(await db.from('audit_entries').where('entity_id', discipline.id), 0)
  })

  test('imports more than 500 rows in one table and rolls back a later chunk failure', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const incoming = structuredClone(before)
    const template = incoming.disciplines[0]!
    incoming.disciplines = Array.from({ length: 501 }, (_, index) => ({
      ...template,
      id: `d-review-${index}`,
      name: `Discipline ${index}`,
    }))
    const request = () =>
      trusted(client.post('/api/import'))
        .json({ accountId: 'a-studio', data: JSON.parse(serializeData(incoming)) })
        .send()
    const accepted = await request()
    accepted.assertStatus(200)
    const committed = await readState('a-studio', true)
    assert.lengthOf(committed.disciplines, 501)
    await db.rawQuery(
      "CREATE TRIGGER m2b_fail_second_chunk BEFORE INSERT ON disciplines WHEN NEW.name = 'Discipline 500' BEGIN SELECT RAISE(ABORT, 'later chunk failed'); END"
    )
    try {
      const failed = await request()
      failed.assertStatus(500)
      assert.deepEqual(await readState('a-studio', true), committed)
      assert.lengthOf(
        await db.from('audit_entries').where({ account_id: 'a-studio', action: 'import' }),
        1
      )
    } finally {
      await db.rawQuery('DROP TRIGGER m2b_fail_second_chunk')
    }
  })

  test('company POST routes refuse an existing id without changing the company', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const existing = before.accounts[0]!
    for (const path of ['/api/accounts', '/api/orgs']) {
      const rejected = await trusted(client.post(path))
        .json({ ...existing, name: 'Overwritten company' })
        .send()
      rejected.assertStatus(403)
      assert.deepEqual(rejected.body(), {
        error: 'This installation already has a company.',
        code: 'FORBIDDEN',
      })
      const after = await readState('a-studio', true)
      assert.deepEqual(after.accounts[0], existing)
    }
  })

  test('accounts POST requires a string id while orgs POST can generate one', async ({
    client,
    assert,
  }) => {
    const template = seed().accounts[0]!
    for (const invalidId of [undefined, null, 7]) {
      await client.post('/api/test/reset').json({ seed: false }).send()
      const payload = { ...template, id: invalidId }
      const rejected = await trusted(client.post('/api/accounts')).json(payload).send()
      rejected.assertStatus(400)
      const state = await readState()
      assert.lengthOf(state.accounts, 0)
    }
    const withoutId: Record<string, unknown> = { ...template }
    delete withoutId.id
    const created = await trusted(client.post('/api/orgs')).json(withoutId).send()
    created.assertStatus(201)
    assert.isString((created.body() as { id: unknown }).id)
  })

  test('company PATCH preserves omitted nullable settings and applies explicit null', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const route = '/api/accounts/a-studio'
    const clear = await trusted(client.patch(route))
      .json({ schedulingMode: null, inlineActivityCreateEnabled: null })
      .send()
    clear.assertStatus(200)
    assert.isNull((clear.body() as { schedulingMode: unknown }).schedulingMode)
    assert.isNull(
      (clear.body() as { inlineActivityCreateEnabled: unknown }).inlineActivityCreateEnabled
    )
    const patchName = await trusted(client.patch(route)).json({ name: 'Wayne Studio' }).send()
    patchName.assertStatus(200)
    const state = await readState('a-studio', true)
    const account = state.accounts[0]!
    assert.isNull(account.schedulingMode)
    assert.isNull(account.inlineActivityCreateEnabled)
  })

  test('batch stale current and audit retain explicitly cleared nullable fields', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const person = before.resources.find((row) => row.kind === 'person')!
    await db.from('resources').where('id', person.id).update({ first_available_date: '2026-12-01' })
    const updated = await readState('a-studio', true)
    const fresh = updated.resources.find((row) => row.id === person.id)!
    const clear = { ...fresh, firstAvailableDate: null }
    const accepted = await trusted(client.post('/api/batch'))
      .json({ ops: [{ method: 'PUT', table: 'resources', id: person.id, row: clear }] })
      .send()
    accepted.assertStatus(200)
    const audits = await db.from('audit_entries').where({ entity_id: person.id, action: 'update' })
    assert.lengthOf(audits, 1)
    assert.include(JSON.parse(audits[0].details).changedFields as string[], 'firstAvailableDate')
    const stale = await trusted(client.post('/api/batch'))
      .json({ ops: [{ method: 'PUT', table: 'resources', id: person.id, row: { ...fresh } }] })
      .send()
    stale.assertStatus(409)
    const current = (stale.body() as unknown as { current: Record<string, unknown> }).current
    assert.isNull(current.firstAvailableDate)
    assert.property(current, 'avatarUrl')
  })

  test('same-batch stale current includes null keys and leaves both writes rolled back', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const person = before.resources.find((row) => row.kind === 'person')!
    const rejected = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          { method: 'PUT', table: 'resources', id: person.id, row: { ...person, avatarUrl: null } },
          { method: 'PUT', table: 'resources', id: person.id, row: { ...person } },
        ],
      })
      .send()
    rejected.assertStatus(409)
    const current = (rejected.body() as unknown as { current: Record<string, unknown> }).current
    assert.propertyVal(current, 'avatarUrl', null)
    assert.propertyVal(current, 'firstAvailableDate', null)
    assert.deepEqual(await readState('a-studio', true), before)
    assert.lengthOf(await db.from('audit_entries').where('entity_id', person.id), 0)
  })

  test('clearing client privacy emits only field names in the SQL audit', async ({
    client,
    assert,
  }) => {
    await client.post('/api/test/reset').json({ seed: true }).send()
    const before = await readState('a-studio', true)
    const clientRow = before.clients.find((row) => row.id === 'c-acme')!
    const privateName = 'Private Queen Name'
    const setPrivate = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'clients',
            id: clientRow.id,
            row: {
              ...clientRow,
              isPrivate: true,
              codeName: 'Queen',
              name: privateName,
            },
          },
        ],
      })
      .send()
    setPrivate.assertStatus(200)
    const privateState = await readState('a-studio', true)
    const privateRow = privateState.clients.find((row) => row.id === clientRow.id)!
    const clear = await trusted(client.post('/api/batch'))
      .json({
        ops: [
          {
            method: 'PUT',
            table: 'clients',
            id: privateRow.id,
            row: {
              ...privateRow,
              isPrivate: null,
              codeName: null,
            },
          },
        ],
      })
      .send()
    clear.assertStatus(200)
    const audits = await db
      .from('audit_entries')
      .where({ entity_id: clientRow.id, action: 'update' })
      .orderBy('created_at', 'desc')
    assert.lengthOf(audits, 2)
    const details = JSON.parse(audits[0].details) as { changedFields: string[] }
    assert.includeMembers(details.changedFields, ['isPrivate', 'codeName'])
    assert.notInclude(JSON.stringify(details), privateName)
    const after = await readState('a-studio', true)
    const stored = after.clients.find((row) => row.id === clientRow.id)!
    assert.isNull(stored.isPrivate)
    assert.isNull(stored.codeName)
  })

  test('company POST and PATCH surface committed logger failures', async ({
    client,
    assert,
    cleanup,
  }) => {
    await client.post('/api/test/reset').json({ seed: false }).send()
    const restoreLogger = interceptChildLoggers((child) => {
      child.info = (() => {
        throw new Error('logger unavailable')
      }) as typeof child.info
    })
    cleanup(restoreLogger)
    const created = await trusted(client.post('/api/accounts'))
      .json({ ...seed().accounts[0]!, id: 'a-review-warning' })
      .send()
    created.assertStatus(201)
    assert.equal(created.header('x-capacitylens-audit-warning'), 'true')
    const patched = await trusted(client.patch('/api/accounts/a-review-warning'))
      .json({ name: 'Wayne Warning' })
      .send()
    patched.assertStatus(200)
    assert.equal(patched.header('x-capacitylens-audit-warning'), 'true')
    const state = await readState('a-review-warning', true)
    assert.equal(state.accounts[0]?.name, 'Wayne Warning')
    assert.lengthOf(
      await db.from('audit_entries').where({ account_id: 'a-review-warning', entity: 'accounts' }),
      2
    )
  })
})
