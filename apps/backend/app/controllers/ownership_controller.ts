import type { HttpContext } from '@adonisjs/core/http';
import { parseAccountCommand } from '#services/account_commands';
import { transferOwnership } from '#services/membership/ownership_transfer';
import { withActor } from '#services/auth/current_actor';
import { transferValidator } from '#validators/ownership';

export default class OwnershipController {
  async transfer(ctx: HttpContext) {
    const body = await ctx.request.validateUsing(transferValidator, { data: ctx.request.body() });
    const command = parseAccountCommand(
      ctx.request.header('x-account-command-id'),
      ctx.request.header('idempotency-key')
    );
    const companyId = ctx.params.companyId;
    const { toUserId } = body;
    const confirmationId = body.confirmationId ?? '';
    const receipt = await withActor(ctx, (actor, trx) =>
      transferOwnership({ trx, actor, companyId, toUserId, confirmationId, command })
    );
    return ctx.response.ok(receipt);
  }
}
