import type { HttpContext } from '@adonisjs/core/http';
import { parseAccountOperation } from '#services/account_operations';
import { transferOwnership } from '#services/membership/ownership_transfer';
import { withActor } from '#services/auth/current_actor';
import { transferOwnershipValidator } from '#validators/ownership';

/** Transfers company ownership to another member. */
export default class OwnershipTransfersController {
  async store(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(transferOwnershipValidator, {
      data: ctx.request.body(),
    });
    const command = parseAccountOperation(
      ctx.request.header('x-account-operation-id'),
      ctx.request.header('idempotency-key')
    );
    const companyId = ctx.params.companyId;
    const { toUserId } = body;
    const confirmationId = body.confirmationId ?? '';
    const receipt = await withActor(ctx, (actor, trx) =>
      transferOwnership({ trx, actor, companyId, toUserId, confirmationId, command })
    );
    return ctx.serialize(receipt);
  }
}
