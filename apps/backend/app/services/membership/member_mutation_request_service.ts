import { inject } from '@adonisjs/core';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { AuthorizationService } from '#services/auth/authorization_service';
import { CurrentActorService, type RequestAuth } from '#services/auth/current_actor_service';
import { runAccountOperation, type AccountOperationIdentity } from '#services/account_operations';

/** One member operation: its company, operation name and identity, recorded payload and work. */
export interface SemanticMutationInput<T> {
  companyId: string;
  operation: string;
  command: AccountOperationIdentity;
  payload: unknown;
  work: (trx: TransactionClientContract, actor: { actorId: string }) => Promise<T>;
}

/** Member operations run as account operations under live management permission. */
@inject()
export class MemberMutationRequestService {
  #authorization: AuthorizationService;
  #currentActor: CurrentActorService;

  constructor(authorization: AuthorizationService, currentActor: CurrentActorService) {
    this.#authorization = authorization;
    this.#currentActor = currentActor;
  }

  /** Runs a member operation as an account operation under live management permission. */
  async run<T>(auth: RequestAuth, input: SemanticMutationInput<T>) {
    const { companyId, operation, command, payload, work } = input;
    return this.#currentActor.withActor(auth, async (currentActor, trx) => {
      let actor: Awaited<ReturnType<AuthorizationService['assertCompanyPermission']>>;
      return runAccountOperation(trx, {
        name: operation,
        authorizeAccess: async () => {
          actor = await this.#authorization.assertCompanyPermission(
            companyId,
            'members:manage',
            trx
          );
        },
        work: () => work(trx, actor),
        actorId: currentActor.userId,
        scopeId: companyId,
        payload,
        command,
      });
    });
  }
}
