import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { freshDatabase } from '#tests/helpers/fresh_database';
import {
  createFixtureCompanyForOwner,
  resetAuthenticatedData,
} from '#tests/helpers/authenticated_data_fixture';

test.group('isolated company fixtures', (group) => {
  group.setup(() => freshDatabase());

  test('creating another company preserves the first company and its rows', async ({
    client,
    assert,
  }) => {
    const owner = await resetAuthenticatedData(client, false);
    const firstId = await createFixtureCompanyForOwner(owner.userId, 'Wayne Enterprises');
    const first = await db.from('companies').where('id', firstId).firstOrFail();
    const firstInternal = await db.from('clients').where('company_id', firstId).firstOrFail();
    const secondId = await createFixtureCompanyForOwner(owner.userId, 'Stark Industries');

    assert.notEqual(secondId, firstId);
    assert.deepEqual(await db.from('companies').where('id', firstId).firstOrFail(), first);
    assert.deepEqual(
      await db.from('clients').where('company_id', firstId).firstOrFail(),
      firstInternal
    );
    assert.equal(firstInternal.id, `internal:${firstId}`);
    assert.equal(firstInternal.builtin, 1);
    const firstMembers = await db
      .from('memberships')
      .where({ scope_id: firstId, user_id: owner.userId });
    const secondMembers = await db
      .from('memberships')
      .where({ scope_id: secondId, user_id: owner.userId });
    assert.lengthOf(firstMembers, 1);
    assert.lengthOf(secondMembers, 1);
  });
});
