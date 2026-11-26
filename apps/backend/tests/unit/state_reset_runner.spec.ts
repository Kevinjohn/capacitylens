import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { resetState } from '#tests/helpers/state_fixture';
import { countRows } from '#tests/helpers/unit/operator_databases';

test.group('state reset through the Account Kit transaction runner', (group) => {
  group.setup(() => freshDatabase());

  test('refuses without the Kit singleton lock row and leaves every row in place', async ({
    assert,
  }) => {
    await resetState('single');
    const before = {
      companies: await countRows('companies'),
      memberships: await countRows('memberships'),
    };
    assert.isAbove(before.companies, 0);
    // Only the Kit runner touches the singleton lock row, so its absence proves the runner is in use.
    await db.from('account_transaction_lock').delete();
    try {
      await assert.rejects(() => resetState(false), /transaction lock row is missing/);
    } finally {
      await db.table('account_transaction_lock').insert({ id: 1, version: 0 });
    }
    assert.equal(await countRows('companies'), before.companies);
    assert.equal(await countRows('memberships'), before.memberships);
    await resetState(false);
    assert.equal(await countRows('companies'), 0);
  });
});
