import { test } from '@japa/runner';
import env from '#start/env';
import limiter from '@adonisjs/limiter/services/main';
import { freshDatabase } from '#tests/helpers/fresh_database';

const policy =
  "default-src 'self';script-src 'self';style-src 'self';style-src-attr 'unsafe-inline';img-src 'self' data:;font-src 'self';connect-src 'self';frame-ancestors 'none';object-src 'none';base-uri 'none';form-action 'self'";

const originalRateLimit = env.get('CAPACITYLENS_RATE_LIMIT');

test.group('Shield content security policy', (group) => {
  group.setup(() => freshDatabase());
  group.each.teardown(async () => {
    env.set('CAPACITYLENS_RATE_LIMIT', originalRateLimit ?? '');
    if (originalRateLimit === undefined) delete process.env.CAPACITYLENS_RATE_LIMIT;
    await limiter.clear();
  });

  test('a routed response carries the policy once', async ({ client, assert }) => {
    const response = await client.visit('health_checks.live');
    assert.equal(response.status(), 200);
    assert.equal(response.header('content-security-policy'), policy);
  });

  test('a cross-site refusal carries the policy', async ({ client, assert }) => {
    const response = await client
      .visit('api.session.store')
      .header('origin', 'https://attacker.example')
      .header('sec-fetch-site', 'cross-site')
      .json({ email: 'bruce.wayne@wayne.example', password: 'not-checked' });
    assert.equal(response.status(), 403);
    assert.deepEqual(response.body(), { error: 'Cross-site request rejected.' });
    assert.equal(response.header('content-security-policy'), policy);
  });

  test('a rate-limited response carries the policy', async ({ client, assert }) => {
    env.set('CAPACITYLENS_RATE_LIMIT', '1');
    await limiter.clear();
    await client.visit('api.session.show');
    const response = await client.visit('api.session.show');
    assert.equal(response.status(), 429);
    assert.deepEqual(response.body(), { error: 'Rate limit exceeded.' });
    assert.equal(response.header('content-security-policy'), policy);
  });
});
