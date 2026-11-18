import { test } from '@japa/runner';
import { resetState } from '#tests/helpers/state_fixture';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { clearIdentities } from '../../helpers/identities.js';
import { configureAuth, session, signIn } from '../planning/helpers.js';

const expected = {
  owner: {
    permissions: [
      'planning:read',
      'planning:write',
      'members:list',
      'members:manage',
      'members:signInTracking',
      'invitations:manage',
      'viewAs:use',
      'resources:anonymise',
      'ownership:transfer',
      'company:import',
      'company:anonymise',
    ],
    canSeePrivateNames: true,
    canSeeTimeOffNote: true,
  },
  admin: {
    permissions: [
      'planning:read',
      'planning:write',
      'members:list',
      'members:manage',
      'invitations:manage',
      'viewAs:use',
      'resources:anonymise',
    ],
    canSeePrivateNames: false,
    canSeeTimeOffNote: true,
  },
  editor: {
    permissions: ['planning:read', 'planning:write'],
    canSeePrivateNames: false,
    canSeeTimeOffNote: false,
  },
  viewer: {
    permissions: ['planning:read'],
    canSeePrivateNames: false,
    canSeeTimeOffNote: false,
  },
} as const;

test.group('company directory access grant', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(async () => {
    await clearIdentities();
    await resetState('single');
  });

  for (const role of ['owner', 'admin', 'editor', 'viewer'] as const) {
    test(`sends the ${role} grant with the company row`, async ({ client, assert, cleanup }) => {
      configureAuth(cleanup);
      const { cookie } = await signIn(client, role);
      const response = await session(client.get('/api/accounts'), cookie).send();
      response.assertStatus(200);
      const [row] = response.body() as Record<string, unknown>[];
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
