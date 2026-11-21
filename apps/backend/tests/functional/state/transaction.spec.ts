import { test } from '@japa/runner';
import { freshDatabase } from '../../helpers/fresh_database.js';
import db from '@adonisjs/lucid/services/db';

test.group('transaction helper', (group) => {
  group.setup(() => freshDatabase());

  test('rolls back every write when transactional work fails', async ({ assert }) => {
    await assert.rejects(
      () =>
        db.transaction(async (trx) => {
          await trx.table('accounts').insert({
            id: 'rollback-account',
            name: 'Rollback Account',
            color: '#2d75da',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
          });
          throw new Error('force rollback');
        }),
      /force rollback/
    );
    const row = await db.from('accounts').where('id', 'rollback-account').first();
    assert.isNull(row);
  });
});
