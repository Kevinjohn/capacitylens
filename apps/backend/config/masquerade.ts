import type { HttpContext } from '@adonisjs/core/http';
import app from '@adonisjs/core/services/app';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { defineConfig } from '@kevinjohn/adonisjs-masquerade';
import { accountKitAuthority } from '@kevinjohn/adonisjs-masquerade/account-kit';
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid';
import { managedGuard } from '#services/auth/managed_guard';
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
  managedGuard,
});

function requestedAccountId(request?: HttpContext): string | null {
  if (!request) return null;
  const value = request.params.accountId;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Whether the actor may view the target in the request's company, or in any company the actor
 * belongs to when the request names none: the actor holds `viewAs:use` there and the target is an
 * active member.
 */
async function sharesViewAsCompany(actorId: string, targetId: string, request?: HttpContext) {
  const accountId = requestedAccountId(request);
  const companies = accountId ? [accountId] : await listActiveCompanyIds(actorId, undefined);
  for (const companyId of companies) {
    const actorRole = await activeCompanyRole(actorId, companyId, undefined);
    const targetRole = await activeCompanyRole(targetId, companyId, undefined);
    if (actorRole && access.can(actorRole, 'viewAs:use') && targetRole) return true;
  }
  return false;
}

export default defineConfig<MasqueradeUser, HttpContext>({
  authority: nativeAdapter.authority,
  policy: {
    async canMasquerade({ actor, target, request }) {
      return actor.id !== target.id && (await sharesViewAsCompany(actor.id, target.id, request));
    },
    canUseRequest: ({ actor, target, request }) =>
      sharesViewAsCompany(actor.id, target.id, request),
  },
  // The package opens the store while providers boot, before the `db` service import resolves.
  store: async () => {
    const database = await app.container.make('lucid.db');
    return new LucidControlStore(database.connection());
  },
  durationSeconds: 900,
  maxDurationSeconds: 900,
  contextEnforcement: 'enforce',
  retention: { days: 365 },
});
