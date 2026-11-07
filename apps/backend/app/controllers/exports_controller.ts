import { exportQueryValidator } from '#validators/export_query';
import type { HttpContext } from '@adonisjs/core/http';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { readStateWithClient } from '#services/state_repository';
import { transformState } from '#transformers/state_transformer';
import access from '#config/access_control';
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { activeMembershipsByCompany } from '#services/membership/package_projection';
import { effectiveReadPrincipal } from '#services/auth/masquerade';
import { withActor } from '#services/auth/current_actor';
import { APP_DATA_KEYS, emptyAppData, type AppData } from '@capacitylens/shared/types/entities';
import { canReadInactiveExport } from '@capacitylens/shared/domain/access';

/** Every active membership's company; each one is re-authorized before it is read. */
async function activeCompanyIds(userId: string, trx: TransactionClientContract) {
  const memberships = await activeMembershipsByCompany(userId, trx, new Set());
  return [...memberships.keys()];
}

export default class ExportsController {
  async show(ctx: HttpContext) {
    const { request, response } = ctx;
    const { accountId, includeInactive } = await exportQueryValidator.validate(request.qs());
    return withActor(ctx, async (_actor, trx) => {
      const principal = await effectiveReadPrincipal(ctx, trx, accountId);
      if (principal.accountId && accountId && principal.accountId !== accountId) {
        throw new IdentityAuthorityError('Forbidden.');
      }
      const companyIds = accountId
        ? [accountId]
        : await activeCompanyIds(principal.effectiveId, trx);
      const combined = emptyAppData();
      for (const id of companyIds) {
        if (principal.accountId && principal.accountId !== id) continue;
        if (principal.isMasquerading) {
          const actorRole = await activeCompanyRole(principal.actorId, id, trx);
          if (!actorRole || !access.can(actorRole, 'viewAs:use')) continue;
        }
        const role = await activeCompanyRole(principal.effectiveId, id, trx);
        if (!role) {
          if (accountId) throw new IdentityAuthorityError('Forbidden.');
          continue;
        }
        const mayReadInactive = canReadInactiveExport(role);
        if (includeInactive === '1' && !mayReadInactive) {
          throw new IdentityAuthorityError('Forbidden.');
        }
        const state = await readStateWithClient(
          trx,
          id,
          mayReadInactive && (accountId === undefined || includeInactive === '1')
        );
        const slice = transformState(state, id, role);
        for (const key of APP_DATA_KEYS) combined[key].push(...(slice[key] as never[]));
      }
      return response.ok(combined as AppData);
    });
  }
}
