import { test } from '@japa/runner';
import { publicOrigin } from '#config/public_origin';
import { resolveCorsOrigins, isTrustedUnsafeOrigin } from '#services/cors_policy';

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
  assert.isTrue(isTrustedUnsafeOrigin({ origin: publicOrigin.origin }));
  assert.isFalse(isTrustedUnsafeOrigin({ origin: 'https://evil.example' }));
});

// An unmatched route answers 404 once the origin guard admits the write, and 403 when it refuses.
test.group('unsafe-request origin guard', () => {
  test('{name}')
    .with<{ name: string; headers: Record<string, string>; status: number }[]>([
      { name: 'admits the public origin', headers: { origin: publicOrigin.origin }, status: 404 },
      {
        name: 'admits an explicit CORS origin',
        headers: { origin: 'http://localhost:5173' },
        status: 404,
      },
      {
        name: 'admits a same-origin fetch without Origin',
        headers: { 'sec-fetch-site': 'same-origin' },
        status: 404,
      },
      { name: 'refuses a write with neither Origin nor Sec-Fetch-Site', headers: {}, status: 403 },
      {
        name: 'refuses a mismatched Origin despite Sec-Fetch-Site same-origin',
        headers: { 'origin': 'http://evil.example', 'sec-fetch-site': 'same-origin' },
        status: 403,
      },
      {
        name: 'refuses a hostile Origin matched by a spoofed Host',
        headers: { origin: 'http://evil.example', host: 'evil.example' },
        status: 403,
      },
      {
        name: 'refuses an https Origin for the http public host',
        headers: { origin: publicOrigin.origin.replace(/^http:/, 'https:') },
        status: 403,
      },
    ])
    .run(async ({ client, assert }, { headers, status }) => {
      const response = await client.post('/api/no-such-route').headers(headers);
      response.assertStatus(status);
      if (status === 403)
        assert.deepEqual(response.body(), { error: 'Cross-site request rejected.' });
    });
});
