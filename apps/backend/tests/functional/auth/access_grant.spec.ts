import { test } from '@japa/runner';
import { expected } from '#tests/helpers/auth/access_grant';
import { resetState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { clearIdentities } from '#tests/helpers/identities';
import { configureAuth, loginAsMember, session } from '#tests/functional/planning/helpers';

test.group('company directory access grant', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await clearIdentities();
    await resetState('single');
  });

  for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
    test(`sends the ${role} grant with the company row`, async ({ client, assert, cleanup }) => {
      configureAuth(cleanup);
      const { cookie: user } = await loginAsMember(role);
      const response = await session(client.visit('api.companies.index'), user).send();
      response.assertStatus(200);
      const [row] = response.body().data as Record<string, unknown>[];
      assert.deepEqual(
        {
          role: row?.role,
          permissions: row?.permissions,
          canSeePrivateNames: row?.canSeePrivateNames,
          canSeeTimeOffNote: row?.canSeeTimeOffNote,
        },
        { role, ...expected[role] }
      );
    });
  }
});
