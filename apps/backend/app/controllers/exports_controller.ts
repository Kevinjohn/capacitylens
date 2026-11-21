import { exportQueryValidator } from '#validators/export_query';
import type { HttpContext } from '@adonisjs/core/http';
import { readStateWithClient } from '#services/state_repository';
import { transformState } from '#transformers/state_transformer';
import { getActiveCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { resolveEffectiveReadUser } from '#services/auth/masquerade';
import { withActor } from '#services/auth/current_actor';
import access from '#config/access_control';
import { resolvePlanningAccess } from '#services/planning/access';
import {
  buildCompanyExport,
  serializeCompanyExport,
} from '@capacitylens/shared/data/companyDocument';

export default class ExportsController {
  async show(ctx: HttpContext) {
    const { request, response } = ctx;
    const { companyId, includeInactive } = await exportQueryValidator.validate(request.qs());
    return withActor(ctx, async (_actor, trx) => {
      // Under view-as this also refuses unless the actor may view the named company as its member.
      const user = await resolveEffectiveReadUser(trx, companyId);
      const role = await getActiveCompanyRole(user.effectiveId, companyId, trx);
      if (!role) throw new IdentityAuthorityError('Forbidden.');
      if (includeInactive === '1' && !access.can(role, 'members:manage')) {
        throw new IdentityAuthorityError('Forbidden.');
      }
      const state = await readStateWithClient(trx, companyId, includeInactive === '1');
      return response.ok(transformState(state, companyId, role));
    });
  }

  /**
   * Serves the company's export document as a download. The server reads the rows, projects them
   * for the effective member's role, includes inactive rows only for `members:manage`, and labels
   * the document `full` only for a reader who may see private names.
   */
  async download(ctx: HttpContext) {
    const companyId = String(ctx.params.companyId);
    const text = await withActor(ctx, async (_actor, trx) => {
      const { planningAccess } = await resolvePlanningAccess(trx, companyId);
      const rows = await readStateWithClient(
        trx,
        companyId,
        access.can(planningAccess.role, 'members:manage')
      );
      return serializeCompanyExport(
        buildCompanyExport(transformState(rows, companyId, planningAccess.role), {
          companyId,
          completeness: planningAccess.canSeePrivateNames ? 'full' : 'redacted',
        })
      );
    });
    ctx.response.header('Content-Type', 'application/json; charset=utf-8');
    ctx.response.header('Content-Disposition', 'attachment; filename="capacitylens-data.json"');
    return ctx.response.send(text);
  }
}
