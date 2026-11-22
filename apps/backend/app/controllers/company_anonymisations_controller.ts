import type { HttpContext } from '@adonisjs/core/http';
import { withActor, requireKitContext } from '#services/auth/current_actor';
import { anonymiseResources } from '#services/anonymise';
import { requirePasswordConfirmationActor } from '#services/auth/password_confirmation';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { anonymiseCompanyValidator } from '#validators/anonymise';

/** Anonymises every person in the company after a password confirmation. */
export default class CompanyAnonymisationsController {
  async store(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(anonymiseCompanyValidator, {
      data: ctx.request.body(),
    });
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
