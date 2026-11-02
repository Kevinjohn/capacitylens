import { test } from '@japa/runner';
import { resolvePublicOrigin } from '#config/public_origin';

test('public origin shares HTTPS and loopback transport decisions', ({ assert }) => {
  for (const environment of ['production', 'development', 'test'] as const)
    assert.deepEqual(resolvePublicOrigin('https://capacity.example.test', environment, 'APP_URL'), {
      origin: 'https://capacity.example.test',
      secure: true,
    });
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const origin = `http://${host}:8787`;
    for (const environment of ['development', 'test'] as const)
      assert.deepEqual(resolvePublicOrigin(origin, environment, 'APP_URL'), {
        origin,
        secure: false,
      });
    assert.throws(
      () => resolvePublicOrigin(origin, 'production', 'APP_URL'),
      /^APP_URL: public production origins require HTTPS$/
    );
  }
});

test('public origin rejects non-origin and insecure remote values', ({ assert }) => {
  for (const value of [
    '',
    'garbage',
    'ftp://localhost',
    'https://capacity.example.test/',
    'https://user:password@capacity.example.test',
    'https://capacity.example.test/path',
    'https://capacity.example.test?query',
    'https://capacity.example.test#fragment',
    'http://capacity.example.test',
    'http://127.0.0.2',
  ])
    assert.throws(
      () => resolvePublicOrigin(value, 'test', 'CAPACITYLENS_PUBLIC_URL'),
      /^CAPACITYLENS_PUBLIC_URL must /
    );
});
