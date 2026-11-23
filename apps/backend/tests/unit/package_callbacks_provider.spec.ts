import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import { nativeAdapter } from '#services/auth/masquerade_authority';

test.group('package callbacks provider', () => {
  test('the packages resolve with the callbacks the provider registers', async ({ assert }) => {
    assert.exists(await app.container.make('account_kit'));
    assert.exists(await app.container.make('account_admission'));
    assert.strictEqual(await app.container.make('masquerade.native'), nativeAdapter);
    assert.exists(await app.container.make('password_confirmations'));
  });
});
