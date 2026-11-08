import { defineConfig } from '@kevinjohn/adonisjs-action-proofs';
import { activeCompanyRole } from '#services/auth/authorization';
import { requireConfirmedAdmission } from '#services/auth/current_actor';

export default defineConfig({
  authorize: async ({ account, trx }, { scope }) => {
    await requireConfirmedAdmission(account, trx);
    return (await activeCompanyRole(String(account.id), scope, trx)) === 'owner';
  },
});
