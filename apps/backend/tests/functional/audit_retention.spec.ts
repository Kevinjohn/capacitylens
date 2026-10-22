import { test } from '@japa/runner'
import { resetAuthenticatedClient } from '../helpers/authenticated_data_fixture.js'
import { freshDatabase } from '../helpers/fresh_database.js'
import db from '@adonisjs/lucid/services/db'
import { seed } from '@capacitylens/shared/data/seed'
import { readState } from '#services/state_repository'
import AuditEntry from '#models/audit_entry'

const trusted = <T extends { header(name: string, value: string): T }>(request: T) =>
  request.header('sec-fetch-site', 'same-origin')

test.group('M2b deletion audit retention', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await db.from('audit_entries').delete()
    await db.from('accounts').delete()
  })

  test('deletion retains metadata and prior history, stays scoped and is idempotent', async ({
    client,
    assert,
  }) => {
    client = await resetAuthenticatedClient(client, false)
    const created = await trusted(client.post('/api/orgs'))
      .json({ ...seed().accounts[0]!, id: 'a-audit-wayne' })
      .send()
    created.assertStatus(201)
    await db.table('accounts').insert({
      id: 'a-audit-stark',
      name: 'Stark Industries',
      color: '#2d75da',
      created_at: '2026-10-13T00:00:00.000Z',
      updated_at: '2026-10-13T00:00:00.000Z',
    })
    await db.table('audit_entries').insert({
      id: 'audit-stark',
      account_id: 'a-audit-stark',
      actor_id: null,
      action: 'create',
      entity: 'accounts',
      entity_id: 'a-audit-stark',
      details: '{}',
      created_at: '2026-10-13T00:00:00.000Z',
      updated_at: '2026-10-13T00:00:00.000Z',
    })
    const beforeOther = await db.from('audit_entries').where('account_id', 'a-audit-stark')
    const deleted = await trusted(client.delete('/api/accounts/a-audit-wayne')).send()
    deleted.assertStatus(204)
    const erased = await readState('a-audit-wayne', true)
    assert.lengthOf(erased.accounts, 0)
    const history = await db
      .from('audit_entries')
      .where('account_id', 'a-audit-wayne')
      .orderBy('created_at')
    assert.lengthOf(history, 2)
    assert.deepInclude(
      history.map(({ action, entity, entity_id, account_id }) => ({
        action,
        entity,
        entity_id,
        account_id,
      })),
      {
        action: 'delete',
        entity: 'accounts',
        entity_id: 'a-audit-wayne',
        account_id: 'a-audit-wayne',
      }
    )
    assert.deepEqual(
      await db.from('audit_entries').where('account_id', 'a-audit-stark'),
      beforeOther
    )
    let scopeError: unknown
    try {
      await AuditEntry.query().first()
    } catch (error) {
      scopeError = error
    }
    assert.match(String(scopeError), /A company scope is required for model reads/)
    assert.lengthOf(
      await AuditEntry.query().withScopes((scopes) => scopes.forCompany('a-audit-stark')),
      1
    )
    const repeated = await trusted(client.delete('/api/accounts/a-audit-wayne')).send()
    repeated.assertStatus(401)
    assert.lengthOf(await db.from('audit_entries').where('account_id', 'a-audit-wayne'), 2)
    await db.from('audit_entries').where('account_id', 'a-audit-wayne').delete()
  })

  test('a failed audit insert rolls back deletion and related rows', async ({ client, assert }) => {
    client = await resetAuthenticatedClient(client, false)
    const created = await trusted(client.post('/api/orgs'))
      .json({ ...seed().accounts[0]!, id: 'a-audit-fail' })
      .send()
    created.assertStatus(201)
    const before = await readState('a-audit-fail', true)
    const prior = await db.from('audit_entries').where('account_id', 'a-audit-fail')
    await db.rawQuery(
      "CREATE TRIGGER m2b_fail_delete_audit BEFORE INSERT ON audit_entries WHEN NEW.action = 'delete' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END"
    )
    try {
      const failed = await trusted(client.delete('/api/accounts/a-audit-fail')).send()
      failed.assertStatus(500)
      assert.deepEqual(await readState('a-audit-fail', true), before)
      assert.deepEqual(await db.from('audit_entries').where('account_id', 'a-audit-fail'), prior)
    } finally {
      await db.rawQuery('DROP TRIGGER m2b_fail_delete_audit')
    }
  })
})
