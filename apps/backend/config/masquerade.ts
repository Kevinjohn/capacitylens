import type { HttpContext } from '@adonisjs/core/http';
import app from '@adonisjs/core/services/app';
import accountKit from '@kevinjohn/adonisjs-account-kit/services/main';
import { defineConfig } from '@kevinjohn/adonisjs-masquerade';
import { accountKitAuthority } from '@kevinjohn/adonisjs-masquerade/account-kit';
import { LucidControlStore } from '@kevinjohn/adonisjs-masquerade/stores/lucid';
import { managedGuard } from '#services/auth/managed_guard';
import { sessionUsers } from '#config/auth';
import { listActiveCompanyIds, getActiveCompanyRole } from '#services/auth/authorization';
import { canMasqueradeAs } from '@capacitylens/shared/domain/access';
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

function requestedCompanyId(request?: HttpContext): string | null {
  if (!request) return null;
  const value = request.params.companyId;
  return typeof value === 'string' && value ? value : null;
}

/**
 * Whether the actor may view the target in the request's company, or in any company the actor
 * belongs to when the request names none: the actor holds `viewAs:use` there and the target is an
 * active member who does not rank above the actor.
 */
async function sharesMasqueradeCompany(actorId: string, targetId: string, request?: HttpContext) {
  const requested = requestedCompanyId(request);
  const companies = requested ? [requested] : await listActiveCompanyIds(actorId, undefined);
  for (const companyId of companies) {
    const actorRole = await getActiveCompanyRole(actorId, companyId, undefined);
    const targetRole = await getActiveCompanyRole(targetId, companyId, undefined);
    if (actorRole && targetRole && canMasqueradeAs(actorRole, targetRole)) return true;
  }
  return false;
}

export default defineConfig<MasqueradeUser, HttpContext>({
  authority: nativeAdapter.authority,
  policy: {
    async canMasquerade({ actor, target, request }) {
      return (
        actor.id !== target.id && (await sharesMasqueradeCompany(actor.id, target.id, request))
      );
    },
    canUseRequest: ({ actor, target, request }) =>
      sharesMasqueradeCompany(actor.id, target.id, request),
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
