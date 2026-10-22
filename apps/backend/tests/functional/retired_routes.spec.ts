import { test } from '@japa/runner'
import { freshDatabase } from '../helpers/fresh_database.js'
import {
  authenticatedDataClient,
  createFixtureCompanyForOwner,
  resetAuthenticatedData,
} from '../helpers/authenticated_data_fixture.js'

test.group('retired persistence routes', (group) => {
  group.setup(() => freshDatabase())

  test('refuses old writes while keeping the authenticated export read', async ({
    client,
    assert,
  }) => {
    const session = await resetAuthenticatedData(client, false)
    const accountId = await createFixtureCompanyForOwner(session.userId, 'Wayne Enterprises')
    const owner = authenticatedDataClient(client, session.cookie)

    const requests = [
      owner.post('/api/batch').json({ ops: [] }),
      owner.post('/api/orgs').json({ name: 'Stark Industries' }),
      owner.post('/api/accounts').json({ name: 'Stark Industries' }),
      owner.patch(`/api/accounts/${accountId}`).json({ name: 'Other name' }),
      owner.delete(`/api/accounts/${accountId}`),
    ]
    for (const request of requests) {
      const response = await request.send()
      response.assertStatus(404)
    }

    const read = await owner.get(`/api/state?accountId=${accountId}`).send()
    read.assertStatus(200)
    assert.deepEqual(
      read.body().accounts.map((account: { id: string }) => account.id),
      [accountId]
    )
  })

  test('fails closed on a multi-company directory without offering a selection', async ({
    client,
  }) => {
    const session = await resetAuthenticatedData(client, false)
    await createFixtureCompanyForOwner(session.userId, 'Wayne Enterprises')
    await createFixtureCompanyForOwner(session.userId, 'Stark Industries')
    const owner = authenticatedDataClient(client, session.cookie)
    const directory = await owner.get('/api/accounts').send()
    directory.assertStatus(409)
  })
})
