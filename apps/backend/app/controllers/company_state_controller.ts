import { exportQueryValidator } from '#validators/export_query';
import type { HttpContext } from '@adonisjs/core/http';
import { readStateWithClient } from '#services/state_repository';
import { transformState } from '#transformers/state_transformer';
import { getActiveCompanyRole } from '#services/auth/authorization';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';
import { resolveEffectiveReadUser } from '#services/auth/masquerade';
import { withActor } from '#services/auth/current_actor';
import access from '#config/access_control';

/** The company's state as the effective member may read it. */
export default class CompanyStateController {
  async show({ auth, request, serialize }: HttpContext) {
    const { companyId, includeInactive } = await exportQueryValidator.validate(request.qs());
    return serialize(
      await withActor(auth, async (_actor, trx) => {
        // Under view-as this also refuses unless the actor may view the named company as its member.
        const user = await resolveEffectiveReadUser(trx, companyId);
        const role = await getActiveCompanyRole(user.effectiveId, companyId, trx);
        if (!role) throw new IdentityAuthorizationException('Forbidden.');
        if (includeInactive === '1' && !access.can(role, 'members:manage')) {
          throw new IdentityAuthorizationException('Forbidden.');
        }
        const state = await readStateWithClient(trx, companyId, includeInactive === '1');
        return transformState(state, companyId, role);
      })
    );
  }
}
