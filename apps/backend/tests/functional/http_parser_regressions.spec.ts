import { test } from '@japa/runner';
import { resetCookieDataOwner } from '#tests/helpers/data/data_owner';
import { freshDatabase } from '#tests/helpers/fresh_database';
import { postRaw } from '#tests/helpers/data/raw_http';

test.group('HTTP parser regressions', (group) => {
  group.setup(() => freshDatabase());

  test('removes the CSP report endpoint', async ({ client, assert }) => {
    const response = await client
      .post('/api/v1/security/csp-report')
      .header('sec-fetch-site', 'same-origin')
      .json({ report: 'ignored' })
      .send();
    assert.equal(response.status(), 404);
    assert.deepEqual(response.body(), { error: 'Not found.', code: 'E_NOT_FOUND' });
  });

  test('maps actual oversized form and unsupported encoding parser failures safely', async ({
    client,
    assert,
  }) => {
    const fixture = await resetCookieDataOwner(client, true);
    client = fixture.client;
    const cookie = fixture.cookie;
    const context = await client.visit('api.masquerade.show').send();
    context.assertStatus(200);
    const masqueradeToken = (context.body()!.data as unknown as { masqueradeToken?: unknown })
      .masqueradeToken;
    assert.isString(masqueradeToken);
    const oversized = await postRaw(
      '/api/v1/companies/a-studio/example-data',
      Buffer.from(`value=${'x'.repeat(1_100_000)}`),
      'application/x-www-form-urlencoded',
      { 'x-masquerade-context': masqueradeToken as string },
      cookie
    );
    assert.equal(oversized.statusCode, 413);
    assert.deepEqual(JSON.parse(oversized.body), {
      error: 'Request body is too large.',
      code: 'E_PAYLOAD_TOO_LARGE',
    });

    const unsupported = await postRaw(
      '/api/v1/companies/a-studio/example-data',
      Buffer.from('value=x'),
      'application/x-www-form-urlencoded',
      { 'content-encoding': 'compress', 'x-masquerade-context': masqueradeToken as string },
      cookie
    );
    assert.equal(unsupported.statusCode, 415);
    assert.deepEqual(JSON.parse(unsupported.body), {
      error: 'Unsupported media type.',
      code: 'E_UNSUPPORTED_MEDIA_TYPE',
    });
  });
});
