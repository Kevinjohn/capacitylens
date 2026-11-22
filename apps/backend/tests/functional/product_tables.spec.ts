import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { APP_DATA_KEYS } from '@capacitylens/shared/types/entities';
import { tables } from '#services/product_tables';
import { readStateWithClient } from '#services/state_repository';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { resetState } from '#tests/helpers/state_fixture';

test.group('product table map', (group) => {
  group.setup(() => freshDatabase());

  test('the company snapshot reads every AppData key from its mapped table', async ({ assert }) => {
    await resetState(true);
    assert.sameMembers(Object.keys(tables), [...APP_DATA_KEYS]);
    const accounts = await db.from('accounts').select('id');
    const read = Object.fromEntries(APP_DATA_KEYS.map((key) => [key, 0]));
    for (const account of accounts) {
      const state = await readStateWithClient(db.connection(), String(account.id), true);
      assert.sameMembers(Object.keys(state), [...APP_DATA_KEYS]);
      for (const key of APP_DATA_KEYS) read[key] += state[key].length;
    }
    for (const key of APP_DATA_KEYS) {
      const stored = await db.from(tables[key]).count('* as total');
      assert.equal(read[key], Number(stored[0].total), key);
    }
  });
});
