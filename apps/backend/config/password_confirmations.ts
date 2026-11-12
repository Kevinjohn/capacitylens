import { defineConfig } from '@kevinjohn/adonisjs-confirm-action-with-password';
import { activeCompanyRole } from '#services/auth/authorization';
import { requireConfirmedAdmission } from '#services/auth/current_actor';
import { PASSWORD_CONFIRMATION_PERMISSIONS } from '#services/auth/password_confirmation';
import access from '#config/access_control';

export default defineConfig({
  authorize: async ({ account, trx }, { action, scope }) => {
    // Deleting one's own account needs no company authority, as the deletion route needs none.
    if (action === 'delete-account') return scope === String(account.id);
    await requireConfirmedAdmission(account, trx);
    if (!Object.hasOwn(PASSWORD_CONFIRMATION_PERMISSIONS, action)) return false;
    const role = await activeCompanyRole(String(account.id), scope, trx);
    const key =
      PASSWORD_CONFIRMATION_PERMISSIONS[action as keyof typeof PASSWORD_CONFIRMATION_PERMISSIONS];
    return role !== null && access.can(role, key);
  },
});
