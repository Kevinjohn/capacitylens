import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import db from '@adonisjs/lucid/services/db';
import {
  asDataOwner,
  createFixtureCompanyForOwner,
} from '../../helpers/authenticated_data_fixture.js';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { createIdentity, signIn } from '../../helpers/identities.js';
import { insertMembership } from '../../helpers/memberships.js';

const accountId = 'a-studio';
const ownerEmail = 'bruce.wayne@wayne.example';

interface DirectoryEntry {
  userId: string;
  status: string;
  accessDisabled: boolean;
}

/** One Owner company on a newly migrated baseline, with the Owner signed in. */
async function company(client: Parameters<typeof signIn>[0]) {
  const ownerId = await createIdentity(ownerEmail, { name: 'Bruce Wayne' });
  await createFixtureCompanyForOwner(ownerId, 'Wayne Enterprises', accountId);
  const { cookie } = await signIn(client, ownerEmail);
  return { ownerId, cookie };
}

test.group('package membership storage on a clean install', (group) => {
  group.each.setup(() => freshDatabase());

  test('the baseline holds only the package table and the package doctor accepts it', async ({
    assert,
  }) => {
    const columns = await db.rawQuery('PRAGMA table_info(company_memberships)');
    assert.deepEqual(
      columns.map((column: { name: string }) => column.name),
      ['id', 'scope_id', 'user_id', 'role', 'status', 'created_at', 'updated_at']
    );
    assert.isNull(
      await db.from('sqlite_master').where({ type: 'table', name: 'memberships' }).first()
    );
    const ace = await app.container.make('ace');
    const doctor = await ace.exec('access-control:doctor', []);
    assert.equal(doctor.exitCode, 0);
  });

  test('active, suspended and restricted rows project as active, archived and access disabled', async ({
    client,
    assert,
  }) => {
    const { cookie } = await company(client);
    const activeId = await createIdentity('clark.kent@wayne.example', { name: 'Clark Kent' });
    const suspendedId = await createIdentity('diana.prince@wayne.example', {
      name: 'Diana Prince',
    });
    const restrictedId = await createIdentity('barry.allen@wayne.example', { name: 'Barry Allen' });
    await insertMembership(accountId, activeId, 'editor');
    await insertMembership(accountId, suspendedId, 'viewer', 'suspended');
    await insertMembership(accountId, restrictedId, 'editor');
    await db.table('account_access_restrictions').insert({
      id: 'restrict-barry',
      account_id: accountId,
      principal_id: restrictedId,
      verified_email: null,
      role: 'editor',
      created_at: new Date().toISOString(),
    });
    const directory = await asDataOwner(
      client.get(`/api/accounts/${accountId}/members`),
      cookie
    ).send();
    directory.assertStatus(200);
    const members = (directory.body() as { members: DirectoryEntry[] }).members;
    const projected = (userId: string) => {
      const entry = members.find((member) => member.userId === userId);
      return entry && { status: entry.status, accessDisabled: entry.accessDisabled };
    };
    assert.deepEqual(projected(activeId), { status: 'active', accessDisabled: false });
    assert.deepEqual(projected(suspendedId), { status: 'archived', accessDisabled: false });
    assert.deepEqual(projected(restrictedId), { status: 'active', accessDisabled: true });
  });

  test('an invalid stored role answers a generic server error', async ({ client, assert }) => {
    const { cookie } = await company(client);
    const memberId = await createIdentity('clark.kent@wayne.example', { name: 'Clark Kent' });
    await insertMembership(accountId, memberId, 'stored-role-sentinel');
    const directory = await asDataOwner(
      client.get(`/api/accounts/${accountId}/members`),
      cookie
    ).send();
    directory.assertStatus(500);
    assert.deepEqual(directory.body(), { error: 'Internal server error.' });
    assert.notInclude(directory.text(), 'stored-role-sentinel');
  });

  test('a user with a membership cannot be deleted', async ({ client, assert }) => {
    const { ownerId } = await company(client);
    const refused = await db
      .from('users')
      .where('id', ownerId)
      .delete()
      .then(
        () => null,
        (error: { code?: string; message: string }) => error
      );
    // SQLite reports an ON DELETE RESTRICT refusal with the trigger code and the foreign key message.
    assert.equal(refused?.code, 'SQLITE_CONSTRAINT_TRIGGER');
    assert.isTrue(refused?.message.includes('FOREIGN KEY constraint failed'));
    assert.isNotNull(await db.from('users').where('id', ownerId).first());
  });
});
