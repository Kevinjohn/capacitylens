import { test } from '@japa/runner';
import User from '#models/user';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { resetState } from '#tests/helpers/state_fixture';
import {
  asLoggedInDataOwner,
  createFixtureCompanyForOwner,
} from '#tests/helpers/authenticated_data_fixture';
import { clearIdentities, createIdentity } from '#tests/helpers/identities';

const owner = {
  email: 'bruce.wayne@wayne.example',
  password: 'batman-secret-2026',
  name: 'Bruce Wayne',
};

test.group('company route identifier bounds', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
  });

  test('identifiers longer than their route bound match no route', async ({ client }) => {
    const user = await User.findOrFail(
      await createIdentity(owner.email, { name: owner.name, password: owner.password })
    );
    await createFixtureCompanyForOwner(user.id, 'Wayne Enterprises', 'a-studio');
    const tooLong = 'a'.repeat(255);
    const refused = [
      client.get(`/api/v1/companies/${tooLong}/members`),
      client.patch(`/api/v1/companies/a-studio/members/${tooLong}`).json({ role: 'editor' }),
      client.put(`/api/v1/companies/a-studio/members/${tooLong}/resource-link`).json({}),
      client.post(`/api/v1/companies/a-studio/resources/${'a'.repeat(129)}/anonymise`).json({}),
      client.post(`/api/v1/companies/a-studio/invitations/${'1'.repeat(129)}/resend`).json({}),
      client.delete(`/api/v1/companies/a-studio/invitations/${'1'.repeat(129)}`),
    ];
    for (const request of refused) {
      const response = await asLoggedInDataOwner(request, user).send();
      response.assertStatus(404);
    }
    const listed = await asLoggedInDataOwner(
      client.visit('api.members.index', { companyId: 'a-studio' }),
      user
    ).send();
    listed.assertStatus(200);
  });

  test('a malformed route identifier answers the framework validation failure', async ({
    client,
    assert,
  }) => {
    const user = await User.findOrFail(
      await createIdentity(owner.email, { name: owner.name, password: owner.password })
    );
    await createFixtureCompanyForOwner(user.id, 'Wayne Enterprises', 'a-studio');
    const refused = [
      [
        client.patch('/api/v1/companies/a-studio/members/bad.id').json({ role: 'editor' }),
        'userId',
      ],
      [
        client
          .patch('/api/v1/companies/a-studio/members/bad.id/status')
          .json({ status: 'suspended' }),
        'userId',
      ],
      [
        client
          .put('/api/v1/companies/a-studio/members/bad.id/resource-link')
          .json({ resourceId: 'r-1', expectedRevision: null }),
        'userId',
      ],
      [
        client
          .delete('/api/v1/companies/a-studio/members/bad.id/resource-link')
          .json({ expectedRevision: '1' }),
        'userId',
      ],
      [client.post('/api/v1/companies/a-studio/resources/-bad/anonymise').json({}), 'id'],
    ] as const;
    for (const [request, param] of refused) {
      const response = await asLoggedInDataOwner(request, user).send();
      response.assertStatus(422);
      assert.equal(response.body().errors[0].field, `params.${param}`);
    }
  });

  test('a body that names params itself is refused, not overwritten', async ({
    client,
    assert,
  }) => {
    const user = await User.findOrFail(
      await createIdentity(owner.email, { name: owner.name, password: owner.password })
    );
    await createFixtureCompanyForOwner(user.id, 'Wayne Enterprises', 'a-studio');
    const response = await asLoggedInDataOwner(
      client
        .put('/api/v1/companies/a-studio/getting-started')
        .json({ dismissed: true, params: { companyId: 'a-studio' } }),
      user
    ).send();
    response.assertStatus(422);
    assert.deepEqual(response.body().errors, [
      { message: 'Unsupported field.', rule: 'unknownField', field: 'params' },
    ]);
  });
});
