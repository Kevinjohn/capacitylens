import { defineConfig } from '@kevinjohn/adonisjs-confirm-action-with-password';
import { getActiveCompanyRole } from '#services/auth/authorization';
import { requireConfirmedAdmission } from '#services/auth/current_actor';
import { canConfirmPassword } from '#services/auth/password_confirmation';

export default defineConfig({
  authorize: async ({ account, trx }, { action, scope }) => {
    // Deleting one's own account needs no company permission, as the deletion route needs none.
    if (action === 'delete-account') return scope === String(account.id);
    await requireConfirmedAdmission(account, trx);
    return canConfirmPassword(await getActiveCompanyRole(String(account.id), scope, trx), action);
  },
});
