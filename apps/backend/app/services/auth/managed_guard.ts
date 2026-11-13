import { createManagedGuard } from '@kevinjohn/adonisjs-account-kit/http';

/**
 * Account Kit's adapter for the `web` session guard. Sign-in, sign-out, the account gate and the
 * view-as authority all read and write the session through this one guard.
 */
export const managedGuard = createManagedGuard({
  strategy: 'session',
  name: 'web',
  loadUser: async () => {
    const model = await import('#models/user');
    return model.default;
  },
});
