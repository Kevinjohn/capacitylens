import { test } from '@japa/runner'
import User from '#models/user'
import { freshDatabase } from '#tests/helpers/fresh_database'
import { resetState } from '#tests/helpers/state_fixture'
import {
  asLoggedInDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture'
import { clearIdentities, createIdentity } from '#tests/helpers/identities'

const owner = {
  email: 'bruce.wayne@wayne.example',
  password: 'batman-secret-2026',
  name: 'Bruce Wayne',
}

test.group('company route identifier bounds', (group) => {
  group.setup(() => freshDatabase())
  group.each.setup(async () => {
    await resetState(false)
    await clearIdentities()
  })

  test('identifiers longer than their route bound match no route', async ({ client }) => {
    const user = await User.findOrFail(
      await createIdentity(owner.email, { name: owner.name, password: owner.password })
    )
    await createFixtureCompanyForOwner(user.id, 'Wayne Enterprises', 'a-studio')
    const tooLong = 'a'.repeat(255)
    const refused = [
      client.visit('api.members.index', { companyId: tooLong }),
      client
        .visit('api.members.update', { companyId: 'a-studio', userId: tooLong })
        .json({ role: 'editor' }),
      client
        .visit('api.member_resource_links.update', { companyId: 'a-studio', userId: tooLong })
        .json({} as never),
      client
        .visit('api.resource_anonymisations.store', { companyId: 'a-studio', id: 'a'.repeat(129) })
        .json({}),
      client
        .visit('api.invitation_deliveries.store', { companyId: 'a-studio', id: '1'.repeat(129) })
        .json({}),
      client.visit('api.invitations.destroy', { companyId: 'a-studio', id: '1'.repeat(129) }),
    ]
    for (const request of refused) {
      const response = await asLoggedInDataOwner(request, user).send()
      response.assertStatus(404)
    }
    const listed = await asLoggedInDataOwner(
      client.visit('api.members.index', { companyId: 'a-studio' }),
      user
    ).send()
    listed.assertStatus(200)
  })

  test('a malformed route identifier answers the framework validation failure', async ({
    client,
    assert,
  }) => {
    const user = await User.findOrFail(
      await createIdentity(owner.email, { name: owner.name, password: owner.password })
    )
    await createFixtureCompanyForOwner(user.id, 'Wayne Enterprises', 'a-studio')
    const refused = [
      [
        client
          .visit('api.members.update', { companyId: 'a-studio', userId: 'bad.id' })
          .json({ role: 'editor' }),
        'userId',
      ],
      [
        client
          .visit('api.member_status.update', { companyId: 'a-studio', userId: 'bad.id' })
          .json({ status: 'suspended' }),
        'userId',
      ],
      [
        client
          .visit('api.member_resource_links.update', { companyId: 'a-studio', userId: 'bad.id' })
          .json({ resourceId: 'r-1', expectedRevision: null }),
        'userId',
      ],
      [
        client
          .visit('api.member_resource_links.destroy', { companyId: 'a-studio', userId: 'bad.id' })
          .json({ expectedRevision: '1' }),
        'userId',
      ],
      [
        client
          .visit('api.resource_anonymisations.store', { companyId: 'a-studio', id: '-bad' })
          .json({}),
        'id',
      ],
    ] as const
    for (const [request, param] of refused) {
      const response = await asLoggedInDataOwner(request, user).send()
      response.assertStatus(422)
      const { errors } = response.body() as { errors: Array<{ field: string }> }
      assert.equal(errors[0].field, `params.${param}`)
    }
  })

  test('a credential body that names params itself is refused, not overwritten', async ({
    client,
    assert,
  }) => {
    const response = await client
      .visit('api.session.store')
      .header('sec-fetch-site', 'same-origin')
      // Deliberately outside the generated body type, to reach the server's refusal.
      .json({
        email: owner.email,
        password: owner.password,
        params: { companyId: 'a-studio' },
      } as never)
      .send()
    response.assertStatus(422)
    assert.deepEqual((response.body() as unknown as { errors: unknown }).errors, [
      { message: 'Unsupported field.', rule: 'unknownField', field: 'params' },
    ])
  })
})
