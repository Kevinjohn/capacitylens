import { defineConfig } from '@kevinjohn/adonisjs-confirm-action-with-password';
import { activeCompanyRole } from '#services/auth/authorization';
import { requireConfirmedAdmission } from '#services/auth/current_actor';
import { mayConfirmPassword } from '#services/auth/password_confirmation';

export default defineConfig({
  authorize: async ({ account, trx }, { action, scope }) => {
    // Deleting one's own account needs no company authority, as the deletion route needs none.
    if (action === 'delete-account') return scope === String(account.id);
    await requireConfirmedAdmission(account, trx);
    return mayConfirmPassword(await activeCompanyRole(String(account.id), scope, trx), action);
  },
});
