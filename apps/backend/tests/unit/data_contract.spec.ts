import { test } from '@japa/runner';
import { seed } from '@capacitylens/shared/data/seed';
import { encodeRow } from '#services/state_repository';
import { readState } from '#tests/helpers/state_fixture';
import db from '@adonisjs/lucid/services/db';
import { transactionalDatabase } from '#tests/helpers/transactional_database';

test.group('data contract', (group) => {
  transactionalDatabase(group);
  test('returns explicit null from a persisted optional column', async ({ assert }) => {
    const data = seed();
    const account = data.accounts[0]!;
    await db
      .table('companies')
      .insert(encodeRow('companies', account as unknown as Record<string, unknown>));
    const state = await readState(account.id, true);
    assert.property(state.accounts[0], 'timezone');
    assert.isNull(state.accounts[0]?.timezone);
  });
  test('encodes explicit null for a cleared optional field', ({ assert }) => {
    const data = seed();
    const resource = data.resources[0]!;
    const encoded = encodeRow('resources', { ...resource, avatarUrl: null });
    assert.property(encoded, 'avatar_url');
    assert.isNull(encoded.avatar_url);
  });
});
