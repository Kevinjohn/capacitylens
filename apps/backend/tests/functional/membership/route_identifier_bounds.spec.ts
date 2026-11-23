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

  test('identifiers longer than the package accepts match no route', async ({ client }) => {
    const user = await User.findOrFail(
      await createIdentity(owner.email, { name: owner.name, password: owner.password })
    );
    await createFixtureCompanyForOwner(user.id, 'Wayne Enterprises', 'a-studio');
    const tooLong = 'a'.repeat(255);
    const refused = [
      client.get(`/api/companies/${tooLong}/members`),
      client.patch(`/api/companies/a-studio/members/${tooLong}`).json({ role: 'editor' }),
      client.put(`/api/companies/a-studio/members/${tooLong}/resource-link`).json({}),
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
});
