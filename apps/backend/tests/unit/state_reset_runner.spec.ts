import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { freshDatabase } from '../helpers/fresh_database.js';
import { resetState } from '#tests/helpers/state_fixture';

async function count(table: string) {
  const row = await db.from(table).count('* as n').first();
  return Number(row?.n ?? 0);
}

test.group('state reset through the Account Kit transaction runner', (group) => {
  group.setup(() => freshDatabase());

  test('refuses without the Kit singleton lock row and leaves every row in place', async ({
    assert,
  }) => {
    await resetState('single');
    const before = { accounts: await count('accounts'), memberships: await count('memberships') };
    assert.isAbove(before.accounts, 0);
    // Only the Kit runner touches the singleton lock row, so its absence proves the runner is in use.
    await db.from('account_transaction_lock').delete();
    try {
      await assert.rejects(() => resetState(false), /transaction lock row is missing/);
    } finally {
      await db.table('account_transaction_lock').insert({ id: 1, version: 0 });
    }
    assert.equal(await count('accounts'), before.accounts);
    assert.equal(await count('memberships'), before.memberships);
    await resetState(false);
    assert.equal(await count('accounts'), 0);
  });
});
