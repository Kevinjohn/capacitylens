import type { HttpContext } from '@adonisjs/core/http';
import { parseAccountCommand } from '#services/account_commands';
import { transferOwnership } from '#services/membership/ownership_transfer';
import { withActor } from '#services/auth/current_actor';
import { hasOnlyFields, USER_ID_PATTERN } from '#services/request_helpers';

function validBody(value: unknown): value is { toUserId: string; confirmationId?: string } {
  return (
    hasOnlyFields(value, ['toUserId', 'confirmationId']) &&
    typeof value.toUserId === 'string' &&
    USER_ID_PATTERN.test(value.toUserId) &&
    (value.confirmationId === undefined ||
      (typeof value.confirmationId === 'string' && /^[0-9a-f-]{36}$/.test(value.confirmationId)))
  );
}

export default class OwnershipController {
  async transfer(ctx: HttpContext) {
    if (!validBody(ctx.request.body())) {
      return ctx.response.badRequest({
        error: 'An eligible target user is required.',
        code: 'VALIDATION_ERROR',
      });
    }
    const command = parseAccountCommand(
      ctx.request.header('x-account-command-id'),
      ctx.request.header('idempotency-key')
    );
    const companyId = ctx.params.companyId;
    const { toUserId } = ctx.request.body();
    const confirmationId = ctx.request.body().confirmationId ?? '';
    const receipt = await withActor(ctx, (actor, trx) =>
      transferOwnership({ trx, actor, companyId, toUserId, confirmationId, command })
    );
    return ctx.response.ok(receipt);
  }
}
