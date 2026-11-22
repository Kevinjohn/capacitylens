import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { anonymiseResources } from '#services/anonymise';
import { anonymiseResourceValidator } from '#validators/anonymise';
import { assertCompanyPermission } from '#services/auth/authorization';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';

/** Anonymises one person. */
export default class ResourceAnonymisationsController {
  async store(ctx: HttpContext) {
    await ctx.request.validateUsing(anonymiseResourceValidator, { data: ctx.request.body() });
    const { companyId, id } = ctx.params;
    const applied = await withActor(ctx, async (actor, trx) => {
      if (actor.masqueradeContext?.isMasquerading) return 'forbidden';
      try {
        await assertCompanyPermission(companyId, 'resources:anonymise', trx);
      } catch (error) {
        // Route wording: this route refuses identity failures as a bare 'Forbidden.'.
        if (error instanceof IdentityAuthorizationException) return 'forbidden';
        throw error;
      }
      return anonymiseResources(trx, companyId, actor.userId, id);
    });
    if (applied === 'forbidden') return ctx.response.forbidden({ error: 'Forbidden.' });
    if (!applied) return ctx.response.notFound({ error: 'Not found.' });
    return ctx.response.noContent();
  }
}
