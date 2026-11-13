import { test } from '@japa/runner';
import db from '@adonisjs/lucid/services/db';
import { freshDatabase } from '../helpers/fresh_database.js';
import { resetState } from '#tests/helpers/state_fixture';
import {
  REQUEST_RECEIPT_RETENTION_MS,
  createMaintenance,
  pruneRequestReceipts,
} from '#services/storage_maintenance';

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

test.group('maintenance passes', () => {
  test('a failing task is reported and the next one still runs', async ({ assert }) => {
    const ran: string[] = [];
    const reported: [string, unknown][] = [];
    const failure = new Error('prune refused');
    const maintenance = createMaintenance(
      [
        ['first', () => Promise.reject(failure)],
        ['second', async () => void ran.push('second')],
      ],
      (task, error) => reported.push([task, error])
    );
    await maintenance.run();
    assert.deepEqual(ran, ['second']);
    assert.deepEqual(reported, [['first', failure]]);
  });

  test('stopping waits for the task in flight and starts no further task', async ({ assert }) => {
    const ran: string[] = [];
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const maintenance = createMaintenance(
      [
        [
          'first',
          async () => {
            ran.push('first started');
            await held;
            ran.push('first ended');
          },
        ],
        ['second', async () => void ran.push('second')],
      ],
      () => assert.fail('No task fails')
    );
    void maintenance.run();
    await Promise.resolve();
    let stopped = false;
    const stopping = maintenance.stop().then(() => (stopped = true));
    await new Promise((resolve) => setImmediate(resolve));
    assert.isFalse(stopped);
    release();
    await stopping;
    assert.deepEqual(ran, ['first started', 'first ended']);
    await maintenance.run();
    assert.deepEqual(ran, ['first started', 'first ended']);
  });
});
