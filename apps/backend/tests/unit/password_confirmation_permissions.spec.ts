import { test } from '@japa/runner';
import {
  canConfirmPassword,
  PASSWORD_CONFIRMATION_KINDS,
} from '#services/auth/password_confirmation';

test.group('password confirmation permissions', () => {
  test('only an Owner may confirm each company action', ({ assert }) => {
    for (const kind of PASSWORD_CONFIRMATION_KINDS) {
      assert.isTrue(canConfirmPassword('owner', kind), kind);
      for (const role of ['admin', 'editor', 'viewer'] as const) {
        assert.isFalse(canConfirmPassword(role, kind), `${role} ${kind}`);
      }
      assert.isFalse(canConfirmPassword(null, kind), kind);
    }
  });

  test('an action with no permission key is refused, even for an Owner', ({ assert }) => {
    for (const action of ['export', '', '__proto__', 'constructor', 'toString']) {
      assert.isFalse(canConfirmPassword('owner', action), action);
    }
  });
});
