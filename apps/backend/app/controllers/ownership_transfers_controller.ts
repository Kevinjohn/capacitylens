import type { HttpContext } from '@adonisjs/core/http';
import { parseAccountOperation } from '#services/account_operations';
import { transferOwnership } from '#services/membership/ownership_transfer';
import { withActor } from '#services/auth/current_actor';
import { transferOwnershipValidator } from '#validators/ownership';

/** Transfers company ownership to another member. */
export default class OwnershipTransfersController {
  async store({ auth, params, request, serialize }: HttpContext) {
    const body = await request.validateUsing(transferOwnershipValidator, {
      data: request.body(),
    });
    const command = parseAccountOperation(
      request.header('x-account-operation-id'),
      request.header('idempotency-key')
    );
    const companyId = params.companyId;
    const { toUserId } = body;
    const confirmationId = body.confirmationId ?? '';
    const receipt = await withActor(auth, (actor, trx) =>
      transferOwnership({ trx, actor, companyId, toUserId, confirmationId, command })
    );
    return serialize(receipt);
  }
}
