import { test } from '@japa/runner';
import { publicOrigin } from '#config/public_origin';
import { freshDatabase } from '../../helpers/fresh_database.js';
import { resolveCorsOrigins, withDevelopmentWebOrigins } from '#services/cors_policy';

test('CORS uses finite development origins and no production cross-origin defaults', ({
  assert,
}) => {
  assert.lengthOf(resolveCorsOrigins(undefined, 'development'), 4);
  assert.deepEqual(resolveCorsOrigins(undefined, 'production'), []);
  assert.deepEqual(resolveCorsOrigins('https://wayne.example', 'production'), [
    'https://wayne.example',
  ]);
  for (const invalid of ['*', 'https://wayne.example/path', 'https://user@wayne.example'])
    assert.throws(() => resolveCorsOrigins(invalid, 'production'));
});

test('only a development server appends the dev launcher web origins', ({ assert }) => {
  const configured = ['https://wayne.example'];
  const lane = 'http://localhost:5176,http://127.0.0.1:5176';
  assert.deepEqual(withDevelopmentWebOrigins(configured, lane, 'development'), [
    'https://wayne.example',
    'http://localhost:5176',
    'http://127.0.0.1:5176',
  ]);
  for (const environment of ['production', 'test'])
    assert.deepEqual(withDevelopmentWebOrigins(configured, lane, environment), configured);
  assert.deepEqual(withDevelopmentWebOrigins(configured, undefined, 'development'), configured);
});

// An unmatched route answers 404 once the origin guard admits the write, and 403 when it refuses.
test.group('unsafe-request origin guard', (group) => {
  group.setup(() => freshDatabase());
  test('is registered: admits the public origin and refuses a hostile one', async ({
    client,
    assert,
  }) => {
    const admitted = await client
      .post('/api/no-such-route')
      .headers({ origin: publicOrigin.origin });
    admitted.assertStatus(404);
    const refused = await client
      .post('/api/no-such-route')
      .headers({ origin: 'http://evil.example' });
    refused.assertStatus(403);
    assert.deepEqual(refused.body(), { error: 'Cross-site request rejected.' });
    assert.equal(refused.header('cache-control'), 'no-store');
  });
});
