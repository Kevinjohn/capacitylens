import type { HttpContext } from '@adonisjs/core/http';
import { withActor, requireKitContext } from '#services/auth/current_actor';
import { anonymiseResources } from '#services/anonymise';
import { requirePasswordConfirmationActor } from '#services/auth/password_confirmation';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { companyValidator, resourceValidator } from '#validators/anonymise';
import { assertCompanyPermission } from '#services/auth/authorization';
import { IdentityAuthorizationException } from '#exceptions/identity_authorization_exception';

export default class AnonymiseController {
  async resource(ctx: HttpContext) {
    await ctx.request.validateUsing(resourceValidator, { data: ctx.request.body() });
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

  async company(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(companyValidator, { data: ctx.request.body() });
    const { companyId } = ctx.params;
    await withActor(ctx, async (_actor, trx) => {
      const actor = await requirePasswordConfirmationActor(companyId, trx, 'anonymise');
      await passwordConfirmations.consume(requireKitContext(trx), {
        confirmationId: body.confirmationId,
        action: 'anonymise',
        scope: companyId,
        intent: {},
      });
      await anonymiseResources(trx, companyId, actor.userId);
    });
    return ctx.response.noContent();
  }
}
