import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { CompanyFactory } from '#database/factories/company_factory';
import db from '@adonisjs/lucid/services/db';

test.group('transaction helper', (group) => {
  group.setup(() => freshDatabase());

  test('rolls back every write when transactional work fails', async ({ assert }) => {
    await assert.rejects(
      () =>
        db.transaction(async (trx) => {
          await CompanyFactory.client(trx)
            .merge({ id: 'rollback-company', name: 'Rollback Company', color: '#2d75da' })
            .create();
          throw new Error('force rollback');
        }),
      /force rollback/
    );
    const row = await db.from('companies').where('id', 'rollback-company').first();
    assert.isNull(row);
  });
});
