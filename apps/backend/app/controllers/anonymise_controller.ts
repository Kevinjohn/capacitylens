import type { HttpContext } from '@adonisjs/core/http';
import { withActor } from '#services/auth/current_actor';
import { anonymiseResources } from '#services/anonymise';
import {
  actionProofActor,
  ActionProofError,
  consumeActionProof,
} from '#services/auth/action_proof';
import { activeMembership, memberBouncer } from '#services/auth/authorization';

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
      const membership = await activeMembership(actor.userId, accountId, trx);
      if (!(await memberBouncer(actor.userId, membership).allows('resources:anonymise'))) {
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
      typeof (body as Record<string, unknown>).proofId !== 'string'
    ) {
      return ctx.response.badRequest({ error: 'Invalid anonymisation request.' });
    }
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
      if (error instanceof ActionProofError) {
        return ctx.response.status(error.status).send({ error: error.message, code: error.code });
      }
      throw error;
    }
  }
}
