import type { HttpContext } from '@adonisjs/core/http';
import db from '@adonisjs/lucid/services/db';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { defineConfig } from '@kevinjohn/adonisjs-masquerade';
import { accountKitAuthority } from '@kevinjohn/adonisjs-masquerade/account-kit';
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid';
import { accountInput } from '#services/auth/current_actor';
import { sessionUsers } from '#config/auth';
import { listActiveCompanyIds, activeCompanyRole } from '#services/auth/authorization';
import access from '#config/access_control';
import type User from '#models/user';

type MasqueradeUser = User;

/** The package checks Account Kit credentials and current memberships on every admission. */
export const nativeAdapter = accountKitAuthority<MasqueradeUser>({
  namespace: 'capacitylens',
  incarnation: 'id',
  provider: sessionUsers,
  kit: () => accountKit,
  managedGuard: {
    name: 'web',
    strategy: 'session',
    current: accountInput,
  },
});

function requestedAccountId(request?: HttpContext): string | null {
  if (!request) return null;
  const value = request.params.accountId;
  return typeof value === 'string' && value ? value : null;
}

export default defineConfig<MasqueradeUser, HttpContext>({
  authority: nativeAdapter.authority,
  policy: {
    async canMasquerade({ actor, target, request }) {
      const accountId = requestedAccountId(request);
      if (accountId) {
        const actorRole = await activeCompanyRole(actor.id, accountId, undefined);
        const targetRole = await activeCompanyRole(target.id, accountId, undefined);
        return Boolean(
          actorRole && access.can(actorRole, 'viewAs:use') && targetRole && actor.id !== target.id
        );
      }
      const roles = await listActiveCompanyIds(actor.id, undefined);
      for (const memberAccountId of roles) {
        const role = await activeCompanyRole(actor.id, memberAccountId, undefined);
        const targetRole = await activeCompanyRole(target.id, memberAccountId, undefined);
        if (role && access.can(role, 'viewAs:use') && targetRole) return actor.id !== target.id;
      }
      return false;
    },
    async canUseRequest({ actor, target, request }) {
      const accountId = requestedAccountId(request);
      if (accountId) {
        const actorRole = await activeCompanyRole(actor.id, accountId, undefined);
        const targetRole = await activeCompanyRole(target.id, accountId, undefined);
        return Boolean(actorRole && access.can(actorRole, 'viewAs:use') && targetRole);
      }
      const memberships = await listActiveCompanyIds(actor.id, undefined);
      for (const memberAccountId of memberships) {
        const actorRole = await activeCompanyRole(actor.id, memberAccountId, undefined);
        const targetRole = await activeCompanyRole(target.id, memberAccountId, undefined);
        if (actorRole && access.can(actorRole, 'viewAs:use') && targetRole) return true;
      }
      return false;
    },
  },
  store: async () => new LucidControlStore(db.connection()),
  durationSeconds: 900,
  maxDurationSeconds: 900,
  contextEnforcement: 'enforce',
  retention: { days: 365 },
});
