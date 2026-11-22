import type { HttpContext } from '@adonisjs/core/http';
import { readStateWithClient } from '#services/state_repository';
import { transformState } from '#transformers/state_transformer';
import { withActor } from '#services/auth/current_actor';
import access from '#config/access_control';
import { resolvePlanningAccess } from '#services/planning/access';
import {
  buildCompanyExport,
  serializeCompanyExport,
} from '@capacitylens/shared/data/companyExport';

/** The company's export document. */
export default class CompanyExportsController {
  /**
   * Serves the company's export document as a download. The server reads the rows, projects them
   * for the effective member's role, includes inactive rows only for `members:manage`, and labels
   * the document `full` only for a reader who may see private names.
   */
  async show(ctx: HttpContext) {
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
    return ctx.response.send(await ctx.serialize.withoutWrapping(text));
  }
}
