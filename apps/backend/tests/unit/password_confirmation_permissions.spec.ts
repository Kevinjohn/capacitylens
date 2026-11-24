import { test } from '@japa/runner';
import app from '@adonisjs/core/services/app';
import {
  PasswordConfirmationService,
  PASSWORD_CONFIRMATION_KINDS,
} from '#services/auth/password_confirmation_service';

test.group('password confirmation permissions', () => {
  test('only an Owner may confirm each company action', async ({ assert }) => {
    const passwordConfirmations = await app.container.make(PasswordConfirmationService);
    for (const kind of PASSWORD_CONFIRMATION_KINDS) {
      assert.isTrue(passwordConfirmations.canConfirmPassword('owner', kind), kind);
      for (const role of ['admin', 'editor', 'viewer'] as const) {
        assert.isFalse(passwordConfirmations.canConfirmPassword(role, kind), `${role} ${kind}`);
      }
      assert.isFalse(passwordConfirmations.canConfirmPassword(null, kind), kind);
    }
  });

  test('an action with no permission key is refused, even for an Owner', async ({ assert }) => {
    const passwordConfirmations = await app.container.make(PasswordConfirmationService);
    for (const action of ['export', '', '__proto__', 'constructor', 'toString']) {
      assert.isFalse(passwordConfirmations.canConfirmPassword('owner', action), action);
    }
  });
});
