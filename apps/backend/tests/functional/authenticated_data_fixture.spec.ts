import { test } from '@japa/runner'
import { freshDatabase } from '../helpers/fresh_database.js'
import {
  asDataOwner,
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../helpers/authenticated_data_fixture.js'

test.group('authenticated data fixture', (group) => {
  group.setup(() => freshDatabase())

  test('ordinary data reads require a signed-in company member', async ({ client, assert }) => {
    const session = await resetAuthenticatedData(client, 'single')
    const anonymous = await client.get('/api/state?accountId=a-studio').send()
    anonymous.assertStatus(401)
    const me = await asDataOwner(client.get('/api/auth/me'), session.cookie).send()
    me.assertStatus(200)
    const member = await asDataOwner(
      client.get('/api/state?accountId=a-studio'),
      session.cookie
    ).send()
    member.assertStatus(200)
    assert.equal(member.body().accounts[0]?.id, 'a-studio')
    const owner = authenticatedDataClient(client, session.cookie)
    const proxied = await owner.get('/api/state?accountId=a-studio').send()
    proxied.assertStatus(200)
  })
})
