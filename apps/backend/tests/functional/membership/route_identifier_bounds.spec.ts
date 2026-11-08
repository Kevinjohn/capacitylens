import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { resetState } from '#services/state_repository';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { clearIdentities, signUpAndIn } from '../../helpers/identities.js';

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
    const signedIn = await signUpAndIn(client, owner);
    signedIn.assertStatus(200);
    const cookie = signedIn.cookie('adonis-session')!.value;
    const user = await db.from('users').where('email', owner.email).first();
    await createFixtureCompanyForOwner(String(user!.id), 'Wayne Enterprises', 'a-studio');
    const tooLong = 'a'.repeat(255);
    const refused = [
      client.get(`/api/accounts/${tooLong}/members`),
      client.patch(`/api/accounts/a-studio/members/${tooLong}`).json({ role: 'editor' }),
      client.put(`/api/accounts/a-studio/members/${tooLong}/resource-link`).json({}),
    ];
    for (const request of refused) {
      const response = await asDataOwner(request, cookie).send();
      response.assertStatus(404);
    }
    const listed = await asDataOwner(client.get('/api/accounts/a-studio/members'), cookie).send();
    listed.assertStatus(200);
  });
});
