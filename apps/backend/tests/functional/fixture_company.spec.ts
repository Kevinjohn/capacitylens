import { test } from '@japa/runner'
import db from '@adonisjs/lucid/services/db'
import { freshDatabase } from '../helpers/fresh_database.js'
import {
  createFixtureCompanyForOwner,
  resetAuthenticatedData,
} from '../helpers/authenticated_data_fixture.js'

test.group('isolated company fixtures', (group) => {
  group.setup(() => freshDatabase())

  test('creating another company preserves the first company and its rows', async ({
    client,
    assert,
  }) => {
    const owner = await resetAuthenticatedData(client, false)
    const firstId = await createFixtureCompanyForOwner(owner.userId, 'Wayne Enterprises')
    const first = await db.from('accounts').where('id', firstId).firstOrFail()
    const firstInternal = await db.from('clients').where('account_id', firstId).firstOrFail()
    const secondId = await createFixtureCompanyForOwner(owner.userId, 'Stark Industries')

    assert.notEqual(secondId, firstId)
    assert.deepEqual(await db.from('accounts').where('id', firstId).firstOrFail(), first)
    assert.deepEqual(
      await db.from('clients').where('account_id', firstId).firstOrFail(),
      firstInternal
    )
    assert.equal(firstInternal.id, `internal:${firstId}`)
    assert.equal(firstInternal.builtin, 'true')
    const firstMembers = await db
      .from('memberships')
      .where({ account_id: firstId, user_id: owner.userId })
    const secondMembers = await db
      .from('memberships')
      .where({ account_id: secondId, user_id: owner.userId })
    assert.lengthOf(firstMembers, 1)
    assert.lengthOf(secondMembers, 1)
  })

  test('refuses a non-dedicated database path before writing fixture rows', async ({
    client,
    assert,
  }) => {
    const owner = await resetAuthenticatedData(client, false)
    const previous = process.env.CAPACITYLENS_DB
    try {
      process.env.CAPACITYLENS_DB = '/tmp/capacitylens-other.db'
      await assert.rejects(
        () => createFixtureCompanyForOwner(owner.userId, 'Wayne Enterprises'),
        'Company fixtures require the dedicated Japa test database.'
      )
    } finally {
      if (previous === undefined) delete process.env.CAPACITYLENS_DB
      else process.env.CAPACITYLENS_DB = previous
    }
    const accountCount = await db.from('accounts').count('* as total').first()
    assert.equal(accountCount?.total, 0)
  })
})
