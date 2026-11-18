import { test } from '@japa/runner';
import type { ApiClient } from '@japa/api-client';
import {
  authenticatedDataClient,
  resetAuthenticatedData,
} from '../helpers/authenticated_data_fixture.js';
import { freshDatabase } from '../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';
import {
  buildCompanyExport,
  serializeCompanyExport,
} from '@capacitylens/shared/data/companyDocument';
import type { Role } from '@capacitylens/shared/domain/access';
import { transformState } from '#transformers/state_transformer';
import { readState } from '#tests/helpers/state_fixture';

const roles: Role[] = ['owner', 'admin', 'editor', 'viewer'];
let userId: string;

async function reset(client: ApiClient) {
  const session = await resetAuthenticatedData(client, true);
  userId = session.userId;
  return authenticatedDataClient(client, session.cookie);
}

/** Archives one a-studio resource so that only an Owner or Admin export carries it. */
async function archiveResource() {
  const candidate = await db.from('resources').where('account_id', 'a-studio').first();
  await db
    .from('resources')
    .where('id', candidate.id)
    .update({ archived_at: new Date().toISOString() });
  return String(candidate.id);
}

async function setRole(role: Role, accountId = 'a-studio') {
  await db.from('memberships').where({ user_id: userId, scope_id: accountId }).update({ role });
}

test.group('company export download', (group) => {
  group.setup(() => freshDatabase());

  test("serves the role's projected export document", async ({ client, assert }) => {
    client = await reset(client);
    await archiveResource();
    await db.from('accounts').where('id', 'a-studio').update({ date_style: 'month-day' });
    for (const role of roles) {
      await setRole(role);
      const response = await client.get('/api/accounts/a-studio/export').send();
      response.assertStatus(200);
      assert.equal(
        response.header('content-disposition'),
        'attachment; filename="capacitylens-data.json"',
        role
      );
      const inactive = role === 'owner' || role === 'admin';
      const expected = serializeCompanyExport(
        buildCompanyExport(
          transformState(await readState('a-studio', inactive), 'a-studio', role),
          {
            accountId: 'a-studio',
            completeness: role === 'owner' ? 'full' : 'redacted',
          }
        )
      );
      assert.equal(response.text(), expected, role);
      assert.include(response.text(), '"dateStyle": "month-day"', role);
    }
  });

  test("labels only the Owner's export full", async ({ client, assert }) => {
    client = await reset(client);
    for (const role of roles) {
      await setRole(role);
      const response = await client.get('/api/accounts/a-studio/export').send();
      response.assertStatus(200);
      const document = JSON.parse(response.text()) as { completeness: string };
      assert.equal(document.completeness, role === 'owner' ? 'full' : 'redacted', role);
    }
  });

  test('includes archived rows only for Owner and Admin', async ({ client, assert }) => {
    client = await reset(client);
    const archivedId = await archiveResource();
    for (const role of roles) {
      await setRole(role);
      const response = await client.get('/api/accounts/a-studio/export').send();
      response.assertStatus(200);
      const document = JSON.parse(response.text()) as { data: { resources: { id: string }[] } };
      const ids = document.data.resources.map((row) => row.id);
      assert.equal(ids.includes(archivedId), role === 'owner' || role === 'admin', role);
    }
  });

  test('refuses a company the caller does not belong to', async ({ client, assert }) => {
    client = await reset(client);
    await db.from('memberships').where({ user_id: userId, scope_id: 'a-loft' }).delete();
    const response = await client.get('/api/accounts/a-loft/export').send();
    response.assertStatus(403);
    assert.equal(response.body().code, 'ACCOUNT_MEMBERSHIP_LOST');
  });

  test('refuses an export that fails validation with its message', async ({ client, assert }) => {
    client = await reset(client);
    const placeholder = await db
      .from('resources')
      .where('account_id', 'a-studio')
      .whereNot('kind', 'person')
      .first();
    await db
      .from('resources')
      .where('id', placeholder.id)
      .update({ avatar_url: 'https://example.test/oracle.png' });
    const response = await client.get('/api/accounts/a-studio/export').send();
    response.assertStatus(400);
    assert.match(response.body().error, /avatarUrl: only a person may have an avatar URL$/);
  });
});
