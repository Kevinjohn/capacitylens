import { test } from '@japa/runner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import db from '@adonisjs/lucid/services/db';

test.group('transaction helper', (group) => {
  group.setup(() => freshDatabase());

  test('rolls back every write when transactional work fails', async ({ assert }) => {
    await assert.rejects(
      () =>
        db.transaction(async (trx) => {
          await trx.table('companies').insert({
            id: 'rollback-company',
            name: 'Rollback Company',
            color: '#2d75da',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          });
          throw new Error('force rollback');
        }),
      /force rollback/
    );
    const row = await db.from('companies').where('id', 'rollback-company').first();
    assert.isNull(row);
  });
});
