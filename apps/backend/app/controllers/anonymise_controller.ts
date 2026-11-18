import type { HttpContext } from '@adonisjs/core/http';
import { withActor, kitContextIn } from '#services/auth/current_actor';
import { anonymiseResources } from '#services/anonymise';
import { passwordConfirmationActor } from '#services/auth/password_confirmation';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { hasOnlyFields } from '#services/request_helpers';
import { assertCompanyAction, IdentityAuthorityError } from '#services/auth/authorization';

export default class AnonymiseController {
  async resource(ctx: HttpContext) {
    const body = ctx.request.body() as unknown;
    if (!hasOnlyFields(body, [])) {
      return ctx.response.badRequest({ error: 'Invalid anonymisation request.' });
    }
    const { companyId, id } = ctx.params;
    const applied = await withActor(ctx, async (actor, trx) => {
      if (actor.masqueradeContext?.isMasquerading) return 'forbidden';
      try {
        await assertCompanyAction(companyId, 'resources:anonymise', trx);
      } catch (error) {
        if (error instanceof IdentityAuthorityError) return 'forbidden';
        throw error;
      }
      return anonymiseResources(trx, companyId, actor.userId, id);
    });
    if (applied === 'forbidden') return ctx.response.forbidden({ error: 'Forbidden.' });
    if (!applied) return ctx.response.notFound({ error: 'Not found.' });
    return ctx.response.noContent();
  }

  async company(ctx: HttpContext) {
    const body = ctx.request.body() as unknown;
    if (!hasOnlyFields(body, ['confirmationId']) || typeof body.confirmationId !== 'string') {
      return ctx.response.badRequest({ error: 'Invalid anonymisation request.' });
    }
    const { companyId } = ctx.params;
    await withActor(ctx, async (_actor, trx) => {
      const actor = await passwordConfirmationActor(companyId, trx, 'anonymise');
      await passwordConfirmations.consume(kitContextIn(trx), {
        confirmationId: body.confirmationId as string,
        action: 'anonymise',
        scope: companyId,
        intent: {},
      });
      await anonymiseResources(trx, companyId, actor.userId);
    });
    return ctx.response.noContent();
  }
}
