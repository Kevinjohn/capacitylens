import { exportQueryValidator } from '#validators/export_query';
import type { HttpContext } from '@adonisjs/core/http';
import { readStateWithClient } from '#services/state_repository';
import { transformState } from '#transformers/state_transformer';
import { activeCompanyRole, IdentityAuthorityError } from '#services/auth/authorization';
import { effectiveReadPrincipal } from '#services/auth/masquerade';
import { withActor } from '#services/auth/current_actor';
import access from '#config/access_control';
import { resolvePlanningAuthority } from '#services/planning/authority';
import { sendRefusal } from '#services/planning/http_refusal';
import {
  CompanyDocumentError,
  buildCompanyExport,
  serializeCompanyExport,
} from '@capacitylens/shared/data/companyDocument';

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

  /**
   * Serves the company's export document as a download. The server reads the rows, projects them
   * for the effective member's role, includes inactive rows only for `members:manage`, and labels
   * the document `full` only for a reader who may see private names.
   */
  async download(ctx: HttpContext) {
    try {
      const accountId = String(ctx.params.accountId);
      const text = await withActor(ctx, async (_actor, trx) => {
        const { authority } = await resolvePlanningAuthority(trx, accountId);
        const rows = await readStateWithClient(
          trx,
          accountId,
          access.can(authority.role, 'members:manage')
        );
        return serializeCompanyExport(
          buildCompanyExport(transformState(rows, accountId, authority.role), {
            accountId,
            completeness: authority.canSeePrivateNames ? 'full' : 'redacted',
          })
        );
      });
      ctx.response.header('Content-Type', 'application/json; charset=utf-8');
      ctx.response.header('Content-Disposition', 'attachment; filename="capacitylens-data.json"');
      return ctx.response.send(text);
    } catch (error) {
      // A document that fails validation is refused as the import path refuses one.
      if (error instanceof CompanyDocumentError) {
        return ctx.response.badRequest({ error: error.message });
      }
      return sendRefusal(error, ctx);
    }
  }
}
