import { inject } from '@adonisjs/core';
import { OwnershipTransferService } from '#services/membership/ownership_transfer_service';
import type { HttpContext } from '@adonisjs/core/http';
import { CurrentActorService } from '#services/auth/current_actor_service';
import { transferOwnershipValidator } from '#validators/ownership';
import { AccountOperationService } from '#services/account_operation_service';

/** Transfers company ownership to another member. */
@inject()
export default class OwnershipTransfersController {
  #currentActor: CurrentActorService;
  #ownershipTransfers: OwnershipTransferService;
  #accountOperations: AccountOperationService;

  constructor(
    ownershipTransfers: OwnershipTransferService,
    currentActor: CurrentActorService,
    accountOperations: AccountOperationService
  ) {
    this.#ownershipTransfers = ownershipTransfers;
    this.#currentActor = currentActor;
    this.#accountOperations = accountOperations;
  }

  async store({ auth, params, request, serialize }: HttpContext) {
    const body = await request.validateUsing(transferOwnershipValidator, {
      data: request.body(),
    });
    const command = this.#accountOperations.parseAccountOperation(
      request.header('x-account-operation-id'),
      request.header('idempotency-key')
    );
    const companyId = params.companyId;
    const { toUserId } = body;
    const confirmationId = body.confirmationId ?? '';
    const receipt = await this.#currentActor.withActor(auth, (actor, trx) =>
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
