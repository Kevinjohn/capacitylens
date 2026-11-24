import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor, type RequestAuth } from '#services/auth/current_actor';
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
export class MemberMutationRequestService {
  /** Runs a member operation as an account operation under live management permission. */
  async run<T>(auth: RequestAuth, input: SemanticMutationInput<T>) {
    const { companyId, operation, command, payload, work } = input;
    return withActor(auth, async (currentActor, trx) => {
      let actor: Awaited<ReturnType<typeof assertCompanyPermission>>;
      return runAccountOperation(trx, {
        name: operation,
        authorizeAccess: async () => {
          actor = await assertCompanyPermission(companyId, 'members:manage', trx);
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
