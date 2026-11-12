import type { HttpContext } from '@adonisjs/core/http';
import { readAccountCommand } from '#services/account_commands';
import { transferOwnership } from '#services/membership/ownership_transfer';
import { hasOnlyFields } from '#services/request_helpers';

function validBody(value: unknown): value is { toUserId: string; confirmationId?: string } {
  return (
    hasOnlyFields(value, ['toUserId', 'confirmationId']) &&
    typeof value.toUserId === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value.toUserId) &&
    (value.confirmationId === undefined ||
      (typeof value.confirmationId === 'string' && /^[0-9a-f-]{36}$/.test(value.confirmationId)))
  );
}

export default class OwnershipController {
  async transfer(ctx: HttpContext) {
    if (!validBody(ctx.request.body())) {
      return ctx.response.badRequest({
        error: 'An eligible target user is required.',
        code: 'VALIDATION_FAILED',
      });
    }
    const command = readAccountCommand(ctx);
    const receipt = await transferOwnership(
      ctx,
      ctx.params.accountId,
      ctx.request.body().toUserId,
      ctx.request.body().confirmationId ?? '',
      command
    );
    return ctx.response.ok(receipt);
  }
}
