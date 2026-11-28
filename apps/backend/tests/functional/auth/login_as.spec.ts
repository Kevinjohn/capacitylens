import { test } from '@japa/runner'
import User from '#models/user'
import { resetState } from '#tests/helpers/state_fixture'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { clearIdentities, createIdentity } from '#tests/helpers/identities'

test.group('loginAs through the Account Kit session guard', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
  })

  test('loginAs signs an admitted identity in through the session registry', async ({
    client,
    db,
  }) => {
    const user = await User.findOrFail(await createIdentity('diana@themyscira.example'))
    const response = await client.visit('api.companies.index').loginAs(user).send()
    await db.assertHas('account_sessions', { user_id: user.id })
    response.assertStatus(200)
  })

  test('loginAs reaches the own-account route as that user', async ({ client }) => {
    const user = await User.findOrFail(await createIdentity('diana@themyscira.example'))
    const response = await client.visit('api.session.show').loginAs(user).send()
    response.assertStatus(200)
    response.assertBodyContains({ data: { user: { email: 'diana@themyscira.example' } } })
  })
})
