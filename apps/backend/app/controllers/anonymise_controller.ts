import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { anonymiseResources } from '#services/anonymise';
import {
  actionProofActor,
  ActionProofError,
  consumeActionProof,
} from '#services/auth/action_proof';
import { dataContextForActor } from '#services/planning_operations/data_policy';

export default class AnonymiseController {
  async resource(ctx: HttpContext) {
    const body = ctx.request.body() as unknown;
    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    )
      return ctx.response.badRequest({ error: 'Invalid anonymisation request.' });
    const { accountId, id } = ctx.params;
    const applied = await withActor(ctx, async (actor, trx) => {
      if (actor.masqueradeContext?.isMasquerading) return 'forbidden';
      const context = await dataContextForActor(ctx, trx);
      const capabilities = context.capabilitiesFor(accountId);
      if (!(await context.authorize(accountId, 'anonymise', capabilities))) return 'forbidden';
      return anonymiseResources(trx, accountId, context.actorId, id);
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
      typeof (body as Record<string, unknown>).proofId !== 'string'
    )
      return ctx.response.badRequest({ error: 'Invalid anonymisation request.' });
    const { accountId } = ctx.params;
    try {
      await withActor(ctx, async (_actor, trx) => {
        const actor = await actionProofActor(accountId, trx);
        await consumeActionProof(
          trx,
          actor,
          (body as { proofId: string }).proofId,
          'anonymise',
          accountId,
          {}
        );
        await anonymiseResources(trx, accountId, actor.userId);
      });
      return ctx.response.noContent();
    } catch (error) {
      if (error instanceof ActionProofError)
        return ctx.response.status(error.status).send({ error: error.message, code: error.code });
      throw error;
    }
  }
}
