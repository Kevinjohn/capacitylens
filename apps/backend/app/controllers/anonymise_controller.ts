import type { HttpContext } from '@adonisjs/core/http';
import { withActor, kitContextIn } from '#services/auth/current_actor';
import { anonymiseResources } from '#services/anonymise';
import { passwordConfirmationActor } from '#services/auth/password_confirmation';
import passwordConfirmations from '@kevinjohn/adonisjs-confirm-action-with-password/services/main';
import { getActiveMembership, createMemberBouncer } from '#services/auth/authorization';

export default class AnonymiseController {
  async resource(ctx: HttpContext) {
    const body = ctx.request.body() as unknown;
    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    ) {
      return ctx.response.badRequest({ error: 'Invalid anonymisation request.' });
    }
    const { accountId, id } = ctx.params;
    const applied = await withActor(ctx, async (actor, trx) => {
      if (actor.masqueradeContext?.isMasquerading) return 'forbidden';
      const membership = await getActiveMembership(actor.userId, accountId, trx);
      if (!(await createMemberBouncer(actor.userId, membership).allows('resources:anonymise'))) {
        return 'forbidden';
      }
      return anonymiseResources(trx, accountId, actor.userId, id);
    });
    if (applied === 'forbidden') return ctx.response.forbidden({ error: 'Forbidden.' });
    if (!applied) return ctx.response.notFound({ error: 'Not found.' });
    return ctx.response.noContent();
  }

  async company(ctx: HttpContext) {
    const body = ctx.request.body() as unknown;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 1 ||
      typeof (body as Record<string, unknown>).confirmationId !== 'string'
    ) {
      return ctx.response.badRequest({ error: 'Invalid anonymisation request.' });
    }
    const { accountId } = ctx.params;
    await withActor(ctx, async (_actor, trx) => {
      const actor = await passwordConfirmationActor(accountId, trx);
      await passwordConfirmations.consume(kitContextIn(trx), {
        confirmationId: (body as { confirmationId: string }).confirmationId,
        action: 'anonymise',
        scope: accountId,
        intent: {},
      });
      await anonymiseResources(trx, accountId, actor.userId);
    });
    return ctx.response.noContent();
  }
}
