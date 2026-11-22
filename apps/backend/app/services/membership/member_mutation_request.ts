import type { HttpContext } from '@adonisjs/core/http';
import type { TransactionClientContract } from '@adonisjs/lucid/types/database';
import { assertCompanyPermission } from '#services/auth/authorization';
import { withActor } from '#services/auth/current_actor';
import { runAccountOperation, parseAccountOperation } from '#services/account_operations';

/** Reads a member route's parameter. */
export function readRouteParam(value: unknown) {
  // Adonis calls the controller after matching a route, so each parameter is already a string.
  return value as string;
}

/** One member operation: its company, operation name, recorded payload and the work it runs. */
export interface SemanticMutationInput<T> {
  companyId: string;
  operation: string;
  payload: unknown;
  work: (trx: TransactionClientContract, actor: { actorId: string }) => Promise<T>;
}

/** Runs a member operation as an account operation under live management permission. */
export async function runMemberMutation<T>(ctx: HttpContext, input: SemanticMutationInput<T>) {
  const { companyId, operation, payload, work } = input;
  const command = parseAccountOperation(
    ctx.request.header('x-account-command-id'),
    ctx.request.header('idempotency-key')
  );
  return withActor(ctx, async (currentActor, trx) => {
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
