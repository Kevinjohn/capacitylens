import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import testUtils from '@adonisjs/core/services/test_utils'
import Client from '#models/client'
import { scopedWrite } from '#services/tenant/scoped_write'

test.group('tenant scope', (group) => {
  group.setup(() => testUtils.db().migrate())
  group.each.setup(async () => {
    await db.from('clients').delete()
    await db.from('accounts').delete()
    const now = new Date().toISOString()
    await db.table('accounts').multiInsert([
      {
        id: 'a-studio',
        name: 'Wayne Enterprises',
        color: '#111',
        created_at: now,
        updated_at: now,
      },
      { id: 'a-loft', name: 'Stark Industries', color: '#222', created_at: now, updated_at: now },
    ])
    await db.table('clients').multiInsert([
      {
        id: 'c-wayne',
        account_id: 'a-studio',
        name: 'Wayne',
        color: '#111',
        created_at: now,
        updated_at: now,
      },
      {
        id: 'c-stark',
        account_id: 'a-loft',
        name: 'Stark',
        color: '#222',
        created_at: now,
        updated_at: now,
      },
    ])
  })

  test('fails closed for unscoped model reads', async ({ assert }) => {
    await assert.rejects(() => Client.query(), 'A company scope is required for model reads')
    assert.lengthOf(await Client.query().withScopes((scopes) => scopes.forCompany('a-studio')), 1)
  })

  test('scopes bulk writes to one company', async ({ assert }) => {
    assert.throws(() => scopedWrite('clients', ''))
    await scopedWrite('clients', 'a-studio').update({ color: '#333' })
    const wayne = await db.from('clients').where('id', 'c-wayne').first()
    const stark = await db.from('clients').where('id', 'c-stark').first()
    assert.equal(wayne.color, '#333')
    assert.equal(stark.color, '#222')
  })
})
