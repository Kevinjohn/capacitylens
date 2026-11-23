import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import User from '#models/user';
import { resetState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { clearIdentities, createIdentity } from '#tests/helpers/identities';

test.group('loginAs through the Account Kit session guard', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await resetState(false);
    await clearIdentities();
  });

  test('loginAs signs an admitted identity in through the session registry', async ({
    assert,
    client,
  }) => {
    const user = await User.findOrFail(await createIdentity('diana@themyscira.example'));
    const response = await client.get('/api/companies').loginAs(user).send();
    assert.exists(await db.from('account_sessions').where('user_id', user.id).first());
    response.assertStatus(200);
  });

  test('loginAs reaches the own-account route as that user', async ({ client }) => {
    const user = await User.findOrFail(await createIdentity('diana@themyscira.example'));
    const response = await client.get('/api/auth/me').loginAs(user).send();
    response.assertStatus(200);
    response.assertBodyContains({ data: { user: { email: 'diana@themyscira.example' } } });
  });
});
