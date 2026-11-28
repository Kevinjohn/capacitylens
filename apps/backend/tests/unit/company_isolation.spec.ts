import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { transactionalDatabase } from '#tests/helpers/transactional_database'
import Client from '#models/client'
import { ClientFactory } from '#database/factories/client_factory'
import { CompanyFactory } from '#database/factories/company_factory'

test.group('company isolation', (group) => {
  transactionalDatabase(group)
  group.each.setup(async () => {
    await CompanyFactory.merge([
      { id: 'a-studio', name: 'Wayne Enterprises' },
      { id: 'a-loft', name: 'Stark Industries' },
    ]).createMany(2)
    await ClientFactory.merge([
      { id: 'c-wayne', companyId: 'a-studio', name: 'Wayne' },
      { id: 'c-stark', companyId: 'a-loft', name: 'Stark' },
    ]).createMany(2)
  })

  test('fails closed for unscoped model reads', async ({ assert }) => {
    await assert.rejects(() => Client.query(), 'A company scope is required for model reads')
    assert.lengthOf(await Client.query().withScopes((scopes) => scopes.forCompany('a-studio')), 1)
  })
})

test.group('transactional database helper', (group) => {
  transactionalDatabase(group)

  test('a test may leave a row behind', async ({ assert }) => {
    await CompanyFactory.merge({ id: 'a-gotham', name: 'Gotham', color: '#333' }).create()
    assert.exists(await db.from('companies').where('id', 'a-gotham').first())
  })

  test('the next test starts without it', async ({ assert }) => {
    assert.notExists(await db.from('companies').where('id', 'a-gotham').first())
  })
})
