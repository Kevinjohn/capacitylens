import { isOwnerOrAdmin } from '@capacitylens/shared/domain/access';
import type { HttpContext } from '@adonisjs/core/http';
import vine, { errors as vineErrors } from '@vinejs/vine';
import { withActor } from '#services/auth/current_actor';
import { assertCompanyAction, IdentityAuthorityError } from '#services/auth/authorization';

const dismissal = vine.compile(vine.object({ dismissed: vine.literal(true) }));

export default class GettingStartedController {
  async show(ctx: HttpContext) {
    const { params, response } = ctx;
    return withActor(ctx, async (_actor, trx) => {
      await assertCompanyAction(params.accountId, 'planning:read', trx);
      const row = await trx
        .from('account_getting_started_dismissals')
        .where('account_id', params.accountId)
        .first();
      return response.ok({ dismissed: Boolean(row) });
    });
  }

  async update(ctx: HttpContext) {
    const { params, request, response } = ctx;
    try {
      await request.validateUsing(dismissal, { data: request.body() });
    } catch (error) {
      if (!(error instanceof vineErrors.E_VALIDATION_ERROR)) throw error;
      return response.badRequest({ error: 'dismissed must be true.' });
    }
    const now = new Date().toISOString();
    await withActor(ctx, async (_actor, trx) => {
      const { role } = await assertCompanyAction(params.accountId, 'planning:write', trx);
      if (!isOwnerOrAdmin(role)) {
        throw new IdentityAuthorityError('Forbidden.');
      }
      await trx
        .table('account_getting_started_dismissals')
        .insert({
          id: crypto.randomUUID(),
          account_id: params.accountId,
          created_at: now,
          updated_at: now,
        })
        .onConflict('account_id')
        .ignore();
    });
    return response.ok({ dismissed: true });
  }
}
