import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import Migration from '#database/migrations/202611240001_store_deletion_markers_in_lucid_format';
import { freshDatabase } from '#tests/helpers/fresh_database';

const now = '2026-11-24T09:00:00.000Z';

test.group('deletion marker migration', (group) => {
  group.setup(() => freshDatabase());

  test('rewrites ISO markers in Lucid format and leaves other rows alone', async ({ assert }) => {
    const trx = await db.transaction();
    try {
      await trx.table('companies').insert({
        id: 'a-daily-planet',
        name: 'Daily Planet',
        color: '#123456',
        created_at: now,
        updated_at: now,
      });
      const closure = (id: string, deletedAt: string | null) => ({
        id,
        company_id: 'a-daily-planet',
        name: `Closure ${id}`,
        start_date: '2026-12-01',
        end_date: '2026-12-01',
        created_at: now,
        updated_at: now,
        deleted_at: deletedAt,
      });
      await trx
        .table('closures')
        .multiInsert([
          closure('cl-iso', '2026-11-24T10:11:12.013Z'),
          closure('cl-lucid', '2026-11-20 08:09:10'),
          closure('cl-live', null),
        ]);

      await new Migration(trx, 'deletion_marker_migration', false).execUp();

      const stored = await trx.from('closures').select('id', 'deleted_at').orderBy('id');
      assert.deepEqual(stored, [
        { id: 'cl-iso', deleted_at: '2026-11-24 10:11:12' },
        { id: 'cl-live', deleted_at: null },
        { id: 'cl-lucid', deleted_at: '2026-11-20 08:09:10' },
      ]);
    } finally {
      await trx.rollback();
    }
  });
});
