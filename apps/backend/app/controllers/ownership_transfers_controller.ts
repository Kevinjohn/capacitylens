import { inject } from '@adonisjs/core';
import { OwnershipTransferService } from '#services/membership/ownership_transfer_service';
import type { HttpContext } from '@adonisjs/core/http';
import { parseAccountOperation } from '#services/account_operations';
import { withActor } from '#services/auth/current_actor';
import { transferOwnershipValidator } from '#validators/ownership';

/** Transfers company ownership to another member. */
@inject()
export default class OwnershipTransfersController {
  #ownershipTransfers: OwnershipTransferService;

  constructor(ownershipTransfers: OwnershipTransferService) {
    this.#ownershipTransfers = ownershipTransfers;
  }

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
      this.#ownershipTransfers.transfer({
        trx,
        actor,
        companyId,
        toUserId,
        confirmationId,
        command,
      })
    );
    return serialize(receipt);
  }
}
