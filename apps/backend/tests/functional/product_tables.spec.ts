import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { APP_DATA_KEYS } from '@capacitylens/shared/types/entities';
import { tables } from '#models_support/product_tables';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { resetState } from '#tests/helpers/state_fixture';
import { StateRepositoryService } from '#services/state_repository_service';

const stateRepository = new StateRepositoryService();

test.group('product table map', (group) => {
  group.setup(() => freshDatabase());

  test('the company snapshot reads every AppData key from its mapped table', async ({ assert }) => {
    await resetState(true);
    assert.sameMembers(Object.keys(tables), [...APP_DATA_KEYS]);
    const companies = await db.from('companies').select('id');
    const read = Object.fromEntries(APP_DATA_KEYS.map((key) => [key, 0]));
    for (const company of companies) {
      const state = await stateRepository.readStateWithClient(
        db.connection(),
        String(company.id),
        true
      );
      assert.sameMembers(Object.keys(state), [...APP_DATA_KEYS]);
      for (const key of APP_DATA_KEYS) read[key] += state[key].length;
    }
    for (const key of APP_DATA_KEYS) {
      const stored = await db.from(tables[key]).count('* as total');
      assert.equal(read[key], Number(stored[0].total), key);
    }
  });
});
