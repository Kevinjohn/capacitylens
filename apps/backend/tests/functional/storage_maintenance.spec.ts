import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { freshDatabase } from '../helpers/fresh_database.js';
import { resetState } from '#tests/helpers/state_fixture';
import { REQUEST_RECEIPT_RETENTION_MS, pruneRequestReceipts } from '#services/storage_maintenance';

test.group('storage maintenance', (group) => {
  group.setup(() => freshDatabase());
  group.each.setup(() => resetState('single'));

  test('one pass deletes completed receipts past the window and keeps pending and recent ones', async ({
    assert,
  }) => {
    const now = new Date('2026-11-13T12:00:00.000Z');
    const past = new Date(now.getTime() - REQUEST_RECEIPT_RETENTION_MS - 1).toISOString();
    const atWindow = new Date(now.getTime() - REQUEST_RECEIPT_RETENTION_MS).toISOString();
    const account = await db.from('accounts').select('id').firstOrFail();
    const accountId = account.id as string;
    const receipt = (id: string, state: 'pending' | 'completed', updatedAt: string) => ({
      id,
      scope_id: accountId,
      command_id: id,
      operation: JSON.stringify(['change-member-role', 'u-bruce']),
      request_key: id,
      payload_hash: 'a'.repeat(64),
      state,
      result: state === 'completed' ? '{}' : null,
      created_at: updatedAt,
      updated_at: updatedAt,
    });
    await db
      .table('request_receipts')
      .multiInsert([
        receipt('completed-past-window', 'completed', past),
        receipt('pending-past-window', 'pending', past),
        receipt('completed-at-window', 'completed', atWindow),
      ]);

    assert.equal(await pruneRequestReceipts(now), 1);

    const kept = await db.from('request_receipts').orderBy('id').select('id');
    assert.deepEqual(
      kept.map((row) => row.id),
      ['completed-at-window', 'pending-past-window']
    );
  });
});
