import { exportQueryValidator } from '#validators/export_query';
import type { HttpContext } from '@adonisjs/core/http';
import { readStateWithClient } from '#services/state_repository';
import { transformState } from '#transformers/state_transformer';
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { effectiveReadPrincipal } from '#services/auth/masquerade';
import { withActor } from '#services/auth/current_actor';
import access from '#config/access_control';

export default class ExportsController {
  async show(ctx: HttpContext) {
    const { request, response } = ctx;
    const { accountId, includeInactive } = await exportQueryValidator.validate(request.qs());
    return withActor(ctx, async (_actor, trx) => {
      // Under view-as this also refuses unless the actor may view the named company as its member.
      const principal = await effectiveReadPrincipal(trx, accountId);
      const role = await activeCompanyRole(principal.effectiveId, accountId, trx);
      if (!role) throw new IdentityAuthorityError('Forbidden.');
      if (includeInactive === '1' && !access.can(role, 'members:manage')) {
        throw new IdentityAuthorityError('Forbidden.');
      }
      const state = await readStateWithClient(trx, accountId, includeInactive === '1');
      return response.ok(transformState(state, accountId, role));
    });
  }
}
